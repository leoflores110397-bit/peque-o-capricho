import { api } from '../api/index.js';
import { estado, guardarVenta, rubros, avisoStock } from '../estado.js';
import { MEDIOS, POSNETS, ES_TARJETA, calcularVenta, pesos, leerNumero, fechaLocal } from '../calculos.js';
import { esc, $, $$, aviso, avisoError, alerta, hoja, ocupado, campoPesos, iconoVacio } from '../ui.js';
import { sacarFotoTicket } from './tickets.js';

const RECARGOS_RAPIDOS = [0, 10, 15, 20, 25];
// Como en el prototipo: arranca en Efectivo y recuerda el último posnet y recargo usados.
const recordado = (k, def) => { try { return localStorage.getItem(k) ?? def; } catch { return def; } };
const nuevaVenta = () => ({
  producto: null, nombreLibre: '', cantidad: 1, monto: 0, montoAuto: true, rubro: null, medio: 'efectivo',
  posnet: recordado('pc-ultimo-posnet', 'mercadopago'), recargoPct: Number(recordado('pc-ultimo-recargo', 0)) || 0,
});

let f = nuevaVenta();

export async function render(raiz) {
  const cajaHoy = await api.caja(fechaLocal()).catch(() => undefined);
  raiz.innerHTML = `
    ${cajaHoy === null ? `<a class="franja-aviso" href="#caja">La caja de hoy no está abierta · <u>Abrir caja</u></a>` : ''}
    <form id="form-venta" class="tarjeta form-venta" autocomplete="off" novalidate>
      <div class="campo">
        <span class="etiqueta">¿Qué vendiste? <small>(si querés)</small></span>
        <div id="producto-elegido"></div>
      </div>

      <div class="campo" id="campo-cantidad">
        <span class="etiqueta" id="et-cantidad">Cantidad</span>
        <div class="contador" role="group" aria-labelledby="et-cantidad">
          <button type="button" class="btn-redondo" data-cant="-1" aria-label="Uno menos">−</button>
          <output id="cantidad" aria-live="polite">1</output>
          <button type="button" class="btn-redondo" data-cant="1" aria-label="Uno más">+</button>
        </div>
      </div>

      <label class="campo">
        <span class="etiqueta">Precio</span>
        <div class="campo-plata">
          <span aria-hidden="true">$</span>
          <input id="monto" inputmode="numeric" placeholder="0" aria-label="Precio en pesos" enterkeyhint="done">
        </div>
      </label>

      <div class="campo">
        <span class="etiqueta">Rubro</span>
        <div class="chips" id="rubros">
          ${rubros().map((r) => `<button type="button" class="chip" data-rubro="${esc(r)}">${esc(r)}</button>`).join('')}
        </div>
      </div>

      <div class="campo">
        <span class="etiqueta">¿Cómo pagó?</span>
        <div class="medios" id="medios">
          ${MEDIOS.map((m) => `
            <button type="button" class="medio" data-medio="${m.id}">
              <span class="medio-icono" aria-hidden="true">${m.icono}</span>${m.nombre}
            </button>`).join('')}
        </div>
      </div>

      <div id="tarjeta-extra" hidden>
        <div class="campo">
          <span class="etiqueta">¿Qué posnet?</span>
          <div class="posnets">
            ${POSNETS.map((p) => `<button type="button" class="posnet posnet-${p.id}" data-posnet="${p.id}">${p.nombre}</button>`).join('')}
          </div>
        </div>
        <div class="campo">
          <span class="etiqueta">Recargo o interés</span>
          <div class="chips" id="recargos">
            ${RECARGOS_RAPIDOS.map((r) => `<button type="button" class="chip" data-recargo="${r}">${r === 0 ? 'Sin recargo' : r + '%'}</button>`).join('')}
            <label class="chip chip-input">Otro <input id="recargo-otro" inputmode="decimal" aria-label="Otro porcentaje de recargo" placeholder="%"></label>
          </div>
        </div>
      </div>

      <div class="cobrar" id="cobrar" aria-live="polite"></div>

      <button type="submit" class="btn btn-grande btn-principal btn-vender" id="guardar">Guardar venta</button>
    </form>`;

  const form = $('#form-venta', raiz);
  if (!f.rubro) f.rubro = rubros()[0];
  if (f.recargoPct && !RECARGOS_RAPIDOS.includes(f.recargoPct)) $('#recargo-otro', form).value = String(f.recargoPct).replace('.', ',');
  const inMonto = $('#monto', form);
  campoPesos(inMonto, () => { f.monto = leerNumero(inMonto.value); f.montoAuto = false; pintar(); });

  form.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cant) {
      f.cantidad = Math.max(1, f.cantidad + Number(b.dataset.cant));
      if (f.producto && f.montoAuto) f.monto = f.producto.precio * f.cantidad;
    } else if (b.dataset.rubro) {
      f.rubro = b.dataset.rubro;
    } else if (b.dataset.medio) {
      f.medio = b.dataset.medio;
    } else if (b.dataset.posnet) {
      f.posnet = b.dataset.posnet;
    } else if (b.dataset.recargo !== undefined) {
      f.recargoPct = Number(b.dataset.recargo);
      $('#recargo-otro', form).value = '';
    } else if (b.id === 'elegir-producto' || b.id === 'editar-nombre') {
      abrirSelector();
      return;
    } else if (b.id === 'quitar-producto') {
      if (f.producto && f.montoAuto) f.monto = 0;
      f.producto = null;
      f.nombreLibre = '';
    } else {
      return;
    }
    pintar();
  });

  $('#recargo-otro', form).addEventListener('input', (e) => {
    f.recargoPct = Math.max(0, leerNumero(e.target.value));
    pintar();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    guardar($('#guardar', form));
  });

  function pintar() {
    // producto
    const p = f.producto;
    $('#producto-elegido', form).innerHTML = p
      ? `<div class="producto-elegido">
           ${miniFoto(p)}
           <div class="producto-elegido-texto"><strong>${esc(p.nombre)}</strong>
             <small>${pesos(p.precio)} · quedan ${p.cantidad}</small></div>
           <button type="button" class="btn-cerrar" id="quitar-producto" aria-label="Quitar producto">✕</button>
         </div>`
      : f.nombreLibre
        ? `<div class="producto-elegido">
             <span class="mini-foto sin-foto" aria-hidden="true">✏️</span>
             <button type="button" class="producto-elegido-texto boton-texto" id="editar-nombre" aria-label="Cambiar el nombre">
               <strong>${esc(f.nombreLibre)}</strong><small>Escrito a mano · no descuenta stock</small></button>
             <button type="button" class="btn-cerrar" id="quitar-producto" aria-label="Quitar producto">✕</button>
           </div>`
        : `<button type="button" class="btn btn-elegir" id="elegir-producto">🔍 Elegir del stock o escribir</button>`;
    $('#cantidad', form).textContent = f.cantidad;
    if (document.activeElement !== inMonto) {
      inMonto.value = f.monto ? new Intl.NumberFormat('es-AR').format(f.monto) : '';
    }
    $$('[data-rubro]', form).forEach((b) => b.setAttribute('aria-pressed', b.dataset.rubro === f.rubro));
    $$('[data-medio]', form).forEach((b) => b.setAttribute('aria-pressed', b.dataset.medio === f.medio));
    $$('[data-posnet]', form).forEach((b) => b.setAttribute('aria-pressed', b.dataset.posnet === f.posnet));
    const otro = $('#recargo-otro', form).value !== '';
    $$('[data-recargo]', form).forEach((b) => b.setAttribute('aria-pressed', !otro && Number(b.dataset.recargo) === f.recargoPct));
    const tarjeta = ES_TARJETA(f.medio);
    $('#tarjeta-extra', form).hidden = !tarjeta;

    const c = calcularVenta({ monto: f.monto, recargoPct: f.recargoPct, medio: f.medio, posnet: f.posnet, config: estado.config });
    $('#cobrar', form).innerHTML = !f.monto ? '' : c.recargo > 0
      ? `<div class="cobrar-detalle"><span>Precio</span><span>${pesos(c.monto)}</span></div>
         <div class="cobrar-detalle"><span>Recargo ${c.recargoPct}%</span><span>+ ${pesos(c.recargo)}</span></div>
         <div class="cobrar-total"><span>Cobrar</span><strong>${pesos(c.total)}</strong></div>`
      : `<div class="cobrar-total"><span>Cobrar</span><strong>${pesos(c.total)}</strong></div>`;
  }

  function abrirSelector() {
    const html = `
      <form class="buscar-producto" novalidate>
        <input type="search" class="buscador" placeholder="Buscá o escribí qué vendiste…" aria-label="Buscar o escribir producto" enterkeyhint="done" autocomplete="off" value="${esc(f.nombreLibre)}">
      </form>
      <ul class="lista-productos" role="list"></ul>`;
    hoja('¿Qué vendiste?', html, {
      alAbrir(cuerpo, cerrar) {
        const buscar = $('.buscador', cuerpo);
        const lista = $('.lista-productos', cuerpo);
        const pintarLista = () => {
          const q = normalizar(buscar.value);
          const items = estado.productos.filter((p) => normalizar(p.nombre).includes(q));
          const texto = buscar.value.trim();
          const exacto = items.some((p) => normalizar(p.nombre) === q);
          // opción de escribirlo a mano, para lo que todavía no está cargado en el stock
          const libre = texto && !exacto
            ? `<li><button type="button" class="item-producto item-libre" data-libre="1">
                 <span class="mini-foto sin-foto" aria-hidden="true">✏️</span>
                 <span class="item-texto"><strong>Vender "${esc(texto)}"</strong>
                   <small>Sin elegir del stock (no descuenta stock)</small></span>
               </button></li>`
            : '';
          lista.innerHTML = libre + (items.length
            ? items.map((p) => `
                <li><button type="button" class="item-producto" data-id="${p.id}">
                  ${miniFoto(p)}
                  <span class="item-texto"><strong>${esc(p.nombre)}</strong>
                    <small class="${p.cantidad <= avisoStock() ? 'poco' : ''}">${p.cantidad > 0 ? `Quedan ${p.cantidad}` : 'Sin stock'}</small></span>
                  <span class="item-precio">${pesos(p.precio)}</span>
                </button></li>`).join('')
            : texto ? '' : `<li>${iconoVacio(estado.productos.length
              ? 'Escribí para buscar en el stock'
              : 'Todavía no hay productos en Stock. Escribí arriba qué vendiste.', '✏️')}</li>`);
        };
        const usarLibre = () => {
          const texto = buscar.value.trim();
          if (!texto) return;
          f.producto = null;
          f.nombreLibre = texto;
          cerrar();
          pintar();
        };
        $('.buscar-producto', cuerpo).addEventListener('submit', (e) => {
          e.preventDefault();
          const q = normalizar(buscar.value.trim());
          const exacto = estado.productos.find((p) => normalizar(p.nombre) === q);
          if (exacto) lista.querySelector(`[data-id="${exacto.id}"]`)?.click();
          else usarLibre();
        });
        buscar.addEventListener('input', pintarLista);
        lista.addEventListener('click', (e) => {
          if (e.target.closest('[data-libre]')) { usarLibre(); return; }
          const b = e.target.closest('[data-id]');
          if (!b) return;
          const p = estado.productos.find((x) => x.id === b.dataset.id);
          f.producto = p;
          f.nombreLibre = '';
          f.rubro = p.rubro;
          if (f.montoAuto || !f.monto) { f.monto = p.precio * f.cantidad; f.montoAuto = true; }
          cerrar();
          pintar();
        });
        pintarLista();
        buscar.focus();
      },
    });
  }

  async function guardar(boton) {
    if (!(f.monto > 0)) { aviso('Falta poner el precio', { tipo: 'error' }); inMonto.focus(); return; }
    if (!f.medio) { aviso('Falta elegir cómo pagó', { tipo: 'error' }); $('#medios', form).scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    if (ES_TARJETA(f.medio) && !f.posnet) { aviso('Falta elegir el posnet', { tipo: 'error' }); return; }

    await ocupado(boton, async () => {
      try {
        const datos = {
          monto: f.monto, cantidad: f.cantidad, rubro: f.rubro || f.producto?.rubro || 'Otros', medio: f.medio,
          posnet: ES_TARJETA(f.medio) ? f.posnet : null, recargo_pct: ES_TARJETA(f.medio) ? f.recargoPct : 0,
          producto_id: f.producto?.id || null, producto_nombre: f.producto?.nombre || f.nombreLibre || null,
        };
        const r = await guardarVenta(datos);
        if (ES_TARJETA(f.medio)) {
          try {
            localStorage.setItem('pc-ultimo-posnet', f.posnet);
            localStorage.setItem('pc-ultimo-recargo', String(f.recargoPct));
          } catch { /* sin lugar */ }
        }
        const prod = f.producto;
        const eraTarjeta = ES_TARJETA(f.medio);
        f = nuevaVenta();
        f.rubro = rubros()[0];
        pintar();
        window.scrollTo({ top: 0, behavior: 'smooth' });

        const texto = r.pendiente ? 'Venta guardada en el celu. Se sube sola cuando vuelva internet.' : 'Venta guardada ✓';
        if (eraTarjeta && !r.pendiente) {
          aviso(texto, { boton: '📷 Foto del ticket', alTocar: () => sacarFotoTicket(r.venta.id) });
        } else {
          aviso(texto, { tipo: r.pendiente ? 'info' : 'ok' });
        }
        if (prod && r.quedan !== null && r.quedan !== undefined && r.quedan <= avisoStock()) {
          await alerta({
            icono: r.quedan === 0 ? '📦' : '⚠️',
            titulo: r.quedan === 0 ? '¡Se terminó!' : '¡Queda poco!',
            texto: r.quedan === 0
              ? `No quedan más <strong>${esc(prod.nombre)}</strong>.`
              : `${r.quedan === 1 ? 'Queda' : 'Quedan'} <strong>${r.quedan}</strong> de <strong>${esc(prod.nombre)}</strong>.`,
          });
        }
      } catch (e) {
        avisoError(e);
      }
    });
  }

  pintar();
}

export function miniFoto(p, clase = 'mini-foto') {
  const url = api.urlFoto(p.foto_path);
  return url
    ? `<img class="${clase}" src="${esc(url)}" alt="" loading="lazy">`
    : `<span class="${clase} sin-foto" aria-hidden="true">${{ Ojotas: '🩴', Pantuflas: '🥿' }[p.rubro] || '🧸'}</span>`;
}

export const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
