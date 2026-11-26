import { api } from '../api/index.js';
import { estado, puedeVender, cargarConfig } from '../estado.js';
import { leerNumero, fechaLocal } from '../calculos.js';
import { esc, $, $$, aviso, avisoError, confirmar, ocupado } from '../ui.js';
import { aplicarTema, temaGuardado } from '../tema.js';

export async function render(raiz) {
  const p = estado.perfil;
  raiz.innerHTML = `
    <h1 class="titulo-pantalla">Más</h1>
    <nav class="menu-grande">
      ${puedeVender() ? `
        <a class="opcion" href="#tickets"><span aria-hidden="true">🧾</span>Tickets de posnet</a>
        <a class="opcion" href="#historial"><span aria-hidden="true">📅</span>Historial de cierres</a>
        <a class="opcion" href="#ajustes"><span aria-hidden="true">⚙️</span>Ajustes y comisiones</a>` : ''}
      <button type="button" class="opcion" id="tema"><span aria-hidden="true">🌓</span>Modo claro / oscuro</button>
      <button type="button" class="opcion opcion-suave" id="salir"><span aria-hidden="true">🚪</span>Cerrar sesión</button>
    </nav>
    <p class="nota centro">Entraste como <strong>${esc(p?.nombre || '')}</strong>${p?.email ? ` (${esc(p.email)})` : ''}
      ${api.modo === 'prueba' ? '<br><strong>Modo de prueba:</strong> los datos quedan solo en este aparato.' : ''}</p>`;

  $('#tema', raiz).onclick = () => {
    const orden = ['auto', 'claro', 'oscuro'];
    const sig = orden[(orden.indexOf(temaGuardado()) + 1) % 3];
    aplicarTema(sig, true);
    aviso({ auto: 'Tema automático (como el celular)', claro: 'Modo claro', oscuro: 'Modo oscuro' }[sig]);
  };
  $('#salir', raiz).onclick = async () => {
    const ok = await confirmar({ titulo: '¿Cerrar sesión?', texto: 'Para volver a entrar vas a necesitar tu correo y tu clave.', si: 'Sí, salir' });
    if (!ok) return;
    await api.salir();
    location.hash = '';
    location.reload();
  };
}

export async function renderAjustes(raiz) {
  const c = await cargarConfig();
  const campoPct = (id, texto) => `
    <label class="campo campo-fila"><span>${texto}</span>
      <span class="campo-pct"><input id="${id}" class="input" inputmode="decimal" value="${String(c[id] ?? 0).replace('.', ',')}" aria-label="${texto} en porcentaje"><span>%</span></span>
    </label>`;
  const radio = (valor, texto) => `
    <label class="opcion-radio"><input type="radio" name="email_modo" value="${valor}" ${c.email_modo === valor ? 'checked' : ''}> ${texto}</label>`;

  raiz.innerHTML = `
    <h1 class="titulo-pantalla">Ajustes</h1>
    <form id="ajustes" novalidate>
      <section class="tarjeta">
        <h2 class="titulo-seccion">Comisiones de los posnet</h2>
        <p class="nota">El porcentaje total que te descuenta cada uno (con IVA). Sirve para ver cuánto te queda neto.</p>
        ${campoPct('comision_mp_debito', 'Mercado Pago · Débito')}
        ${campoPct('comision_mp_credito', 'Mercado Pago · Crédito')}
        ${campoPct('comision_getnet_debito', 'Getnet · Débito')}
        ${campoPct('comision_getnet_credito', 'Getnet · Crédito')}
        ${campoPct('comision_qr', 'QR')}
      </section>

      <section class="tarjeta">
        <h2 class="titulo-seccion">Fotos de tickets por email</h2>
        <label class="campo"><span class="etiqueta">Correo del local</span>
          <input id="email_tickets" class="input" type="email" inputmode="email" value="${esc(c.email_tickets || '')}" placeholder="ejemplo@gmail.com"></label>
        <div class="campo" role="radiogroup" aria-label="Cuándo mandar">
          <span class="etiqueta">¿Cuándo mandarlas?</span>
          ${radio('inmediato', 'Al momento, cada foto')}
          ${radio('diario', 'Un resumen a la noche')}
          ${radio('no', 'No mandar')}
        </div>
      </section>

      <section class="tarjeta">
        <h2 class="titulo-seccion">Stock</h2>
        <label class="campo campo-fila"><span>Avisar cuando queden</span>
          <span class="campo-pct"><input id="aviso_stock_bajo" class="input" inputmode="numeric" value="${c.aviso_stock_bajo}"><span>o menos</span></span></label>
        <div class="campo"><span class="etiqueta">Rubros</span>
          <div id="rubros" class="lista-rubros">${(c.rubros || []).map(filaRubro).join('')}</div>
          <button type="button" class="btn btn-chico btn-suave" id="agregar-rubro">＋ Agregar rubro</button>
        </div>
      </section>

      <button type="submit" class="btn btn-grande btn-principal">Guardar ajustes</button>
    </form>

    <section class="tarjeta">
      <h2 class="titulo-seccion">Copia de seguridad</h2>
      <p class="nota">${api.modo === 'nube'
        ? 'Todo se guarda en la nube y cada noche se hace una copia automática. Si querés, podés bajar una copia a este aparato.'
        : 'En el modo de prueba los datos están solo en este aparato.'}</p>
      <button type="button" class="btn btn-grande btn-suave" id="exportar">⬇️ Bajar copia</button>
    </section>`;

  const form = $('#ajustes', raiz);
  $('#agregar-rubro', raiz).onclick = () => {
    $('#rubros', raiz).insertAdjacentHTML('beforeend', filaRubro(''));
    $$('#rubros input', raiz).at(-1).focus();
  };
  $('#rubros', raiz).addEventListener('click', (e) => {
    if (e.target.closest('[data-quitar]')) e.target.closest('.rubro').remove();
  });

  form.onsubmit = (e) => {
    e.preventDefault();
    ocupado(e.submitter || $('button[type=submit]', form), async () => {
      try {
        const email = $('#email_tickets', form).value.trim();
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('El correo no parece bien escrito');
        const rubros = $$('#rubros input', form).map((i) => i.value.trim()).filter(Boolean);
        estado.config = await api.guardarConfig({
          ...Object.fromEntries(['comision_mp_debito', 'comision_mp_credito', 'comision_getnet_debito', 'comision_getnet_credito', 'comision_qr']
            .map((k) => [k, Math.min(100, Math.max(0, leerNumero($(`#${k}`, form).value)))])),
          email_tickets: email || null,
          email_modo: form.email_modo.value || 'diario',
          aviso_stock_bajo: Math.max(0, parseInt($('#aviso_stock_bajo', form).value, 10) || 0),
          rubros: rubros.length ? [...new Set(rubros)] : ['Otros'],
        });
        aviso('Ajustes guardados ✓');
      } catch (err) { avisoError(err); }
    });
  };

  $('#exportar', raiz).onclick = (e) => ocupado(e.target, async () => {
    try {
      const datos = await api.exportarTodo();
      const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pequeno-capricho-copia-${fechaLocal()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      aviso('Copia bajada ✓');
    } catch (err) { avisoError(err); }
  });
}

function filaRubro(nombre) {
  return `<div class="rubro"><input class="input" value="${esc(nombre)}" aria-label="Nombre del rubro">
    <button type="button" class="btn-cerrar" data-quitar aria-label="Quitar rubro">✕</button></div>`;
}
