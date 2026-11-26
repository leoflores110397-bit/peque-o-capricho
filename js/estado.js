// Datos que usan varias pantallas + ventas guardadas sin internet.
import { api } from './api/index.js';

export const estado = {
  perfil: null,
  config: null,
  productos: [],
};

const leer = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const escribir = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin lugar */ } };

export const puedeVender = () => ['duena', 'admin'].includes(estado.perfil?.rol);

export async function cargarConfig() {
  try {
    estado.config = await api.config();
    escribir('pc-config', estado.config);
  } catch (e) {
    estado.config = leer('pc-config', null);
    if (!estado.config) throw e;
  }
  return estado.config;
}

/** Trae el stock. Si no hay internet usa la última copia guardada en el aparato. */
export async function cargarProductos() {
  try {
    estado.productos = await api.productos();
    escribir('pc-productos', estado.productos);
  } catch (e) {
    estado.productos = leer('pc-productos', []);
    if (!e.sinInternet) throw e;
  }
  // descontar lo vendido sin internet que todavía no subió
  for (const v of pendientes()) {
    const p = estado.productos.find((x) => x.id === v.producto_id);
    if (p) p.cantidad = Math.max(0, p.cantidad - (v.cantidad || 1));
  }
  return estado.productos;
}

export const rubros = () => estado.config?.rubros?.length ? estado.config.rubros : ['Juguetes', 'Ojotas', 'Pantuflas', 'Otros'];
export const avisoStock = () => Number(estado.config?.aviso_stock_bajo ?? 2);

// ---------- ventas sin internet ----------
const PEND = 'pc-ventas-pendientes';
export const pendientes = () => leer(PEND, []);

/**
 * Guarda la venta. Si no hay internet, la deja en el aparato y la sube después.
 * Devuelve { venta, quedan, pendiente }.
 */
export async function guardarVenta(datos) {
  const v = { ...datos, client_id: crypto.randomUUID(), creado_en: new Date().toISOString() };
  try {
    const r = await api.registrarVenta(v);
    actualizarStockLocal(v.producto_id, r.quedan);
    return { ...r, pendiente: false };
  } catch (e) {
    if (!e.sinInternet) throw e;
    escribir(PEND, [...pendientes(), v]);
    const p = estado.productos.find((x) => x.id === v.producto_id);
    let quedan = null;
    if (p) { p.cantidad = Math.max(0, p.cantidad - (v.cantidad || 1)); quedan = p.cantidad; }
    return { venta: { ...v, pendiente: true }, quedan, pendiente: true };
  }
}

function actualizarStockLocal(id, quedan) {
  const p = estado.productos.find((x) => x.id === id);
  if (p && quedan !== null && quedan !== undefined) p.cantidad = quedan;
}

let subiendo = false;
/** Intenta subir las ventas hechas sin internet. Devuelve cuántas subió. */
export async function subirPendientes() {
  if (subiendo) return 0;
  subiendo = true;
  let subidas = 0;
  try {
    for (const v of pendientes()) {
      try {
        await api.registrarVenta(v); // el client_id evita que se guarde dos veces
      } catch (e) {
        if (e.sinInternet) break;
        // error de datos: se guarda aparte para no trabar las demás
        escribir('pc-ventas-con-error', [...leer('pc-ventas-con-error', []), { ...v, error: e.message }]);
      }
      escribir(PEND, pendientes().filter((x) => x.client_id !== v.client_id));
      subidas++;
    }
  } finally {
    subiendo = false;
  }
  return subidas;
}
