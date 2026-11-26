-- =====================================================================
-- Pequeño Capricho · esquema de base de datos (Supabase / PostgreSQL)
-- Correr una sola vez en: Supabase > SQL Editor > New query > Run
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------

-- Fecha de hoy en Córdoba (el servidor está en UTC)
create or replace function public.hoy_local()
returns date language sql stable as $$
  select (now() at time zone 'America/Argentina/Cordoba')::date
$$;

create or replace function public.fecha_local(t timestamptz)
returns date language sql immutable as $$
  select (t at time zone 'America/Argentina/Cordoba')::date
$$;

-- ---------------------------------------------------------------------
-- Usuarios y permisos
--   duena    : vende, caja, stock, ajustes
--   ayudante : catálogo/stock (y más adelante pedidos online)
--   admin    : todo (el desarrollador)
-- ---------------------------------------------------------------------
create table if not exists public.perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null default '',
  rol        text not null default 'ayudante' check (rol in ('duena','ayudante','admin')),
  creado_en  timestamptz not null default now()
);

-- Cada usuario nuevo de Supabase Auth recibe un perfil.
-- El rol se toma de los metadatos (si se cargó) o queda como 'ayudante'.
create or replace function public.crear_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    case when new.raw_user_meta_data->>'rol' in ('duena','ayudante','admin')
         then new.raw_user_meta_data->>'rol' else 'ayudante' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.crear_perfil();

create or replace function public.mi_rol()
returns text language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where id = auth.uid()
$$;

create or replace function public.puede_vender()
returns boolean language sql stable as $$
  select coalesce(public.mi_rol() in ('duena','admin'), false)
$$;

create or replace function public.puede_catalogo()
returns boolean language sql stable as $$
  select coalesce(public.mi_rol() in ('duena','ayudante','admin'), false)
$$;

-- ---------------------------------------------------------------------
-- Configuración (una sola fila)
-- ---------------------------------------------------------------------
create table if not exists public.config (
  id                       int primary key default 1 check (id = 1),
  -- porcentajes totales que cobra cada posnet (con IVA incluido)
  comision_mp_debito       numeric(6,2) not null default 0,
  comision_mp_credito      numeric(6,2) not null default 0,
  comision_getnet_debito   numeric(6,2) not null default 0,
  comision_getnet_credito  numeric(6,2) not null default 0,
  comision_qr              numeric(6,2) not null default 0,
  email_tickets            text,
  email_modo               text not null default 'diario' check (email_modo in ('inmediato','diario','no')),
  aviso_stock_bajo         int not null default 2,
  rubros                   text[] not null default array['Juguetes','Ojotas','Pantuflas','Otros'],
  actualizado_en           timestamptz not null default now()
);
insert into public.config (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- Productos (stock compartido: local y, más adelante, online)
-- ---------------------------------------------------------------------
create table if not exists public.productos (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null check (length(trim(nombre)) > 0),
  rubro            text not null default 'Juguetes',
  cantidad         int not null default 0 check (cantidad >= 0),
  costo            numeric(12,2) not null default 0 check (costo >= 0),
  precio           numeric(12,2) not null default 0 check (precio >= 0),
  foto_path        text,
  activo           boolean not null default true,
  -- para el futuro catálogo online
  publicar_online  boolean not null default false,
  descripcion      text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);
create index if not exists productos_activos on public.productos (activo, nombre);

-- Registro de todos los movimientos de stock (ventas, anulaciones, ajustes,
-- y más adelante pedidos online). Sirve para auditar y para el canal online.
create table if not exists public.movimientos_stock (
  id           bigserial primary key,
  producto_id  uuid not null references public.productos(id) on delete cascade,
  cambio       int not null,
  quedan       int not null,
  motivo       text not null default 'ajuste',
  venta_id     uuid,
  usuario_id   uuid default auth.uid(),
  creado_en    timestamptz not null default now()
);
create index if not exists movimientos_producto on public.movimientos_stock (producto_id, creado_en desc);

create or replace function public.registrar_movimiento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.actualizado_en := now();
  if tg_op = 'INSERT' then
    if new.cantidad <> 0 then
      insert into movimientos_stock (producto_id, cambio, quedan, motivo)
      values (new.id, new.cantidad, new.cantidad, 'alta');
    end if;
  elsif new.cantidad is distinct from old.cantidad then
    insert into movimientos_stock (producto_id, cambio, quedan, motivo, venta_id)
    values (new.id, new.cantidad - old.cantidad, new.cantidad,
            coalesce(nullif(current_setting('app.motivo', true), ''), 'ajuste'),
            nullif(current_setting('app.venta_id', true), '')::uuid);
  end if;
  return new;
end $$;

drop trigger if exists productos_movimiento on public.productos;
create trigger productos_movimiento before update on public.productos
  for each row execute function public.registrar_movimiento();
drop trigger if exists productos_alta on public.productos;
create trigger productos_alta after insert on public.productos
  for each row execute function public.registrar_movimiento();

-- ---------------------------------------------------------------------
-- Ventas
--   monto   = precio normal (lo que vale el producto)
--   recargo = interés/recargo de tarjeta, guardado aparte
--   total   = monto + recargo (lo que se cobró)
-- ---------------------------------------------------------------------
create table if not exists public.ventas (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid unique,             -- evita duplicados al subir ventas hechas sin internet
  creado_en         timestamptz not null default now(),
  fecha             date not null,
  producto_id       uuid references public.productos(id) on delete set null,
  producto_nombre   text,
  cantidad          int not null default 1 check (cantidad > 0),
  rubro             text not null default 'Otros',
  monto             numeric(12,2) not null check (monto > 0),
  recargo_pct       numeric(6,2) not null default 0 check (recargo_pct >= 0),
  recargo           numeric(12,2) not null default 0,
  total             numeric(12,2) not null,
  medio             text not null check (medio in ('efectivo','transferencia','qr','debito','credito')),
  posnet            text check (posnet in ('mercadopago','getnet')),
  comision_pct      numeric(6,2) not null default 0,
  comision          numeric(12,2) not null default 0,
  costo             numeric(12,2),           -- costo de la mercadería vendida (si hay producto)
  stock_descontado  int not null default 0,
  canal             text not null default 'local' check (canal in ('local','online')),
  anulada           boolean not null default false,
  anulada_en        timestamptz,
  anulada_por       uuid,
  usuario_id        uuid default auth.uid(),
  check ((medio in ('debito','credito')) = (posnet is not null))
);
create index if not exists ventas_fecha on public.ventas (fecha, creado_en);

-- ---------------------------------------------------------------------
-- Caja diaria
-- ---------------------------------------------------------------------
create table if not exists public.cajas (
  fecha              date primary key,
  apertura           numeric(12,2) not null default 0,
  abierta_en         timestamptz not null default now(),
  abierta_por        uuid default auth.uid(),
  estado             text not null default 'abierta' check (estado in ('abierta','cerrada')),
  cerrada_en         timestamptz,
  efectivo_ventas    numeric(12,2),
  efectivo_esperado  numeric(12,2),
  efectivo_contado   numeric(12,2),
  diferencia         numeric(12,2),
  nota               text
);

-- ---------------------------------------------------------------------
-- Tickets de posnet (fotos)
-- ---------------------------------------------------------------------
create table if not exists public.tickets (
  id            uuid primary key default gen_random_uuid(),
  creado_en     timestamptz not null default now(),
  fecha         date not null default public.hoy_local(),
  foto_path     text not null,
  venta_id      uuid references public.ventas(id) on delete set null,
  monto_leido   numeric(12,2),
  posnet_leido  text,
  lectura       jsonb,
  coincide      boolean,
  enviado_en    timestamptz,
  usuario_id    uuid default auth.uid()
);
create index if not exists tickets_fecha on public.tickets (fecha);

-- ---------------------------------------------------------------------
-- Funciones de negocio (se llaman desde la app)
-- ---------------------------------------------------------------------

create or replace function public.comision_para(p_medio text, p_posnet text)
returns numeric language sql stable as $$
  select case
    when p_medio = 'debito'  and p_posnet = 'mercadopago' then comision_mp_debito
    when p_medio = 'credito' and p_posnet = 'mercadopago' then comision_mp_credito
    when p_medio = 'debito'  and p_posnet = 'getnet'      then comision_getnet_debito
    when p_medio = 'credito' and p_posnet = 'getnet'      then comision_getnet_credito
    when p_medio = 'qr' then comision_qr
    else 0 end
  from public.config where id = 1
$$;

-- Guarda una venta y descuenta el stock en un solo paso.
create or replace function public.registrar_venta(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_client   uuid := nullif(p->>'client_id','')::uuid;
  v_existe   ventas;
  v_prod     productos;
  v_medio    text := p->>'medio';
  v_posnet   text := case when p->>'medio' in ('debito','credito') then nullif(p->>'posnet','') end;
  v_cant     int := greatest(coalesce((p->>'cantidad')::int, 1), 1);
  v_monto    numeric := round((p->>'monto')::numeric, 2);
  v_pct      numeric := case when p->>'medio' in ('debito','credito')
                             then greatest(coalesce((p->>'recargo_pct')::numeric, 0), 0) else 0 end;
  v_recargo  numeric;
  v_total    numeric;
  v_com_pct  numeric;
  v_creado   timestamptz := coalesce(nullif(p->>'creado_en','')::timestamptz, now());
  v_desc     int := 0;
  v_quedan   int;
  v_venta    ventas;
begin
  if not puede_vender() then
    raise exception 'No tenés permiso para vender' using errcode = '42501';
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'Falta el monto';
  end if;
  if v_medio in ('debito','credito') and v_posnet is null then
    raise exception 'Falta elegir el posnet';
  end if;
  -- no aceptar fechas del futuro (relojes mal puestos)
  if v_creado > now() + interval '5 minutes' then v_creado := now(); end if;

  if v_client is not null then
    select * into v_existe from ventas where client_id = v_client;
    if found then
      return jsonb_build_object('venta', to_jsonb(v_existe), 'quedan', null, 'repetida', true);
    end if;
  end if;

  v_recargo := round(v_monto * v_pct / 100, 2);
  v_total   := v_monto + v_recargo;
  v_com_pct := coalesce(comision_para(v_medio, v_posnet), 0);

  insert into ventas (client_id, creado_en, fecha, cantidad, rubro, monto, recargo_pct, recargo,
                      total, medio, posnet, comision_pct, comision, producto_nombre, canal)
  values (v_client, v_creado, fecha_local(v_creado), v_cant,
          coalesce(nullif(p->>'rubro',''), 'Otros'), v_monto, v_pct, v_recargo, v_total,
          v_medio, v_posnet, v_com_pct, round(v_total * v_com_pct / 100, 2),
          nullif(p->>'producto_nombre',''), coalesce(nullif(p->>'canal',''), 'local'))
  returning * into v_venta;

  if nullif(p->>'producto_id','') is not null then
    select * into v_prod from productos where id = (p->>'producto_id')::uuid for update;
    if found then
      v_desc   := least(v_cant, greatest(v_prod.cantidad, 0));
      v_quedan := v_prod.cantidad - v_desc;
      perform set_config('app.motivo', 'venta', true);
      perform set_config('app.venta_id', v_venta.id::text, true);
      update productos set cantidad = v_quedan where id = v_prod.id;
      perform set_config('app.motivo', '', true);
      perform set_config('app.venta_id', '', true);
      update ventas set producto_id = v_prod.id,
                        producto_nombre = coalesce(producto_nombre, v_prod.nombre),
                        costo = round(v_prod.costo * v_cant, 2),
                        stock_descontado = v_desc
       where id = v_venta.id
       returning * into v_venta;
    end if;
  end if;

  return jsonb_build_object('venta', to_jsonb(v_venta), 'quedan', v_quedan, 'repetida', false);
end $$;

-- Anula una venta y devuelve el producto al stock.
create or replace function public.anular_venta(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v ventas;
  v_caja text;
begin
  if not puede_vender() then
    raise exception 'No tenés permiso para anular' using errcode = '42501';
  end if;
  select * into v from ventas where id = p_id for update;
  if not found then raise exception 'No se encontró la venta'; end if;
  if v.anulada then return to_jsonb(v); end if;
  select estado into v_caja from cajas where fecha = v.fecha;
  if v_caja = 'cerrada' then
    raise exception 'La caja de ese día ya está cerrada. Reabrila para anular.';
  end if;

  update ventas set anulada = true, anulada_en = now(), anulada_por = auth.uid()
   where id = p_id returning * into v;

  if v.producto_id is not null and v.stock_descontado > 0 then
    perform set_config('app.motivo', 'anulacion', true);
    perform set_config('app.venta_id', v.id::text, true);
    update productos set cantidad = cantidad + v.stock_descontado where id = v.producto_id;
    perform set_config('app.motivo', '', true);
    perform set_config('app.venta_id', '', true);
  end if;
  return to_jsonb(v);
end $$;

-- Suma o resta unidades a un producto (reposición o corrección).
create or replace function public.ajustar_stock(p_id uuid, p_cambio int)
returns int language plpgsql security definer set search_path = public as $$
declare v_q int;
begin
  if not puede_catalogo() then
    raise exception 'No tenés permiso' using errcode = '42501';
  end if;
  perform set_config('app.motivo', case when p_cambio > 0 then 'reposicion' else 'ajuste' end, true);
  update productos set cantidad = greatest(cantidad + p_cambio, 0)
   where id = p_id returning cantidad into v_q;
  perform set_config('app.motivo', '', true);
  return v_q;
end $$;

create or replace function public.abrir_caja(p_apertura numeric)
returns cajas language plpgsql security definer set search_path = public as $$
declare c cajas;
begin
  if not puede_vender() then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  insert into cajas (fecha, apertura) values (hoy_local(), round(coalesce(p_apertura,0), 2))
  on conflict (fecha) do update set apertura = excluded.apertura
    where cajas.estado = 'abierta'
  returning * into c;
  if c is null then raise exception 'La caja de hoy ya está cerrada. Reabrila primero.'; end if;
  return c;
end $$;

create or replace function public.cerrar_caja(p_contado numeric, p_nota text default null)
returns cajas language plpgsql security definer set search_path = public as $$
declare
  c cajas;
  v_ef numeric;
begin
  if not puede_vender() then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  select * into c from cajas where fecha = hoy_local() for update;
  if not found then raise exception 'La caja de hoy no está abierta'; end if;
  select coalesce(sum(total), 0) into v_ef from ventas
   where fecha = c.fecha and medio = 'efectivo' and not anulada;
  update cajas set estado = 'cerrada', cerrada_en = now(),
         efectivo_ventas = v_ef,
         efectivo_esperado = c.apertura + v_ef,
         efectivo_contado = round(p_contado, 2),
         diferencia = round(p_contado, 2) - (c.apertura + v_ef),
         nota = p_nota
   where fecha = c.fecha returning * into c;
  return c;
end $$;

create or replace function public.reabrir_caja(p_fecha date default null)
returns cajas language plpgsql security definer set search_path = public as $$
declare c cajas;
begin
  if not puede_vender() then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  update cajas set estado = 'abierta', cerrada_en = null, efectivo_contado = null, diferencia = null
   where fecha = coalesce(p_fecha, hoy_local()) returning * into c;
  if c is null then raise exception 'No hay caja para ese día'; end if;
  return c;
end $$;

-- Totales por día (para el historial; evita bajar miles de ventas)
create or replace function public.resumen_por_dia(p_desde date, p_hasta date)
returns table (
  fecha date, ventas bigint, total numeric, monto numeric, efectivo numeric,
  transferencia numeric, qr numeric, tarjetas numeric, recargos numeric,
  cantidad_recargos bigint, comisiones numeric, ganancia numeric,
  apertura numeric, contado numeric, diferencia numeric, estado text
) language sql stable security definer set search_path = public as $$
  with d as (
    select v.fecha,
           count(*) as ventas,
           sum(v.total) as total,
           sum(v.monto) as monto,
           sum(v.total) filter (where v.medio = 'efectivo') as efectivo,
           sum(v.total) filter (where v.medio = 'transferencia') as transferencia,
           sum(v.total) filter (where v.medio = 'qr') as qr,
           sum(v.total) filter (where v.medio in ('debito','credito')) as tarjetas,
           sum(v.recargo) as recargos,
           count(*) filter (where v.recargo > 0) as cantidad_recargos,
           sum(v.comision) as comisiones,
           sum(v.monto - v.costo) filter (where v.costo is not null) as ganancia
      from ventas v
     where v.fecha between p_desde and p_hasta and not v.anulada
     group by v.fecha
  )
  select coalesce(d.fecha, c.fecha), coalesce(d.ventas, 0), coalesce(d.total, 0), coalesce(d.monto, 0),
         coalesce(d.efectivo, 0), coalesce(d.transferencia, 0), coalesce(d.qr, 0),
         coalesce(d.tarjetas, 0), coalesce(d.recargos, 0), coalesce(d.cantidad_recargos, 0),
         coalesce(d.comisiones, 0), coalesce(d.ganancia, 0),
         c.apertura, c.efectivo_contado, c.diferencia, c.estado
    from d full join (select * from cajas where fecha between p_desde and p_hasta) c
      on c.fecha = d.fecha
   where puede_vender()
   order by 1 desc
$$;

-- ---------------------------------------------------------------------
-- Seguridad por filas (RLS)
-- ---------------------------------------------------------------------
alter table public.perfiles          enable row level security;
alter table public.config            enable row level security;
alter table public.productos         enable row level security;
alter table public.movimientos_stock enable row level security;
alter table public.ventas            enable row level security;
alter table public.cajas             enable row level security;
alter table public.tickets           enable row level security;

drop policy if exists perfil_propio on public.perfiles;
create policy perfil_propio on public.perfiles for select
  using (id = auth.uid() or public.mi_rol() = 'admin');

drop policy if exists config_leer on public.config;
create policy config_leer on public.config for select using (auth.uid() is not null);
drop policy if exists config_editar on public.config;
create policy config_editar on public.config for update
  using (public.puede_vender()) with check (public.puede_vender());

drop policy if exists productos_leer on public.productos;
create policy productos_leer on public.productos for select using (public.puede_catalogo());
drop policy if exists productos_crear on public.productos;
create policy productos_crear on public.productos for insert with check (public.puede_catalogo());
drop policy if exists productos_editar on public.productos;
create policy productos_editar on public.productos for update
  using (public.puede_catalogo()) with check (public.puede_catalogo());

drop policy if exists movimientos_leer on public.movimientos_stock;
create policy movimientos_leer on public.movimientos_stock for select using (public.puede_catalogo());

-- Ventas y cajas solo se leen directo; se modifican con las funciones de arriba.
drop policy if exists ventas_leer on public.ventas;
create policy ventas_leer on public.ventas for select using (public.puede_vender());
drop policy if exists cajas_leer on public.cajas;
create policy cajas_leer on public.cajas for select using (public.puede_vender());

drop policy if exists tickets_leer on public.tickets;
create policy tickets_leer on public.tickets for select using (public.puede_vender());
drop policy if exists tickets_crear on public.tickets;
create policy tickets_crear on public.tickets for insert with check (public.puede_vender());
drop policy if exists tickets_editar on public.tickets;
create policy tickets_editar on public.tickets for update
  using (public.puede_vender()) with check (public.puede_vender());

grant execute on function public.registrar_venta(jsonb)       to authenticated;
grant execute on function public.anular_venta(uuid)           to authenticated;
grant execute on function public.ajustar_stock(uuid, int)     to authenticated;
grant execute on function public.abrir_caja(numeric)          to authenticated;
grant execute on function public.cerrar_caja(numeric, text)   to authenticated;
grant execute on function public.reabrir_caja(date)           to authenticated;
grant execute on function public.resumen_por_dia(date, date)  to authenticated;
revoke execute on function public.registrar_venta(jsonb), public.anular_venta(uuid),
  public.ajustar_stock(uuid, int), public.abrir_caja(numeric), public.cerrar_caja(numeric, text),
  public.reabrir_caja(date), public.resumen_por_dia(date, date) from anon;

-- ---------------------------------------------------------------------
-- Archivos (Storage)
--   fotos     : fotos de productos (públicas, para el futuro catálogo)
--   tickets   : fotos de tickets de posnet (privadas)
--   respaldos : copias de seguridad diarias (privadas, solo el servidor)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('tickets', 'tickets', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('respaldos', 'respaldos', false)
  on conflict (id) do nothing;

drop policy if exists fotos_subir on storage.objects;
create policy fotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.puede_catalogo());
drop policy if exists fotos_cambiar on storage.objects;
create policy fotos_cambiar on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and public.puede_catalogo());
drop policy if exists fotos_borrar on storage.objects;
create policy fotos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and public.puede_catalogo());

drop policy if exists tickets_subir on storage.objects;
create policy tickets_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'tickets' and public.puede_vender());
drop policy if exists tickets_ver on storage.objects;
create policy tickets_ver on storage.objects for select to authenticated
  using (bucket_id = 'tickets' and public.puede_vender());

-- ---------------------------------------------------------------------
-- Traer datos del prototipo (app vieja). Se puede correr varias veces:
--  - productos: si ya existe uno con el mismo nombre se actualiza
--  - ventas: no se duplican (client_id fijo) y NO descuentan stock
-- ---------------------------------------------------------------------
create or replace function public.importar_prototipo(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i jsonb;
  v_prod productos;
  v_nuevos int := 0;
  v_actualizados int := 0;
  v_ventas int := 0;
  v_filas int;
begin
  if not puede_vender() then raise exception 'No tenés permiso' using errcode = '42501'; end if;
  perform set_config('app.motivo', 'importacion', true);

  for i in select * from jsonb_array_elements(coalesce(p->'productos', '[]'::jsonb)) loop
    select * into v_prod from productos
     where activo and lower(trim(nombre)) = lower(trim(i->>'nombre')) limit 1;
    if found then
      update productos set cantidad = greatest((i->>'cantidad')::int, 0), costo = (i->>'costo')::numeric,
             precio = (i->>'precio')::numeric, rubro = coalesce(nullif(i->>'rubro', ''), rubro)
       where id = v_prod.id;
      v_actualizados := v_actualizados + 1;
    else
      insert into productos (nombre, rubro, cantidad, costo, precio)
      values (trim(i->>'nombre'), coalesce(nullif(i->>'rubro', ''), 'Otros'),
              greatest((i->>'cantidad')::int, 0), (i->>'costo')::numeric, (i->>'precio')::numeric);
      v_nuevos := v_nuevos + 1;
    end if;
  end loop;
  perform set_config('app.motivo', '', true);

  for i in select * from jsonb_array_elements(coalesce(p->'ventas', '[]'::jsonb)) loop
    select * into v_prod from productos
     where activo and lower(trim(nombre)) = lower(trim(coalesce(i->>'producto_nombre', ''))) limit 1;
    insert into ventas (client_id, creado_en, fecha, producto_id, producto_nombre, cantidad, rubro, monto,
                        recargo_pct, recargo, total, medio, posnet, comision_pct, comision, costo)
    values ((i->>'client_id')::uuid, (i->>'creado_en')::timestamptz, fecha_local((i->>'creado_en')::timestamptz),
            v_prod.id, nullif(i->>'producto_nombre', ''), greatest((i->>'cantidad')::int, 1),
            coalesce(nullif(i->>'rubro', ''), 'Otros'), (i->>'monto')::numeric,
            coalesce((i->>'recargo_pct')::numeric, 0), coalesce((i->>'recargo')::numeric, 0), (i->>'total')::numeric,
            i->>'medio', nullif(i->>'posnet', ''),
            coalesce(comision_para(i->>'medio', nullif(i->>'posnet', '')), 0),
            round((i->>'total')::numeric * coalesce(comision_para(i->>'medio', nullif(i->>'posnet', '')), 0) / 100, 2),
            case when v_prod.id is not null then round(v_prod.costo * greatest((i->>'cantidad')::int, 1), 2) end)
    on conflict (client_id) do nothing;
    get diagnostics v_filas = row_count;
    v_ventas := v_ventas + v_filas;
  end loop;

  return jsonb_build_object('productos_nuevos', v_nuevos, 'productos_actualizados', v_actualizados,
                            'ventas', v_ventas);
end $$;
grant execute on function public.importar_prototipo(jsonb) to authenticated;
revoke execute on function public.importar_prototipo(jsonb) from anon;
