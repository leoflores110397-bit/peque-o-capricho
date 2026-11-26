// MODO DE PRUEBA: guarda todo en este aparato (localStorage), sin nube.
// Imita las mismas funciones que la conexión a Supabase para probar la app.
import { calcularVenta, fechaLocal, redondear } from '../calculos.js';

export const modo = 'prueba';

const CLAVE = 'pc-demo-datos';
const inicial = () => ({
  sesion: null,
  config: {
    id: 1, comision_mp_debito: 3.25, comision_mp_credito: 6.29, comision_getnet_debito: 1.5,
    comision_getnet_credito: 3.5, comision_qr: 0.8, email_tickets: '', email_modo: 'diario',
    aviso_stock_bajo: 2, rubros: ['Juguetes', 'Ojotas', 'Pantuflas', 'Otros'],
  },
  productos: [
    { nombre: 'Pelota de goma', rubro: 'Juguetes', cantidad: 8, costo: 1800, precio: 3500 },
    { nombre: 'Muñeca bebé', rubro: 'Juguetes', cantidad: 3, costo: 9000, precio: 16500 },
    { nombre: 'Auto a fricción', rubro: 'Juguetes', cantidad: 2, costo: 2500, precio: 4800 },
    { nombre: 'Rompecabezas 100 piezas', rubro: 'Juguetes', cantidad: 5, costo: 3200, precio: 6000 },
    { nombre: 'Ojotas niño 28-33', rubro: 'Ojotas', cantidad: 12, costo: 2900, precio: 5500 },
    { nombre: 'Ojotas mujer 35-40', rubro: 'Ojotas', cantidad: 10, costo: 3400, precio: 6500 },
    { nombre: 'Pantuflas peluche', rubro: 'Pantuflas', cantidad: 4, costo: 5200, precio: 9900 },
  ].map((p) => ({ id: crypto.randomUUID(), activo: true, foto_path: null, ...p })),
  ventas: [],
  cajas: [],
  tickets: [],
  archivos: {},
});

let db;
function cargar() {
  if (db) return db;
  try { db = JSON.parse(localStorage.getItem(CLAVE)); } catch { db = null; }
  if (!db) { db = inicial(); guardar(); }
  return db;
}
function guardar() {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(db));
  } catch {
    throw new Error('El aparato se quedó sin lugar para guardar (modo de prueba).');
  }
}
const copia = (x) => JSON.parse(JSON.stringify(x));
const esperar = () => new Promise((ok) => setTimeout(ok, 120));

function aDataUrl(blob) {
  return new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result);
    fr.onerror = mal;
    fr.readAsDataURL(blob);
  });
}

// ---------- sesión ----------
export async function sesion() { return cargar().sesion; }
export async function entrar(email) {
  await esperar();
  cargar().sesion = { email: email.trim().toLowerCase() || 'prueba@local', id: 'demo' };
  guardar();
}
export async function salir() { cargar().sesion = null; guardar(); }
export function alCambiarSesion() {}
export async function perfil() {
  const s = cargar().sesion;
  if (!s) return null;
  // escribir "ayudante" en el correo permite probar el rol de ayudante
  const rol = s.email.startsWith('ayudante') ? 'ayudante' : 'duena';
  return { ...s, nombre: rol === 'duena' ? 'Dueña' : 'Ayudante', rol };
}

// ---------- configuración ----------
export async function config() { return copia(cargar().config); }
export async function guardarConfig(c) { await esperar(); cargar().config = { ...cargar().config, ...c }; guardar(); return copia(db.config); }

// ---------- productos ----------
export async function productos() {
  return copia(cargar().productos.filter((p) => p.activo).sort((a, b) => a.nombre.localeCompare(b.nombre)));
}
export async function guardarProducto(p, foto) {
  await esperar();
  const d = cargar();
  const datos = { nombre: p.nombre.trim(), rubro: p.rubro, cantidad: Math.max(0, Math.round(p.cantidad || 0)), costo: p.costo || 0, precio: p.precio || 0 };
  if (foto) {
    const ruta = `foto-${crypto.randomUUID()}`;
    d.archivos[ruta] = await aDataUrl(foto);
    datos.foto_path = ruta;
  }
  let prod;
  if (p.id) {
    prod = d.productos.find((x) => x.id === p.id);
    Object.assign(prod, datos);
  } else {
    prod = { id: crypto.randomUUID(), activo: true, foto_path: null, ...datos };
    d.productos.push(prod);
  }
  guardar();
  return copia(prod);
}
export async function borrarProducto(id) { cargar().productos.find((p) => p.id === id).activo = false; guardar(); }
export async function ajustarStock(id, cambio) {
  const p = cargar().productos.find((x) => x.id === id);
  p.cantidad = Math.max(0, p.cantidad + cambio);
  guardar();
  return p.cantidad;
}
export function urlFoto(ruta) { return ruta ? cargar().archivos[ruta] || null : null; }

// ---------- ventas ----------
export async function registrarVenta(v) {
  await esperar();
  const d = cargar();
  const previa = v.client_id && d.ventas.find((x) => x.client_id === v.client_id);
  if (previa) return { venta: copia(previa), quedan: null, repetida: true };
  const c = calcularVenta({ monto: v.monto, recargoPct: v.recargo_pct, medio: v.medio, posnet: v.posnet, config: d.config });
  if (!(c.monto > 0)) throw new Error('Falta el monto');
  const creado = v.creado_en || new Date().toISOString();
  const venta = {
    id: crypto.randomUUID(), client_id: v.client_id || null, creado_en: creado, fecha: fechaLocal(creado),
    producto_id: null, producto_nombre: v.producto_nombre || null, cantidad: v.cantidad || 1,
    rubro: v.rubro || 'Otros', monto: c.monto, recargo_pct: c.recargoPct, recargo: c.recargo, total: c.total,
    medio: v.medio, posnet: v.medio === 'debito' || v.medio === 'credito' ? v.posnet : null,
    comision_pct: c.comisionPct, comision: c.comision, costo: null, stock_descontado: 0, anulada: false,
  };
  let quedan = null;
  const p = v.producto_id && d.productos.find((x) => x.id === v.producto_id);
  if (p) {
    const desc = Math.min(venta.cantidad, Math.max(p.cantidad, 0));
    p.cantidad -= desc;
    quedan = p.cantidad;
    Object.assign(venta, { producto_id: p.id, producto_nombre: venta.producto_nombre || p.nombre, costo: redondear(p.costo * venta.cantidad), stock_descontado: desc });
  }
  d.ventas.push(venta);
  guardar();
  return { venta: copia(venta), quedan, repetida: false };
}

export async function anularVenta(id) {
  await esperar();
  const d = cargar();
  const v = d.ventas.find((x) => x.id === id);
  if (!v) throw new Error('No se encontró la venta');
  if (d.cajas.find((c) => c.fecha === v.fecha)?.estado === 'cerrada') {
    throw new Error('La caja de ese día ya está cerrada. Reabrila para anular.');
  }
  if (!v.anulada) {
    v.anulada = true;
    const p = d.productos.find((x) => x.id === v.producto_id);
    if (p) p.cantidad += v.stock_descontado;
    guardar();
  }
  return copia(v);
}

export async function ventasDelDia(fecha) {
  return copia(cargar().ventas.filter((v) => v.fecha === fecha).sort((a, b) => (a.creado_en < b.creado_en ? 1 : -1)));
}

export async function resumenPorDia(desde, hasta) {
  const d = cargar();
  const dias = new Map();
  const fila = (fecha) => {
    if (!dias.has(fecha)) {
      dias.set(fecha, { fecha, ventas: 0, total: 0, monto: 0, efectivo: 0, transferencia: 0, qr: 0, tarjetas: 0,
        recargos: 0, cantidad_recargos: 0, comisiones: 0, ganancia: 0, apertura: null, contado: null, diferencia: null, estado: null });
    }
    return dias.get(fecha);
  };
  for (const v of d.ventas) {
    if (v.anulada || v.fecha < desde || v.fecha > hasta) continue;
    const f = fila(v.fecha);
    f.ventas++; f.total += v.total; f.monto += v.monto;
    if (v.medio === 'debito' || v.medio === 'credito') f.tarjetas += v.total; else f[v.medio] += v.total;
    f.recargos += v.recargo; if (v.recargo > 0) f.cantidad_recargos++;
    f.comisiones += v.comision;
    if (v.costo !== null) f.ganancia += v.monto - v.costo;
  }
  for (const c of d.cajas) {
    if (c.fecha < desde || c.fecha > hasta) continue;
    Object.assign(fila(c.fecha), { apertura: c.apertura, contado: c.efectivo_contado, diferencia: c.diferencia, estado: c.estado });
  }
  return [...dias.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

// ---------- caja ----------
export async function caja(fecha) { return copia(cargar().cajas.find((c) => c.fecha === fecha) || null); }
export async function abrirCaja(apertura) {
  await esperar();
  const d = cargar();
  const hoy = fechaLocal();
  let c = d.cajas.find((x) => x.fecha === hoy);
  if (c && c.estado === 'cerrada') throw new Error('La caja de hoy ya está cerrada. Reabrila primero.');
  if (!c) { c = { fecha: hoy, abierta_en: new Date().toISOString(), estado: 'abierta' }; d.cajas.push(c); }
  c.apertura = redondear(apertura);
  guardar();
  return copia(c);
}
export async function cerrarCaja(contado, nota) {
  await esperar();
  const d = cargar();
  const hoy = fechaLocal();
  const c = d.cajas.find((x) => x.fecha === hoy);
  if (!c) throw new Error('La caja de hoy no está abierta');
  const ef = d.ventas.filter((v) => v.fecha === hoy && v.medio === 'efectivo' && !v.anulada).reduce((s, v) => s + v.total, 0);
  Object.assign(c, {
    estado: 'cerrada', cerrada_en: new Date().toISOString(), efectivo_ventas: ef, efectivo_esperado: redondear(c.apertura + ef),
    efectivo_contado: redondear(contado), diferencia: redondear(contado - (c.apertura + ef)), nota: nota || null,
  });
  guardar();
  return copia(c);
}
export async function reabrirCaja(fecha) {
  const c = cargar().cajas.find((x) => x.fecha === (fecha || fechaLocal()));
  if (!c) throw new Error('No hay caja para ese día');
  Object.assign(c, { estado: 'abierta', cerrada_en: null, efectivo_contado: null, diferencia: null });
  guardar();
  return copia(c);
}

// ---------- tickets ----------
export async function subirTicket(foto, ventaId) {
  await esperar();
  const d = cargar();
  const ruta = `ticket-${crypto.randomUUID()}`;
  d.archivos[ruta] = await aDataUrl(foto);
  const t = { id: crypto.randomUUID(), creado_en: new Date().toISOString(), fecha: fechaLocal(), foto_path: ruta, venta_id: ventaId || null, enviado_en: null };
  d.tickets.push(t);
  guardar();
  return copia(t);
}
export async function ticketsDelDia(fecha) {
  return copia(cargar().tickets.filter((t) => t.fecha === fecha).sort((a, b) => (a.creado_en < b.creado_en ? 1 : -1)));
}
export async function urlTicket(ruta) { return cargar().archivos[ruta]; }
export async function vincularTicket(id, ventaId) {
  const t = cargar().tickets.find((x) => x.id === id);
  t.venta_id = ventaId || null;
  guardar();
  return copia(t);
}
export async function enviarTicket() {
  throw new Error('En el modo de prueba no se mandan emails.');
}
export async function leerTicket() {
  throw new Error('En el modo de prueba no se leen tickets con IA.');
}

export async function importarPrototipo({ productos: prods = [], ventas = [] }) {
  await esperar();
  const d = cargar();
  const res = { productos_nuevos: 0, productos_actualizados: 0, ventas: 0 };
  const buscar = (n) => d.productos.find((p) => p.activo && p.nombre.trim().toLowerCase() === String(n || '').trim().toLowerCase());
  for (const i of prods) {
    const p = buscar(i.nombre);
    if (p) { Object.assign(p, { cantidad: i.cantidad, costo: i.costo, precio: i.precio, rubro: i.rubro || p.rubro }); res.productos_actualizados++; }
    else { d.productos.push({ id: crypto.randomUUID(), activo: true, foto_path: null, ...i }); res.productos_nuevos++; }
  }
  for (const v of ventas) {
    if (d.ventas.some((x) => x.client_id === v.client_id)) continue;
    const p = buscar(v.producto_nombre);
    const c = calcularVenta({ monto: v.monto, recargoPct: v.recargo_pct, medio: v.medio, posnet: v.posnet, config: d.config });
    d.ventas.push({ ...v, id: crypto.randomUUID(), producto_id: p?.id || null, recargo: v.recargo, total: v.total,
      comision_pct: c.comisionPct, comision: redondear((v.total * c.comisionPct) / 100),
      costo: p ? redondear(p.costo * v.cantidad) : null, stock_descontado: 0, anulada: false });
    res.ventas++;
  }
  guardar();
  return res;
}

export async function exportarTodo() {
  const { sesion: _s, archivos: _a, ...resto } = cargar();
  return { exportado_en: new Date().toISOString(), modo: 'prueba', ...copia(resto) };
}
