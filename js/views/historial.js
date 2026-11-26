import { api } from '../api/index.js';
import { agruparPeriodo, pesos, textoDiferencia, fechaLocal, sumarDias } from '../calculos.js';
import { esc, $, $$, iconoVacio } from '../ui.js';
import { verDia } from './hoy.js';

let periodo = 'dia';
const RANGO = { dia: 31, semana: 7 * 12, mes: 366 };

export async function render(raiz) {
  raiz.innerHTML = `
    <h1 class="titulo-pantalla">Historial</h1>
    <div class="pestanas" role="tablist">
      ${[['dia', 'Por día'], ['semana', 'Por semana'], ['mes', 'Por mes']].map(([id, txt]) =>
        `<button type="button" role="tab" class="pestana" data-p="${id}" aria-selected="${id === periodo}">${txt}</button>`).join('')}
    </div>
    <div id="contenido"><div class="cargando-pantalla"><span class="girando"></span></div></div>`;

  $$('[data-p]', raiz).forEach((b) => { b.onclick = () => { periodo = b.dataset.p; render(raiz); }; });

  const hoy = fechaLocal();
  const filas = await api.resumenPorDia(sumarDias(hoy, -RANGO[periodo]), hoy);
  const grupos = agruparPeriodo(filas.map((f) => ({ ...f, fecha: String(f.fecha).slice(0, 10) })), periodo);

  $('#contenido', raiz).innerHTML = grupos.length
    ? `<ul class="lista-historial" role="list">${grupos.map(fila).join('')}</ul>`
    : iconoVacio('Todavía no hay cierres ni ventas para mostrar', '📅');

  raiz.querySelector('.lista-historial')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dia]');
    if (!b) return;
    verDia(b.dataset.dia);
    location.hash = '#hoy';
  });
}

function fila(g) {
  const dif = g.diferencia;
  const estadoCaja = periodo === 'dia'
    ? (g.estado === 'cerrada' ? `<span class="dif ${claseDif(dif)}">${esc(textoDiferencia(Number(dif)))}</span>`
      : g.estado === 'abierta' ? '<span class="etiqueta-estado amarillo">Caja sin cerrar</span>' : '<span class="etiqueta-estado">Sin caja</span>')
    : dif !== null ? `<span class="dif ${claseDif(dif)}">Diferencia de caja: ${esc(textoDiferencia(dif))}</span>` : '';
  const contenido = `
      <div class="historial-cabeza">
        <strong>${esc(g.etiqueta)}</strong>
        <span class="historial-total">${pesos(g.total)}</span>
      </div>
      <div class="historial-detalle">
        <span>${g.ventas} ${Number(g.ventas) === 1 ? 'venta' : 'ventas'}</span>
        <span>Efectivo ${pesos(g.efectivo)}</span>
        <span>Transferencia ${pesos(g.transferencia)}</span>
        <span>QR ${pesos(g.qr)}</span>
        <span>Tarjetas ${pesos(g.tarjetas)}</span>
        <span>Recargos ${pesos(g.recargos)}</span>
        <span>Ganancia ${pesos(g.ganancia)}</span>
      </div>
      ${estadoCaja}`;
  return periodo === 'dia'
    ? `<li><button type="button" class="historial" data-dia="${g.fecha}" aria-label="Ver ventas del ${esc(g.etiqueta)}">${contenido}</button></li>`
    : `<li class="historial">${contenido}</li>`;
}

function claseDif(d) {
  d = Number(d);
  if (Math.abs(d) < 0.01) return 'dif-justo';
  return d > 0 ? 'dif-sobra' : 'dif-falta';
}
