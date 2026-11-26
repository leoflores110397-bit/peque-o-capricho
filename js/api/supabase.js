// Conexión real con Supabase (base de datos, login y archivos en la nube).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pc-sesion' },
});

/** Traduce los errores técnicos a palabras simples. */
function error(e) {
  if (!e) return;
  const msg = e.message || String(e);
  if (/Invalid login credentials/i.test(msg)) throw new Error('Correo o clave incorrectos');
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    const err = new Error('No hay internet');
    err.sinInternet = true;
    throw err;
  }
  if (/JWT|token/i.test(msg)) throw new Error('Se cerró la sesión. Volvé a entrar.');
  throw new Error(msg);
}

const r = async (promesa) => {
  let res;
  try {
    res = await promesa;
  } catch (e) {
    error(e);
  }
  if (res.error) error(res.error);
  return res.data;
};

/** Trae todas las filas aunque sean más de 1000 (límite de Supabase por pedido). */
async function todas(consulta) {
  const salida = [];
  for (let desde = 0; ; desde += 1000) {
    const filas = await r(consulta().range(desde, desde + 999));
    salida.push(...filas);
    if (filas.length < 1000) return salida;
  }
}

export const modo = 'nube';

// ---------- sesión ----------
export async function sesion() {
  const { data } = await sb.auth.getSession();
  return data.session ? { email: data.session.user.email, id: data.session.user.id } : null;
}

export async function entrar(email, clave) {
  await r(sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: clave }));
}

export async function salir() {
  await sb.auth.signOut();
}

export function alCambiarSesion(fn) {
  sb.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT') fn(null);
  });
}

export async function perfil() {
  const s = await sesion();
  if (!s) return null;
  const p = await r(sb.from('perfiles').select('*').eq('id', s.id).maybeSingle());
  return { ...s, nombre: p?.nombre || s.email, rol: p?.rol || 'ayudante' };
}

// ---------- configuración ----------
export async function config() {
  return numConfig(await r(sb.from('config').select('*').eq('id', 1).single()));
}

export async function guardarConfig(c) {
  const { id, actualizado_en, ...resto } = c;
  return numConfig(await r(sb.from('config').update({ ...resto, actualizado_en: new Date().toISOString() }).eq('id', 1).select().single()));
}

// ---------- productos ----------
// Postgres devuelve los números con decimales como texto: los pasamos a número.
const aNumero = (campos) => (fila) => {
  if (!fila) return fila;
  const salida = { ...fila };
  for (const c of campos) if (salida[c] !== null && salida[c] !== undefined) salida[c] = Number(salida[c]);
  return salida;
};
const numVenta = aNumero(['monto', 'recargo_pct', 'recargo', 'total', 'comision_pct', 'comision', 'costo']);
const numCaja = aNumero(['apertura', 'efectivo_ventas', 'efectivo_esperado', 'efectivo_contado', 'diferencia']);
const numConfig = aNumero(['comision_mp_debito', 'comision_mp_credito', 'comision_getnet_debito', 'comision_getnet_credito', 'comision_qr']);
const numeros = (p) => ({ ...p, costo: Number(p.costo), precio: Number(p.precio), cantidad: Number(p.cantidad) });

export async function productos() {
  return (await todas(() => sb.from('productos').select('*').eq('activo', true).order('nombre').order('id'))).map(numeros);
}

export async function guardarProducto(p, foto) {
  const datos = {
    nombre: p.nombre.trim(), rubro: p.rubro, cantidad: Math.max(0, Math.round(p.cantidad || 0)),
    costo: p.costo || 0, precio: p.precio || 0,
  };
  if (foto) {
    const ruta = `productos/${crypto.randomUUID()}.jpg`;
    await r(sb.storage.from('fotos').upload(ruta, foto, { contentType: 'image/jpeg' }));
    datos.foto_path = ruta;
  }
  if (p.id) {
    return numeros(await r(sb.from('productos').update(datos).eq('id', p.id).select().single()));
  }
  return numeros(await r(sb.from('productos').insert(datos).select().single()));
}

export async function borrarProducto(id) {
  // no se borra del todo para no perder el historial de ventas
  await r(sb.from('productos').update({ activo: false }).eq('id', id));
}

export async function ajustarStock(id, cambio) {
  return r(sb.rpc('ajustar_stock', { p_id: id, p_cambio: cambio }));
}

export function urlFoto(ruta) {
  if (!ruta) return null;
  return sb.storage.from('fotos').getPublicUrl(ruta).data.publicUrl;
}

// ---------- ventas ----------
export async function registrarVenta(v) {
  return r(sb.rpc('registrar_venta', { p: v }));
}

export async function anularVenta(id) {
  return r(sb.rpc('anular_venta', { p_id: id }));
}

export async function ventasDelDia(fecha) {
  return (await todas(() => sb.from('ventas').select('*').eq('fecha', fecha).order('creado_en', { ascending: false }).order('id'))).map(numVenta);
}

export async function resumenPorDia(desde, hasta) {
  return r(sb.rpc('resumen_por_dia', { p_desde: desde, p_hasta: hasta }));
}

// ---------- caja ----------
export async function caja(fecha) {
  return numCaja(await r(sb.from('cajas').select('*').eq('fecha', fecha).maybeSingle()));
}

export async function abrirCaja(apertura) {
  return numCaja(await r(sb.rpc('abrir_caja', { p_apertura: apertura })));
}

export async function cerrarCaja(contado, nota) {
  return numCaja(await r(sb.rpc('cerrar_caja', { p_contado: contado, p_nota: nota || null })));
}

export async function reabrirCaja(fecha) {
  return numCaja(await r(sb.rpc('reabrir_caja', { p_fecha: fecha || null })));
}

// ---------- tickets ----------
export async function subirTicket(foto, ventaId) {
  const ruta = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
  await r(sb.storage.from('tickets').upload(ruta, foto, { contentType: 'image/jpeg' }));
  return r(sb.from('tickets').insert({ foto_path: ruta, venta_id: ventaId || null }).select().single());
}

export async function ticketsDelDia(fecha) {
  return r(sb.from('tickets').select('*').eq('fecha', fecha).order('creado_en', { ascending: false }));
}

export async function urlTicket(ruta) {
  const d = await r(sb.storage.from('tickets').createSignedUrl(ruta, 3600));
  return d.signedUrl;
}

export async function vincularTicket(id, ventaId) {
  return r(sb.from('tickets').update({ venta_id: ventaId || null }).eq('id', id).select().single());
}

async function funcion(nombre, cuerpo) {
  const { data, error: e } = await sb.functions.invoke(nombre, { body: cuerpo });
  if (e) {
    let detalle = '';
    try { detalle = (await e.context.json()).error; } catch { /* sin detalle */ }
    throw new Error(detalle || 'No se pudo hacer. Probá de nuevo en un rato.');
  }
  return data;
}

export async function enviarTicket(id) {
  return funcion('enviar-ticket', { ticket_id: id });
}

export async function leerTicket(id) {
  return funcion('leer-ticket', { ticket_id: id });
}

// ---------- datos del prototipo ----------
export async function importarPrototipo(datos) {
  return r(sb.rpc('importar_prototipo', { p: datos }));
}

// ---------- copia de seguridad ----------
export async function exportarTodo() {
  const tablas = { config: 'id', productos: 'id', ventas: 'id', cajas: 'fecha', tickets: 'id', movimientos_stock: 'id' };
  const salida = { exportado_en: new Date().toISOString() };
  for (const [t, clave] of Object.entries(tablas)) salida[t] = await todas(() => sb.from(t).select('*').order(clave));
  return salida;
}
