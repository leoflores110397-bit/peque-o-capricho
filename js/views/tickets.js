import { api } from '../api/index.js';
import { estado } from '../estado.js';
import { pesos, nombreMedio, horaLocal, fechaLocal, fechaLarga, ES_TARJETA, POSNETS } from '../calculos.js';
import { esc, $, aviso, avisoError, elegirFoto, achicarFoto, iconoVacio } from '../ui.js';

/** Saca la foto del ticket, la sube y (si está configurado) la manda por email. */
export async function sacarFotoTicket(ventaId = null) {
  const archivo = await elegirFoto({ camara: true });
  if (!archivo) return null;
  aviso('Subiendo foto…', { tipo: 'info', duracion: 20000 });
  try {
    const foto = await achicarFoto(archivo, 1600, 0.85);
    const t = await api.subirTicket(foto, ventaId);
    if (estado.config?.email_modo === 'inmediato' && api.modo === 'nube') {
      try {
        await api.enviarTicket(t.id);
        aviso('Foto guardada y enviada por email ✓');
      } catch (e) {
        aviso(`Foto guardada ✓. El email no salió: ${e.message}`, { tipo: 'info', duracion: 6000 });
      }
    } else {
      aviso('Foto del ticket guardada ✓');
    }
    return t;
  } catch (e) {
    avisoError(e);
    return null;
  }
}

export async function render(raiz) {
  const hoy = fechaLocal();
  raiz.innerHTML = `<div class="cargando-pantalla"><span class="girando"></span></div>`;
  const [tickets, ventas] = await Promise.all([api.ticketsDelDia(hoy), api.ventasDelDia(hoy)]);
  const ventasTarjeta = ventas.filter((v) => !v.anulada && (ES_TARJETA(v.medio) || v.medio === 'qr'));
  const urls = await Promise.all(tickets.map((t) => api.urlTicket(t.foto_path).catch(() => null)));
  const modoEmail = estado.config?.email_modo;
  const textoEmail = !estado.config?.email_tickets || modoEmail === 'no'
    ? 'No se mandan por email (se puede activar en Ajustes).'
    : modoEmail === 'inmediato'
      ? `Cada foto se manda al momento a ${esc(estado.config.email_tickets)}.`
      : `A la noche llega un resumen con todas las fotos a ${esc(estado.config.email_tickets)}.`;

  raiz.innerHTML = `
    <h1 class="titulo-pantalla">Tickets de posnet <small>${esc(fechaLarga(hoy))}</small></h1>
    <button type="button" class="btn btn-grande btn-principal" id="sacar">📷 Sacar foto del ticket</button>
    <p class="nota">${textoEmail}</p>
    ${tickets.length ? `<ul class="lista-tickets" role="list">${tickets.map((t, i) => filaTicket(t, urls[i], ventasTarjeta)).join('')}</ul>`
      : iconoVacio('Todavía no hay fotos de tickets hoy', '🧾')}`;

  $('#sacar', raiz).onclick = async () => {
    // si hay una sola venta con tarjeta sin ticket, se vincula sola
    const sinTicket = ventasTarjeta.filter((v) => !tickets.some((t) => t.venta_id === v.id));
    const t = await sacarFotoTicket(sinTicket.length === 1 ? sinTicket[0].id : null);
    if (t) render(raiz);
  };

  raiz.querySelector('.lista-tickets')?.addEventListener('change', async (e) => {
    if (!e.target.matches('select[data-vincular]')) return;
    try {
      await api.vincularTicket(e.target.dataset.vincular, e.target.value);
      aviso('Ticket vinculado ✓');
    } catch (err) { avisoError(err); }
  });

  raiz.querySelector('.lista-tickets')?.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const t = tickets.find((x) => x.id === b.dataset.id);
    if (b.dataset.accion === 'enviar') {
      b.disabled = true;
      try { await api.enviarTicket(t.id); aviso('Enviado por email ✓'); render(raiz); } catch (err) { avisoError(err); b.disabled = false; }
    }
    if (b.dataset.accion === 'leer') {
      b.disabled = true;
      b.textContent = 'Leyendo…';
      try {
        const r = await api.leerTicket(t.id);
        aviso(r.coincide === true ? 'El ticket coincide con la venta ✓' : r.coincide === false ? 'Ojo: el ticket no coincide con la venta' : 'Ticket leído', { tipo: r.coincide === false ? 'error' : 'ok' });
        render(raiz);
      } catch (err) { avisoError(err); b.disabled = false; b.textContent = '🤖 Revisar con IA'; }
    }
  });
}

function filaTicket(t, url, ventas) {
  const posnetLeido = POSNETS.find((p) => p.id === t.posnet_leido)?.nombre || t.posnet_leido;
  const lectura = t.monto_leido !== null && t.monto_leido !== undefined
    ? `<div class="lectura ${t.coincide === false ? 'no-coincide' : t.coincide ? 'coincide' : ''}">
         🤖 Leído: <strong>${pesos(t.monto_leido)}</strong>${posnetLeido ? ` · ${esc(posnetLeido)}` : ''}
         ${t.coincide === true ? ' · ✓ coincide' : t.coincide === false ? ' · ✗ no coincide con la venta' : ''}
       </div>` : '';
  return `
    <li class="ticket">
      ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="Foto del ticket" loading="lazy"></a>` : '<div class="ticket-sin-foto">🧾</div>'}
      <div class="ticket-texto">
        <strong>${horaLocal(t.creado_en)}</strong>
        <label class="campo campo-chico"><span class="etiqueta">Venta</span>
          <select class="input" data-vincular="${t.id}">
            <option value="">— Sin elegir —</option>
            ${ventas.map((v) => `<option value="${v.id}" ${v.id === t.venta_id ? 'selected' : ''}>
              ${horaLocal(v.creado_en)} · ${esc(nombreMedio(v.medio, v.posnet))} · ${pesos(v.total)}</option>`).join('')}
          </select></label>
        ${lectura}
        ${t.enviado_en ? '<small>✉️ Enviado por email</small>' : ''}
        <div class="ticket-botones">
          ${api.modo === 'nube' && !t.enviado_en && estado.config?.email_tickets && estado.config?.email_modo !== 'no'
            ? `<button type="button" class="btn btn-chico btn-suave" data-accion="enviar" data-id="${t.id}">✉️ Mandar ahora</button>` : ''}
          ${api.modo === 'nube' ? `<button type="button" class="btn btn-chico btn-suave" data-accion="leer" data-id="${t.id}">🤖 Revisar con IA</button>` : ''}
        </div>
      </div>
    </li>`;
}
