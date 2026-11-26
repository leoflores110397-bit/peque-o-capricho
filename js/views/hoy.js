import { api } from '../api/index.js';
import { pendientes, cargarProductos } from '../estado.js';
import {
  CASILLEROS, resumenDia, pesos, nombreMedio, horaLocal, fechaLocal, fechaLarga, sumarDias, ES_TARJETA,
} from '../calculos.js';
import { esc, $, aviso, avisoError, confirmar, iconoVacio } from '../ui.js';

let fecha = null;

/** Permite abrir "Hoy" en otro día (desde el historial). */
export function verDia(f) { fecha = f; }

export async function render(raiz) {
  const hoy = fechaLocal();
  if (!fecha || fecha > hoy) fecha = hoy;
  const esHoy = fecha === hoy;

  raiz.innerHTML = `<div class="cargando-pantalla"><span class="girando"></span></div>`;
  const [ventasNube, caja] = await Promise.all([api.ventasDelDia(fecha), api.caja(fecha)]);
  const enCelu = esHoy ? pendientes().map((v) => ({ ...v, pendiente: true, ...calcPend(v) })) : [];
  const ventas = [...enCelu, ...ventasNube];
  const r = resumenDia(ventas);
  const cajaCerrada = caja?.estado === 'cerrada';

  raiz.innerHTML = `
    <nav class="selector-dia" aria-label="Elegir día">
      <button type="button" class="btn-redondo" id="dia-ant" aria-label="Día anterior">‹</button>
      <div class="selector-dia-texto"><strong>${esHoy ? 'Hoy' : esc(fechaLarga(fecha))}</strong>
        ${esHoy ? `<small>${esc(fechaLarga(fecha))}</small>` : ''}</div>
      <button type="button" class="btn-redondo" id="dia-sig" aria-label="Día siguiente" ${esHoy ? 'disabled' : ''}>›</button>
    </nav>

    <section class="tarjeta tarjeta-total">
      <span>Vendiste ${esHoy ? 'hoy' : 'ese día'}</span>
      <strong class="numero-grande">${pesos(r.total)}</strong>
      <span>${r.cantidad} ${r.cantidad === 1 ? 'venta' : 'ventas'}${r.anuladas ? ` · ${r.anuladas} anulada${r.anuladas > 1 ? 's' : ''}` : ''}</span>
      ${r.recargos.monto ? `<span class="total-desglose">Productos ${pesos(r.monto)} · Recargos ${pesos(r.recargos.monto)}</span>` : ''}
    </section>

    <section class="casilleros" aria-label="Total por medio de pago">
      ${CASILLEROS.map((c) => `
        <div class="casillero ${r.porMedio[c.clave] ? '' : 'vacio-suave'}">
          <span>${esc(c.nombre)}${r.cantidadPorMedio[c.clave] ? ` (${r.cantidadPorMedio[c.clave]})` : ''}</span><strong>${pesos(r.porMedio[c.clave])}</strong>
        </div>`).join('')}
    </section>

    <section class="tarjeta">
      <h2 class="titulo-seccion">Tarjetas y QR</h2>
      <dl class="filas">
        <div><dt>Recargos cobrados</dt><dd>${r.recargos.cantidad} · ${pesos(r.recargos.monto)}</dd></div>
        <div><dt>Comisiones de posnet</dt><dd>− ${pesos(r.comisiones)}</dd></div>
        <div><dt>A acreditar Mercado Pago</dt><dd>${pesos(r.aAcreditar.mercadopago)}</dd></div>
        <div><dt>A acreditar Getnet</dt><dd>${pesos(r.aAcreditar.getnet)}</dd></div>
        ${r.aAcreditar.qr ? `<div><dt>A acreditar QR</dt><dd>${pesos(r.aAcreditar.qr)}</dd></div>` : ''}
        <div class="fila-fuerte"><dt>Total a acreditar (neto)</dt><dd>${pesos(r.aAcreditar.total)}</dd></div>
      </dl>
      <p class="nota">Lo neto es lo que queda después de la comisión de cada posnet (se configura en Más › Ajustes).</p>
    </section>

    <section class="tarjeta">
      <dl class="filas">
        <div class="fila-fuerte"><dt>Ganancia de productos</dt><dd>${pesos(r.ganancia)}</dd></div>
      </dl>
      <p class="nota">Precio de venta menos costo, solo de lo vendido desde el stock. Los recargos no se suman.</p>
    </section>

    <section>
      <h2 class="titulo-seccion">Ventas</h2>
      ${ventas.length ? `<ul class="lista-ventas" role="list">${ventas.map((v) => filaVenta(v, cajaCerrada)).join('')}</ul>`
        : iconoVacio(esHoy ? 'Todavía no hay ventas hoy' : 'No hubo ventas ese día', '🛍️')}
    </section>`;

  $('#dia-ant', raiz).onclick = () => { fecha = sumarDias(fecha, -1); render(raiz); };
  $('#dia-sig', raiz).onclick = () => { fecha = sumarDias(fecha, 1); render(raiz); };

  raiz.querySelector('.lista-ventas')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-anular]');
    if (!b) return;
    const v = ventas.find((x) => x.id === b.dataset.anular);
    const ok = await confirmar({
      titulo: '¿Anular esta venta?',
      texto: `${esc(v.producto_nombre || v.rubro)} · <strong>${pesos(v.total)}</strong> en ${esc(nombreMedio(v.medio, v.posnet))}.
              ${v.producto_id ? '<br>El producto vuelve al stock.' : ''}`,
      si: 'Sí, anular', no: 'No, dejarla', peligro: true,
    });
    if (!ok) return;
    try {
      await api.anularVenta(v.id);
      aviso('Venta anulada');
      await cargarProductos().catch(() => {});
      render(raiz);
    } catch (err) {
      avisoError(err);
    }
  });
}

function calcPend(v) {
  // las ventas sin subir todavía no tienen los totales calculados por el servidor
  const recargo = ES_TARJETA(v.medio) ? Math.round(v.monto * (v.recargo_pct || 0)) / 100 : 0;
  return { id: v.client_id, recargo, total: v.monto + recargo, comision: 0, costo: null };
}

function filaVenta(v, cajaCerrada) {
  const detalle = [
    v.cantidad > 1 ? `${v.cantidad} u.` : '',
    nombreMedio(v.medio, v.posnet),
    v.recargo > 0 ? `recargo ${Number(v.recargo_pct)}%` : '',
    v.vendido_por ? `vendió ${String(v.vendido_por).split(' ')[0]}` : '',
  ].filter(Boolean).join(' · ');
  return `
    <li class="venta ${v.anulada ? 'anulada' : ''}">
      <span class="venta-hora">${horaLocal(v.creado_en)}</span>
      <span class="venta-texto">
        <strong>${esc(v.producto_nombre || v.rubro)}</strong>
        <small>${esc(detalle)}</small>
        ${v.anulada ? '<span class="etiqueta-estado rojo">Anulada</span>' : ''}
        ${v.pendiente ? '<span class="etiqueta-estado amarillo">Sin subir (falta internet)</span>' : ''}
      </span>
      <span class="venta-monto">${pesos(v.total)}</span>
      ${!v.anulada && !v.pendiente && !cajaCerrada
        ? `<button type="button" class="btn btn-chico btn-suave" data-anular="${v.id}">Anular</button>` : ''}
    </li>`;
}
