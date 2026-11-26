// Convierte la "copia de seguridad" del prototipo (botón "Copiar copia de seguridad"
// de la app vieja) al formato de la app nueva. Sin dependencias del navegador, para probarlo.
import { fechaLocal, redondear } from './calculos.js';

const MEDIOS = { Efectivo: 'efectivo', Transferencia: 'transferencia', QR: 'qr', 'Débito': 'debito', 'Crédito': 'credito' };
const POSNETS = { 'Mercado Pago': 'mercadopago', Getnet: 'getnet' };

/** Id fijo a partir del id del prototipo, para que importar dos veces no duplique ventas. */
export function idDesdePrototipo(id) {
  const hex = Math.abs(Math.trunc(Number(id) || 0)).toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
}

const numero = (x) => Math.max(0, Number(String(x ?? '').replace(/[^\d.-]/g, '')) || 0);

export function convertirPrototipo(texto) {
  let datos;
  try {
    datos = typeof texto === 'string' ? JSON.parse(texto.trim()) : texto;
  } catch {
    throw new Error('Eso no parece una copia del prototipo. Copiala de nuevo y pegala completa.');
  }
  if (!datos || (!Array.isArray(datos.stock) && !Array.isArray(datos.sales))) {
    throw new Error('Eso no parece una copia del prototipo. Copiala de nuevo y pegala completa.');
  }

  // productos (si hay nombres repetidos, queda el último)
  const porNombre = new Map();
  for (const i of datos.stock || []) {
    const nombre = String(i.name || '').trim();
    if (!nombre) continue;
    porNombre.set(nombre.toLowerCase(), {
      nombre, rubro: 'Otros', cantidad: Math.round(numero(i.qty)), costo: numero(i.cost), precio: numero(i.price),
    });
  }

  const ventas = [];
  for (const s of datos.sales || []) {
    const total = numero(s.amt);
    const medio = MEDIOS[s.pay];
    if (!total || !medio || !s.t) continue;
    const tarjeta = medio === 'debito' || medio === 'credito';
    const recargo = tarjeta ? numero(s.rec) : 0;
    const monto = redondear(numero(s.base) || total - recargo);
    if (monto <= 0) continue;
    const nombre = String(s.name || '').trim();
    const prod = porNombre.get(nombre.toLowerCase());
    // el rubro del producto se toma de sus ventas
    if (prod && s.cat) prod.rubro = s.cat;
    ventas.push({
      client_id: idDesdePrototipo(s.id),
      creado_en: new Date(s.t).toISOString(),
      fecha: fechaLocal(s.t),
      producto_nombre: nombre || null,
      cantidad: Math.max(1, Math.round(numero(s.qty)) || 1),
      rubro: s.cat || 'Otros',
      monto,
      recargo_pct: recargo && monto ? redondear((recargo / monto) * 100) : 0,
      recargo: redondear(recargo),
      total: redondear(monto + recargo),
      medio,
      posnet: tarjeta ? POSNETS[s.term] || 'mercadopago' : null,
    });
  }

  return { productos: [...porNombre.values()], ventas };
}
