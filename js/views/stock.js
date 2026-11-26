import { api } from '../api/index.js';
import { estado, cargarProductos, rubros, avisoStock } from '../estado.js';
import { gananciaProducto, pesos, leerNumero } from '../calculos.js';
import { esc, $, $$, aviso, avisoError, confirmar, hoja, ocupado, elegirFoto, achicarFoto, campoPesos, iconoVacio } from '../ui.js';
import { miniFoto, normalizar } from './vender.js';

let filtro = { texto: '', rubro: 'Todos', poco: false };

export async function render(raiz) {
  raiz.innerHTML = `<div class="cargando-pantalla"><span class="girando"></span></div>`;
  await cargarProductos();

  raiz.innerHTML = `
    <h1 class="titulo-pantalla">Stock</h1>
    <button type="button" class="btn btn-grande btn-principal" id="nuevo">＋ Agregar producto</button>
    <input type="search" class="buscador" id="buscar" placeholder="Buscar por nombre…" aria-label="Buscar producto" value="${esc(filtro.texto)}">
    <div class="chips chips-scroll" id="filtros">
      ${['Todos', ...rubros()].map((r) => `<button type="button" class="chip" data-rubro="${esc(r)}">${esc(r)}</button>`).join('')}
      <button type="button" class="chip chip-alerta" data-poco="1">⚠️ Poco stock</button>
    </div>
    <div id="lista"></div>
    <p class="nota" id="valor-stock"></p>`;

  const pintar = () => {
    $$('[data-rubro]', raiz).forEach((b) => b.setAttribute('aria-pressed', b.dataset.rubro === filtro.rubro));
    $('[data-poco]', raiz).setAttribute('aria-pressed', filtro.poco);
    const q = normalizar(filtro.texto);
    const items = estado.productos.filter((p) =>
      normalizar(p.nombre).includes(q)
      && (filtro.rubro === 'Todos' || p.rubro === filtro.rubro)
      && (!filtro.poco || p.cantidad <= avisoStock()));
    $('#lista', raiz).innerHTML = items.length
      ? `<ul class="lista-stock" role="list">${items.map(tarjetaProducto).join('')}</ul>`
      : iconoVacio(estado.productos.length ? 'No hay productos con ese filtro' : 'Todavía no hay productos. Tocá "Agregar producto".');
    const costo = estado.productos.reduce((s, p) => s + p.costo * p.cantidad, 0);
    const venta = estado.productos.reduce((s, p) => s + p.precio * p.cantidad, 0);
    $('#valor-stock', raiz).textContent = estado.productos.length
      ? `${estado.productos.length} productos · Mercadería a precio de costo: ${pesos(costo)} · a precio de venta: ${pesos(venta)}`
      : '';
  };

  $('#buscar', raiz).addEventListener('input', (e) => { filtro.texto = e.target.value; pintar(); });
  $('#filtros', raiz).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.poco) filtro.poco = !filtro.poco;
    else filtro.rubro = b.dataset.rubro;
    pintar();
  });
  $('#nuevo', raiz).onclick = () => formulario(null, () => render(raiz));
  $('#lista', raiz).addEventListener('click', async (e) => {
    const aj = e.target.closest('[data-ajuste]');
    if (aj) {
      const p = estado.productos.find((x) => x.id === aj.dataset.pid);
      const cambio = Number(aj.dataset.ajuste);
      if (cambio < 0 && p.cantidad === 0) return;
      p.cantidad = Math.max(0, p.cantidad + cambio); // se ve al instante
      pintar();
      try {
        p.cantidad = await api.ajustarStock(p.id, cambio);
      } catch (err) {
        p.cantidad = Math.max(0, p.cantidad - cambio);
        avisoError(err);
      }
      pintar();
      return;
    }
    const b = e.target.closest('[data-id]');
    if (b) formulario(estado.productos.find((p) => p.id === b.dataset.id), () => render(raiz));
  });
  pintar();
}

function tarjetaProducto(p) {
  const g = gananciaProducto(p);
  const poco = p.cantidad <= avisoStock();
  return `
    <li class="producto-fila">
      <button type="button" class="producto" data-id="${p.id}" aria-label="Editar ${esc(p.nombre)}">
        ${miniFoto(p, 'foto-producto')}
        <span class="producto-texto">
          <strong>${esc(p.nombre)}</strong>
          <small>${esc(p.rubro)}</small>
          <span class="producto-precios">Venta <b>${pesos(p.precio)}</b> · Costo ${pesos(p.costo)}</span>
          <span class="ganancia">Ganás ${pesos(g.ganancia)}${g.porcentaje !== null ? ` (${g.porcentaje}%)` : ''}</span>
        </span>
        <span class="producto-editar" aria-hidden="true">✏️</span>
      </button>
      <div class="producto-stock ${poco ? 'poco-fondo' : ''}">
        <span class="${poco ? 'poco' : ''}">${p.cantidad === 0 ? 'Sin stock' : poco ? 'Queda poco' : 'En stock'}</span>
        <div class="contador contador-chico" role="group" aria-label="Cantidad de ${esc(p.nombre)}">
          <button type="button" class="btn-redondo" data-ajuste="-1" data-pid="${p.id}" aria-label="Restar uno" ${p.cantidad === 0 ? 'disabled' : ''}>−</button>
          <output>${p.cantidad}</output>
          <button type="button" class="btn-redondo" data-ajuste="1" data-pid="${p.id}" aria-label="Sumar uno">+</button>
        </div>
      </div>
    </li>`;
}

function formulario(p, alGuardar) {
  const nuevo = !p;
  const f = p ? { ...p } : { nombre: '', rubro: rubros()[0], cantidad: 1, costo: 0, precio: 0 };
  let foto = null;
  let fotoUrl = p ? api.urlFoto(p.foto_path) : null;
  const fmt = (n) => (n ? new Intl.NumberFormat('es-AR').format(n) : '');

  const html = `
    <form class="form-producto" novalidate>
      <button type="button" class="foto-grande" id="foto" aria-label="Sacar o cambiar foto">
        ${fotoUrl ? `<img src="${esc(fotoUrl)}" alt="">` : '<span>📷<br>Sacar foto</span>'}
      </button>
      <label class="campo"><span class="etiqueta">Nombre</span>
        <input class="input" id="nombre" value="${esc(f.nombre)}" placeholder="Ej: Pelota de goma" required></label>
      <div class="campo"><span class="etiqueta">Rubro</span>
        <div class="chips" id="rubro">${rubros().map((r) => `<button type="button" class="chip" data-rubro="${esc(r)}">${esc(r)}</button>`).join('')}</div></div>
      <div class="campo"><span class="etiqueta" id="et-cant">Cantidad</span>
        <div class="contador" role="group" aria-labelledby="et-cant">
          <button type="button" class="btn-redondo" data-cant="-1" aria-label="Uno menos">−</button>
          <input id="cantidad" class="input input-cantidad" inputmode="numeric" value="${f.cantidad}" aria-label="Cantidad">
          <button type="button" class="btn-redondo" data-cant="1" aria-label="Uno más">+</button>
        </div></div>
      <div class="dos-columnas">
        <label class="campo"><span class="etiqueta">Precio de costo</span>
          <div class="campo-plata"><span aria-hidden="true">$</span><input id="costo" inputmode="numeric" value="${fmt(f.costo)}" placeholder="0" aria-label="Precio de costo"></div></label>
        <label class="campo"><span class="etiqueta">Precio de venta</span>
          <div class="campo-plata"><span aria-hidden="true">$</span><input id="precio" inputmode="numeric" value="${fmt(f.precio)}" placeholder="0" aria-label="Precio de venta"></div></label>
      </div>
      <div class="ganancia-grande" id="ganancia" aria-live="polite"></div>
      <button type="submit" class="btn btn-grande btn-principal">${nuevo ? 'Guardar producto' : 'Guardar cambios'}</button>
      ${nuevo ? '' : '<button type="button" class="btn btn-grande btn-peligro-suave" id="borrar">Borrar producto</button>'}
    </form>`;

  hoja(nuevo ? 'Nuevo producto' : 'Editar producto', html, {
    alAbrir(cuerpo, cerrar) {
      const form = $('form', cuerpo);
      const pintar = () => {
        $$('[data-rubro]', form).forEach((b) => b.setAttribute('aria-pressed', b.dataset.rubro === f.rubro));
        const g = gananciaProducto({ costo: leerNumero($('#costo', form).value), precio: leerNumero($('#precio', form).value) });
        $('#ganancia', form).innerHTML = g.ganancia || g.porcentaje
          ? `Ganás <strong>${pesos(g.ganancia)}</strong> por unidad${g.porcentaje !== null ? ` (${g.porcentaje}%)` : ''}` : '';
        $('#ganancia', form).classList.toggle('negativa', g.ganancia < 0);
      };
      campoPesos($('#costo', form), pintar);
      campoPesos($('#precio', form), pintar);
      form.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.rubro) { f.rubro = b.dataset.rubro; pintar(); }
        if (b.dataset.cant) {
          const c = $('#cantidad', form);
          c.value = Math.max(0, (parseInt(c.value, 10) || 0) + Number(b.dataset.cant));
        }
        if (b.id === 'foto') {
          const archivo = await elegirFoto({ camara: false });
          if (!archivo) return;
          foto = await achicarFoto(archivo, 800, 0.8);
          fotoUrl = URL.createObjectURL(foto);
          b.innerHTML = `<img src="${fotoUrl}" alt="">`;
        }
        if (b.id === 'borrar') {
          const ok = await confirmar({ titulo: `¿Borrar "${p.nombre}"?`, texto: 'Deja de aparecer en el stock. Las ventas que ya hiciste no se tocan.', si: 'Sí, borrar', no: 'No, dejarlo', peligro: true });
          if (!ok) return;
          try { await api.borrarProducto(p.id); aviso('Producto borrado'); cerrar(); alGuardar(); } catch (err) { avisoError(err); }
        }
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const nombre = $('#nombre', form).value.trim();
        if (!nombre) { aviso('Falta el nombre', { tipo: 'error' }); $('#nombre', form).focus(); return; }
        ocupado(e.submitter || $('button[type=submit]', form), async () => {
          try {
            await api.guardarProducto({
              id: p?.id, nombre, rubro: f.rubro,
              cantidad: parseInt($('#cantidad', form).value, 10) || 0,
              costo: leerNumero($('#costo', form).value), precio: leerNumero($('#precio', form).value),
            }, foto);
            aviso(nuevo ? 'Producto guardado ✓' : 'Cambios guardados ✓');
            cerrar();
            alGuardar();
          } catch (err) { avisoError(err); }
        });
      });
      pintar();
    },
  });
}
