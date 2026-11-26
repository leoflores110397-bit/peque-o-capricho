// Arranque de la app: login, menú de abajo y cambio de pantallas.
import { api } from './api/index.js';
import { estado, puedeVender, cargarConfig, cargarProductos, subirPendientes, pendientes } from './estado.js';
import { esc, $, $$, aviso, avisoError, ocupado } from './ui.js';
import { aplicarTema } from './tema.js';
import * as vender from './views/vender.js';
import * as hoy from './views/hoy.js';
import * as caja from './views/caja.js';
import * as stock from './views/stock.js';
import * as tickets from './views/tickets.js';
import * as historial from './views/historial.js';
import * as mas from './views/mas.js';

aplicarTema();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => aplicarTema());

const PANTALLAS = {
  vender: { titulo: 'Vender', render: vender.render, venta: true },
  hoy: { titulo: 'Hoy', render: hoy.render, venta: true },
  caja: { titulo: 'Caja', render: caja.render, venta: true },
  stock: { titulo: 'Stock', render: stock.render },
  mas: { titulo: 'Más', render: mas.render },
  tickets: { titulo: 'Tickets', render: tickets.render, venta: true, menu: 'mas' },
  historial: { titulo: 'Historial', render: historial.render, venta: true, menu: 'mas' },
  ajustes: { titulo: 'Ajustes', render: mas.renderAjustes, venta: true, menu: 'mas' },
};

const MENU = [
  { id: 'vender', texto: 'Vender', icono: '🛒', venta: true },
  { id: 'hoy', texto: 'Hoy', icono: '📊', venta: true },
  { id: 'caja', texto: 'Caja', icono: '💰', venta: true },
  { id: 'stock', texto: 'Stock', icono: '📦' },
  { id: 'mas', texto: 'Más', icono: '☰' },
];

const app = $('#app');

async function iniciar() {
  try {
    const s = await api.sesion();
    if (!s) return mostrarLogin();
    estado.perfil = await api.perfil();
    if (!estado.perfil) return mostrarLogin();
  } catch (e) {
    // sin internet: seguimos con lo último que sabíamos del usuario
    estado.perfil = JSON.parse(localStorage.getItem('pc-perfil') || 'null');
    if (!estado.perfil) return mostrarLogin(e.message);
  }
  localStorage.setItem('pc-perfil', JSON.stringify(estado.perfil));
  await Promise.all([cargarConfig().catch(() => null), cargarProductos().catch(() => null)]);
  if (!estado.config) estado.config = {};
  armarPantalla();
  api.alCambiarSesion(() => { localStorage.removeItem('pc-perfil'); location.reload(); });
  window.addEventListener('hashchange', mostrar);
  mostrar();
  sincronizar();
  window.addEventListener('online', sincronizar);
  setInterval(sincronizar, 60_000);
}

function mostrarLogin(mensaje = '') {
  const recordado = localStorage.getItem('pc-email') || '';
  app.innerHTML = `
    <main class="login">
      <img src="icons/logo-512.png" alt="Pequeño Capricho Juguetería" class="login-logo" width="220" height="220">
      <form id="form-login" class="tarjeta" novalidate>
        ${api.modo === 'prueba' ? '<p class="franja-aviso">Modo de prueba: poné cualquier correo y clave.</p>' : ''}
        <label class="campo"><span class="etiqueta">Tu correo</span>
          <input class="input" id="email" type="email" inputmode="email" autocomplete="username" value="${esc(recordado)}" required></label>
        <label class="campo"><span class="etiqueta">Tu clave</span>
          <input class="input input-clave" id="clave" type="password" inputmode="numeric" autocomplete="current-password" required></label>
        <p class="error" id="error-login" role="alert">${esc(mensaje)}</p>
        <button type="submit" class="btn btn-grande btn-principal">Entrar</button>
      </form>
    </main>`;
  const form = $('#form-login');
  (recordado ? $('#clave') : $('#email')).focus();
  form.onsubmit = (e) => {
    e.preventDefault();
    const email = $('#email').value.trim();
    const clave = $('#clave').value;
    if (!email || !clave) { $('#error-login').textContent = 'Escribí tu correo y tu clave'; return; }
    ocupado($('button[type=submit]', form), async () => {
      try {
        await api.entrar(email, clave);
        localStorage.setItem('pc-email', email);
        location.hash = '';
        await iniciar();
      } catch (err) {
        $('#error-login').textContent = err.message;
      }
    });
  };
}

function armarPantalla() {
  const menu = MENU.filter((m) => !m.venta || puedeVender());
  app.innerHTML = `
    <header class="cabecera">
      <img src="icons/logo-96.png" alt="" width="44" height="44">
      <div class="cabecera-texto"><strong>Pequeño Capricho</strong><small>Juguetería</small></div>
      <span class="estado-red" id="estado-red" hidden></span>
    </header>
    <main id="pantalla" class="pantalla" tabindex="-1"></main>
    <nav class="menu-abajo" aria-label="Menú principal">
      ${menu.map((m) => `<a href="#${m.id}" data-menu="${m.id}"><span class="menu-icono" aria-hidden="true">${m.icono}</span>${m.texto}</a>`).join('')}
    </nav>`;
}

let renderActual = 0;
async function mostrar() {
  if (history.state?.hoja) return; // cerrar una hoja no cambia de pantalla
  $$('.hoja-fondo').forEach((h) => h.remove());
  const inicio = puedeVender() ? 'vender' : 'stock';
  let id = location.hash.slice(1) || inicio;
  const p = PANTALLAS[id];
  if (!p || (p.venta && !puedeVender())) {
    id = inicio;
    history.replaceState(history.state, '', `#${id}`);
  }
  const pantalla = PANTALLAS[id];
  $$('[data-menu]').forEach((a) => {
    const activo = a.dataset.menu === id || a.dataset.menu === pantalla.menu;
    a.classList.toggle('activo', activo);
    if (activo) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${pantalla.titulo} · Pequeño Capricho`;
  const contenedor = $('#pantalla');
  const n = ++renderActual;
  const raiz = document.createElement('div');
  raiz.className = `vista vista-${id}`;
  contenedor.replaceChildren(raiz);
  window.scrollTo(0, 0);
  try {
    await pantalla.render(raiz);
  } catch (e) {
    if (n !== renderActual) return;
    raiz.innerHTML = `<div class="tarjeta centro"><p class="texto-grande">😕 No se pudo cargar</p>
      <p>${esc(e.message)}</p><button type="button" class="btn btn-grande btn-principal" id="reintentar">Probar de nuevo</button></div>`;
    $('#reintentar', raiz).onclick = mostrar;
  }
}

async function sincronizar() {
  const el = $('#estado-red');
  const cant = pendientes().length;
  if (cant && navigator.onLine) {
    try {
      const n = await subirPendientes();
      if (n) {
        aviso(n === 1 ? 'Se subió 1 venta que estaba en el celu ✓' : `Se subieron ${n} ventas que estaban en el celu ✓`);
        await cargarProductos().catch(() => {});
      }
    } catch (e) { /* se reintenta solo */ }
  }
  const quedan = pendientes().length;
  if (el) {
    el.hidden = navigator.onLine && !quedan;
    el.textContent = !navigator.onLine ? 'Sin internet' : quedan ? `${quedan} sin subir` : '';
  }
}
window.addEventListener('offline', sincronizar);

// ---------- instalación y actualizaciones ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing;
      nuevo?.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
          aviso('Hay una versión nueva de la app', { tipo: 'info', boton: 'Actualizar', alTocar: () => nuevo.postMessage('actualizar') });
        }
      });
    });
  }).catch(() => {});
  // recargar solo cuando se actualiza (no la primera vez que se instala)
  const habiaVersion = Boolean(navigator.serviceWorker.controller);
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (habiaVersion && !recargando) { recargando = true; location.reload(); }
  });
}

iniciar().catch(avisoError);
