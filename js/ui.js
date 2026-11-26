// Piezas de interfaz compartidas: avisos, confirmaciones, hojas, fotos.

/** Escapa texto para meterlo en HTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

// ---------- aviso corto abajo ("Venta guardada") ----------
let temporizador;
export function aviso(texto, { tipo = 'ok', boton, alTocar, duracion = 3500 } = {}) {
  let el = $('#aviso');
  if (!el) {
    el = document.createElement('div');
    el.id = 'aviso';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.className = `aviso aviso-${tipo}`;
  el.innerHTML = `<span>${esc(texto)}</span>${boton ? `<button type="button" class="aviso-boton">${esc(boton)}</button>` : ''}`;
  if (boton) {
    $('.aviso-boton', el).onclick = () => { ocultar(); alTocar?.(); };
  }
  requestAnimationFrame(() => el.classList.add('visible'));
  clearTimeout(temporizador);
  const ocultar = () => el.classList.remove('visible');
  temporizador = setTimeout(ocultar, boton ? Math.max(duracion, 7000) : duracion);
}

export const avisoError = (e) => aviso(e?.message || String(e), { tipo: 'error', duracion: 5000 });

// ---------- ventana de confirmación ----------
export function confirmar({ titulo, texto = '', si = 'Sí', no = 'No, volver', peligro = false }) {
  return new Promise((resolver) => {
    const fondo = document.createElement('div');
    fondo.className = 'modal-fondo';
    fondo.innerHTML = `
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="modal-titulo">
        <h2 id="modal-titulo">${esc(titulo)}</h2>
        ${texto ? `<p>${texto}</p>` : ''}
        <div class="modal-botones">
          <button type="button" class="btn btn-grande ${peligro ? 'btn-peligro' : 'btn-principal'}" data-r="1">${esc(si)}</button>
          <button type="button" class="btn btn-grande btn-suave" data-r="0">${esc(no)}</button>
        </div>
      </div>`;
    const cerrar = (r) => { fondo.remove(); resolver(r); };
    fondo.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (b) cerrar(b.dataset.r === '1');
      else if (e.target === fondo) cerrar(false);
    });
    document.body.append(fondo);
    $('[data-r="0"]', fondo).focus();
  });
}

/** Ventana con un solo botón para avisos importantes (ej: queda poco stock). */
export function alerta({ titulo, texto = '', boton = 'Entendido', icono = '' }) {
  return new Promise((resolver) => {
    const fondo = document.createElement('div');
    fondo.className = 'modal-fondo';
    fondo.innerHTML = `
      <div class="modal" role="alertdialog" aria-modal="true">
        ${icono ? `<div class="modal-icono">${icono}</div>` : ''}
        <h2>${esc(titulo)}</h2>
        ${texto ? `<p>${texto}</p>` : ''}
        <div class="modal-botones"><button type="button" class="btn btn-grande btn-principal">${esc(boton)}</button></div>
      </div>`;
    $('button', fondo).onclick = () => { fondo.remove(); resolver(); };
    document.body.append(fondo);
    $('button', fondo).focus();
  });
}

// ---------- hoja que sube desde abajo ----------
export function hoja(titulo, contenidoHtml, { alAbrir } = {}) {
  const fondo = document.createElement('div');
  fondo.className = 'hoja-fondo';
  fondo.innerHTML = `
    <section class="hoja" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <header class="hoja-cabeza">
        <h2>${esc(titulo)}</h2>
        <button type="button" class="btn-cerrar" aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">${contenidoHtml}</div>
    </section>`;
  const cerrar = () => {
    fondo.classList.remove('visible');
    setTimeout(() => fondo.remove(), 200);
    window.removeEventListener('popstate', cerrarPorAtras);
  };
  // el botón "atrás" del celular cierra la hoja en vez de salir de la pantalla
  const cerrarPorAtras = () => cerrar();
  history.pushState({ hoja: true }, '');
  window.addEventListener('popstate', cerrarPorAtras);
  const cerrarYVolver = () => { if (history.state?.hoja) history.back(); else cerrar(); };
  $('.btn-cerrar', fondo).onclick = cerrarYVolver;
  fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrarYVolver(); });
  document.body.append(fondo);
  requestAnimationFrame(() => fondo.classList.add('visible'));
  alAbrir?.($('.hoja-cuerpo', fondo), cerrarYVolver);
  return cerrarYVolver;
}

// ---------- botón ocupado mientras guarda ----------
export async function ocupado(boton, tarea) {
  if (boton.disabled) return;
  const texto = boton.innerHTML;
  boton.disabled = true;
  boton.innerHTML = '<span class="girando" aria-hidden="true"></span> Guardando…';
  try {
    return await tarea();
  } finally {
    boton.disabled = false;
    boton.innerHTML = texto;
  }
}

// ---------- fotos ----------
/** Abre la cámara (o la galería) y devuelve el archivo elegido, o null. */
export function elegirFoto({ camara = true } = {}) {
  return new Promise((resolver) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camara) input.capture = 'environment';
    input.style.display = 'none';
    input.onchange = () => { resolver(input.files[0] || null); input.remove(); };
    input.oncancel = () => { resolver(null); input.remove(); };
    document.body.append(input);
    input.click();
  });
}

/** Achica la foto para que suba rápido y ocupe poco. */
export async function achicarFoto(archivo, maximo = 1000, calidad = 0.8) {
  const bitmap = await createImageBitmap(archivo).catch(() => null);
  let ancho, alto, fuente;
  if (bitmap) {
    ({ width: ancho, height: alto } = bitmap);
    fuente = bitmap;
  } else {
    const img = new Image();
    img.src = URL.createObjectURL(archivo);
    await img.decode();
    ancho = img.naturalWidth; alto = img.naturalHeight; fuente = img;
  }
  const escala = Math.min(1, maximo / Math.max(ancho, alto));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(ancho * escala);
  canvas.height = Math.round(alto * escala);
  canvas.getContext('2d').drawImage(fuente, 0, 0, canvas.width, canvas.height);
  return new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', calidad));
}

/** Campo de dinero: muestra separador de miles mientras se escribe. */
export function campoPesos(input, alCambiar) {
  const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
  input.addEventListener('input', () => {
    const crudo = input.value.replace(/[^\d,]/g, '');
    const [entero, dec] = crudo.split(',');
    const n = entero ? fmt.format(Number(entero)) : '';
    input.value = dec !== undefined ? `${n},${dec.slice(0, 2)}` : n;
    alCambiar?.();
  });
}

export function iconoVacio(texto, icono = '🧸') {
  return `<div class="vacio"><div class="vacio-icono" aria-hidden="true">${icono}</div><p>${esc(texto)}</p></div>`;
}
