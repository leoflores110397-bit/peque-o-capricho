// Cálculos de la app. Sin dependencias, para poder probarlos con `node --test`.
// La base de datos hace las mismas cuentas al guardar (ver registrar_venta en el SQL).

export const MEDIOS = [
  { id: 'efectivo', nombre: 'Efectivo', icono: '💵' },
  { id: 'transferencia', nombre: 'Transferencia', icono: '📲' },
  { id: 'qr', nombre: 'QR', icono: '🔳' },
  { id: 'debito', nombre: 'Débito', icono: '💳' },
  { id: 'credito', nombre: 'Crédito', icono: '💳' },
];

export const POSNETS = [
  { id: 'mercadopago', nombre: 'Mercado Pago' },
  { id: 'getnet', nombre: 'Getnet' },
];

export const ES_TARJETA = (medio) => medio === 'debito' || medio === 'credito';

/** Casilleros que se muestran en "Hoy", en orden. */
export const CASILLEROS = [
  { clave: 'efectivo', nombre: 'Efectivo' },
  { clave: 'transferencia', nombre: 'Transferencia' },
  { clave: 'qr', nombre: 'QR' },
  { clave: 'debito_mercadopago', nombre: 'Débito · Mercado Pago' },
  { clave: 'debito_getnet', nombre: 'Débito · Getnet' },
  { clave: 'credito_mercadopago', nombre: 'Crédito · Mercado Pago' },
  { clave: 'credito_getnet', nombre: 'Crédito · Getnet' },
];

export const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function nombreMedio(medio, posnet) {
  const m = MEDIOS.find((x) => x.id === medio)?.nombre ?? medio;
  const p = POSNETS.find((x) => x.id === posnet)?.nombre;
  return p ? `${m} · ${p}` : m;
}

export function claveMedio(v) {
  return ES_TARJETA(v.medio) ? `${v.medio}_${v.posnet}` : v.medio;
}

export function comisionPara(config, medio, posnet) {
  if (!config) return 0;
  const tabla = {
    debito_mercadopago: config.comision_mp_debito,
    credito_mercadopago: config.comision_mp_credito,
    debito_getnet: config.comision_getnet_debito,
    credito_getnet: config.comision_getnet_credito,
    qr: config.comision_qr,
  };
  return Number(tabla[ES_TARJETA(medio) ? `${medio}_${posnet}` : medio]) || 0;
}

/**
 * Calcula una venta: el recargo va aparte del precio normal.
 * @returns {{monto, recargoPct, recargo, total, comisionPct, comision, neto}}
 */
export function calcularVenta({ monto, recargoPct = 0, medio, posnet, config }) {
  const m = redondear(monto);
  const pct = ES_TARJETA(medio) ? Math.max(Number(recargoPct) || 0, 0) : 0;
  const recargo = redondear((m * pct) / 100);
  const total = redondear(m + recargo);
  const comisionPct = comisionPara(config, medio, posnet);
  const comision = redondear((total * comisionPct) / 100);
  return { monto: m, recargoPct: pct, recargo, total, comisionPct, comision, neto: redondear(total - comision) };
}

/** Resumen de un día a partir de sus ventas (las anuladas no cuentan). */
export function resumenDia(ventas) {
  const r = {
    total: 0, monto: 0, cantidad: 0, anuladas: 0,
    porMedio: Object.fromEntries(CASILLEROS.map((c) => [c.clave, 0])),
    recargos: { cantidad: 0, monto: 0 },
    comisiones: 0,
    ganancia: 0,
    efectivo: 0,
    aAcreditar: { mercadopago: 0, getnet: 0, qr: 0, total: 0 },
  };
  for (const v of ventas) {
    if (v.anulada) { r.anuladas++; continue; }
    const total = Number(v.total) || 0;
    r.cantidad++;
    r.total += total;
    r.monto += Number(v.monto) || 0;
    const k = claveMedio(v);
    r.porMedio[k] = (r.porMedio[k] || 0) + total;
    if (Number(v.recargo) > 0) {
      r.recargos.cantidad++;
      r.recargos.monto += Number(v.recargo);
    }
    const com = Number(v.comision) || 0;
    r.comisiones += com;
    if (v.costo !== null && v.costo !== undefined) r.ganancia += (Number(v.monto) || 0) - Number(v.costo);
    if (v.medio === 'efectivo') r.efectivo += total;
    if (ES_TARJETA(v.medio)) r.aAcreditar[v.posnet] += total - com;
    if (v.medio === 'qr') r.aAcreditar.qr += total - com;
  }
  r.aAcreditar.total = r.aAcreditar.mercadopago + r.aAcreditar.getnet + r.aAcreditar.qr;
  // redondeo final
  r.total = redondear(r.total); r.monto = redondear(r.monto);
  r.comisiones = redondear(r.comisiones); r.ganancia = redondear(r.ganancia);
  r.efectivo = redondear(r.efectivo); r.recargos.monto = redondear(r.recargos.monto);
  for (const k of Object.keys(r.porMedio)) r.porMedio[k] = redondear(r.porMedio[k]);
  for (const k of Object.keys(r.aAcreditar)) r.aAcreditar[k] = redondear(r.aAcreditar[k]);
  return r;
}

/** Efectivo esperado en la caja y diferencia con lo contado. */
export function cuentaCaja(apertura, efectivoVendido, contado) {
  const esperado = redondear((Number(apertura) || 0) + (Number(efectivoVendido) || 0));
  const hayContado = contado !== null && contado !== undefined && contado !== '';
  const diferencia = hayContado ? redondear(Number(contado) - esperado) : null;
  return { esperado, diferencia };
}

export function textoDiferencia(diferencia) {
  if (diferencia === null || diferencia === undefined) return '';
  if (Math.abs(diferencia) < 0.01) return 'Está justo';
  return diferencia > 0 ? `Sobran ${pesos(diferencia)}` : `Faltan ${pesos(-diferencia)}`;
}

export function gananciaProducto(p) {
  const costo = Number(p.costo) || 0;
  const precio = Number(p.precio) || 0;
  const ganancia = redondear(precio - costo);
  const porcentaje = costo > 0 ? Math.round((ganancia / costo) * 100) : null;
  return { ganancia, porcentaje };
}

// ---------- fechas (siempre hora de Córdoba) ----------
const ZONA = 'America/Argentina/Cordoba';

export function fechaLocal(d = new Date()) {
  // en-CA da AAAA-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(d));
}

export function horaLocal(d) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
}

export function sumarDias(fecha, dias) {
  const [a, m, d] = fecha.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

/** Lunes de la semana de la fecha (AAAA-MM-DD). */
export function inicioSemana(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 = domingo
  return sumarDias(fecha, -((dia + 6) % 7));
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function fechaLarga(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return `${DIAS[dia]} ${d} de ${MESES[m - 1]}`;
}

export function fechaCorta(fecha) {
  const [, m, d] = fecha.split('-').map(Number);
  return `${d}/${m}`;
}

export function nombreMes(fecha) {
  const [a, m] = fecha.split('-').map(Number);
  return `${MESES[m - 1][0].toUpperCase()}${MESES[m - 1].slice(1)} ${a}`;
}

/**
 * Agrupa filas diarias (de resumen_por_dia) por semana o mes.
 * periodo: 'dia' | 'semana' | 'mes'
 */
export function agruparPeriodo(filas, periodo) {
  if (periodo === 'dia') {
    return filas.map((f) => ({ ...f, clave: f.fecha, etiqueta: fechaLarga(f.fecha), dias: 1 }));
  }
  const grupos = new Map();
  const sumables = ['ventas', 'total', 'monto', 'efectivo', 'transferencia', 'qr', 'tarjetas',
    'recargos', 'cantidad_recargos', 'comisiones', 'ganancia'];
  for (const f of filas) {
    const clave = periodo === 'semana' ? inicioSemana(f.fecha) : f.fecha.slice(0, 7) + '-01';
    if (!grupos.has(clave)) {
      const etiqueta = periodo === 'semana'
        ? `Semana del ${fechaCorta(clave)} al ${fechaCorta(sumarDias(clave, 6))}`
        : nombreMes(clave);
      grupos.set(clave, { clave, etiqueta, dias: 0, diferencia: null, ...Object.fromEntries(sumables.map((s) => [s, 0])) });
    }
    const g = grupos.get(clave);
    g.dias++;
    for (const s of sumables) g[s] = redondear(g[s] + (Number(f[s]) || 0));
    if (f.diferencia !== null && f.diferencia !== undefined) {
      g.diferencia = redondear((g.diferencia || 0) + Number(f.diferencia));
    }
  }
  return [...grupos.values()].sort((a, b) => (a.clave < b.clave ? 1 : -1));
}

// ---------- formato ----------
const fmtPesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const pesos = (n) => fmtPesos.format(Number(n) || 0).replace(/ /g, ' ');

/** Convierte lo que escribe la persona ("12.500", "12500,50", "$ 3000") en número. */
export function leerNumero(texto) {
  if (typeof texto === 'number') return texto;
  let s = String(texto ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
