import { api } from '../api/index.js';
import { pendientes } from '../estado.js';
import { resumenDia, cuentaCaja, textoDiferencia, pesos, leerNumero, fechaLocal, fechaLarga, horaLocal } from '../calculos.js';
import { $, aviso, avisoError, confirmar, ocupado, campoPesos, esc, hoja } from '../ui.js';

export async function render(raiz) {
  const hoy = fechaLocal();
  raiz.innerHTML = `<div class="cargando-pantalla"><span class="girando"></span></div>`;
  const [caja, ventas] = await Promise.all([api.caja(hoy), api.ventasDelDia(hoy)]);
  const efectivoSinSubir = pendientes().filter((v) => v.medio === 'efectivo').reduce((s, v) => s + v.monto, 0);
  const r = resumenDia(ventas);
  const efectivo = r.efectivo + efectivoSinSubir;

  const cabeza = `<h1 class="titulo-pantalla">Caja <small>${esc(fechaLarga(hoy))}</small></h1>`;

  // 1) Caja sin abrir
  if (!caja) {
    raiz.innerHTML = `${cabeza}
      <form class="tarjeta" id="abrir">
        <p class="texto-grande">¿Con cuánta plata en efectivo empezás el día?</p>
        <label class="campo">
          <span class="etiqueta">Efectivo inicial</span>
          <div class="campo-plata"><span aria-hidden="true">$</span><input id="apertura" inputmode="numeric" placeholder="0" aria-label="Efectivo inicial en pesos"></div>
        </label>
        <button class="btn btn-grande btn-principal" type="submit">Abrir caja</button>
      </form>`;
    campoPesos($('#apertura', raiz));
    $('#abrir', raiz).onsubmit = (e) => {
      e.preventDefault();
      ocupado(e.submitter || $('button', e.target), async () => {
        try {
          await api.abrirCaja(leerNumero($('#apertura', raiz).value));
          aviso('Caja abierta ✓');
          render(raiz);
        } catch (err) { avisoError(err); }
      });
    };
    return;
  }

  const { esperado } = cuentaCaja(caja.apertura, efectivo);

  // 2) Caja cerrada
  if (caja.estado === 'cerrada') {
    const dif = Number(caja.diferencia);
    raiz.innerHTML = `${cabeza}
      <section class="tarjeta tarjeta-cerrada">
        <div class="sello">🔒 Caja cerrada${caja.cerrada_en ? ` a las ${horaLocal(caja.cerrada_en)}` : ''}</div>
        <dl class="filas">
          <div><dt>Efectivo inicial</dt><dd>${pesos(caja.apertura)}</dd></div>
          <div><dt>Efectivo vendido</dt><dd>${pesos(caja.efectivo_ventas)}</dd></div>
          <div class="fila-fuerte"><dt>Tendría que haber</dt><dd>${pesos(caja.efectivo_esperado)}</dd></div>
          <div><dt>Contaste</dt><dd>${pesos(caja.efectivo_contado)}</dd></div>
        </dl>
        <div class="diferencia ${claseDif(dif)}">${esc(textoDiferencia(dif))}</div>
        ${caja.nota ? `<p class="nota">Nota: ${esc(caja.nota)}</p>` : ''}
      </section>
      ${resumenMedios(r)}
      <button type="button" class="btn btn-grande btn-suave" id="reabrir">Reabrir caja</button>`;
    $('#reabrir', raiz).onclick = async (e) => {
      const ok = await confirmar({ titulo: '¿Reabrir la caja?', texto: 'Vas a poder seguir vendiendo y anular ventas. Después la cerrás de nuevo.', si: 'Sí, reabrir' });
      if (!ok) return;
      ocupado(e.target, async () => {
        try { await api.reabrirCaja(); aviso('Caja reabierta'); render(raiz); } catch (err) { avisoError(err); }
      });
    };
    return;
  }

  // 3) Caja abierta
  raiz.innerHTML = `${cabeza}
    <section class="tarjeta">
      <div class="sello sello-abierta">🟢 Caja abierta${caja.abierta_en ? ` desde las ${horaLocal(caja.abierta_en)}` : ''}</div>
      <dl class="filas">
        <div><dt>Efectivo inicial</dt><dd>${pesos(caja.apertura)}</dd></div>
        <div><dt>Efectivo vendido</dt><dd>${pesos(efectivo)}</dd></div>
        <div class="fila-fuerte"><dt>Tendría que haber</dt><dd>${pesos(esperado)}</dd></div>
      </dl>
      <button type="button" class="btn btn-chico btn-suave" id="cambiar-apertura">Corregir efectivo inicial</button>
    </section>
    ${resumenMedios(r)}
    <form class="tarjeta" id="cerrar">
      <h2 class="titulo-seccion">Cierre de caja</h2>
      <label class="campo">
        <span class="etiqueta">Contá el efectivo. ¿Cuánto hay?</span>
        <div class="campo-plata"><span aria-hidden="true">$</span><input id="contado" inputmode="numeric" placeholder="0" aria-label="Efectivo contado en pesos"></div>
      </label>
      <div class="diferencia" id="dif" aria-live="polite"></div>
      <label class="campo">
        <span class="etiqueta">Nota <small>(si querés)</small></span>
        <input id="nota" class="input" placeholder="Ej: saqué $5.000 para mercadería">
      </label>
      <button class="btn btn-grande btn-principal" type="submit">Cerrar caja</button>
    </form>`;

  const inContado = $('#contado', raiz);
  campoPesos(inContado, () => {
    const vacio = inContado.value.trim() === '';
    const { diferencia } = cuentaCaja(caja.apertura, efectivo, vacio ? '' : leerNumero(inContado.value));
    const el = $('#dif', raiz);
    el.className = `diferencia ${vacio ? '' : claseDif(diferencia)}`;
    el.textContent = vacio ? '' : textoDiferencia(diferencia);
  });

  $('#cambiar-apertura', raiz).onclick = () => {
    hoja('Corregir efectivo inicial', `
      <form id="form-apertura">
        <label class="campo"><span class="etiqueta">¿Con cuánto efectivo empezaste?</span>
          <div class="campo-plata"><span aria-hidden="true">$</span>
            <input id="nueva-apertura" inputmode="numeric" value="${new Intl.NumberFormat('es-AR').format(caja.apertura)}" aria-label="Efectivo inicial en pesos"></div>
        </label>
        <button type="submit" class="btn btn-grande btn-principal">Guardar</button>
      </form>`, {
      alAbrir(cuerpo, cerrar) {
        campoPesos($('#nueva-apertura', cuerpo));
        $('#form-apertura', cuerpo).onsubmit = (e) => {
          e.preventDefault();
          ocupado($('button', e.target), async () => {
            try {
              await api.abrirCaja(leerNumero($('#nueva-apertura', cuerpo).value));
              aviso('Efectivo inicial corregido ✓');
              cerrar();
              render(raiz);
            } catch (err) { avisoError(err); }
          });
        };
      },
    });
  };

  $('#cerrar', raiz).onsubmit = async (e) => {
    e.preventDefault();
    if (inContado.value.trim() === '') { aviso('Poné cuánto efectivo contaste', { tipo: 'error' }); inContado.focus(); return; }
    if (pendientes().length) {
      aviso('Hay ventas sin subir. Esperá a tener internet para cerrar la caja.', { tipo: 'error' });
      return;
    }
    const contado = leerNumero(inContado.value);
    const { diferencia } = cuentaCaja(caja.apertura, efectivo, contado);
    const ok = await confirmar({
      titulo: '¿Cerrar la caja?',
      texto: `Contaste <strong>${pesos(contado)}</strong>. ${esc(textoDiferencia(diferencia))}.`,
      si: 'Sí, cerrar caja',
    });
    if (!ok) return;
    ocupado(e.submitter || $('button[type=submit]', e.target), async () => {
      try {
        await api.cerrarCaja(contado, $('#nota', raiz).value.trim());
        aviso('Caja cerrada ✓');
        render(raiz);
      } catch (err) { avisoError(err); }
    });
  };
}

function claseDif(d) {
  if (d === null || d === undefined || Number.isNaN(d)) return '';
  if (Math.abs(d) < 0.01) return 'dif-justo';
  return d > 0 ? 'dif-sobra' : 'dif-falta';
}

function resumenMedios(r) {
  const tarjetas = r.porMedio.debito_mercadopago + r.porMedio.debito_getnet + r.porMedio.credito_mercadopago + r.porMedio.credito_getnet;
  return `
    <section class="tarjeta">
      <h2 class="titulo-seccion">Lo vendido hoy</h2>
      <dl class="filas">
        <div><dt>Efectivo</dt><dd>${pesos(r.porMedio.efectivo)}</dd></div>
        <div><dt>Transferencia</dt><dd>${pesos(r.porMedio.transferencia)}</dd></div>
        <div><dt>QR</dt><dd>${pesos(r.porMedio.qr)}</dd></div>
        <div><dt>Tarjetas</dt><dd>${pesos(tarjetas)}</dd></div>
        <div class="fila-fuerte"><dt>Total</dt><dd>${pesos(r.total)}</dd></div>
      </dl>
    </section>`;
}
