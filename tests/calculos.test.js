import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularVenta, resumenDia, cuentaCaja, textoDiferencia, gananciaProducto, leerNumero,
  fechaLocal, inicioSemana, agruparPeriodo, sumarDias,
} from '../js/calculos.js';

const config = {
  comision_mp_debito: 1.5, comision_mp_credito: 6, comision_getnet_debito: 1,
  comision_getnet_credito: 4, comision_qr: 0.8,
};

test('el recargo se suma aparte y no cambia el precio normal', () => {
  const r = calcularVenta({ monto: 10000, recargoPct: 15, medio: 'credito', posnet: 'mercadopago', config });
  assert.equal(r.monto, 10000);
  assert.equal(r.recargo, 1500);
  assert.equal(r.total, 11500);
  assert.equal(r.comisionPct, 6);
  assert.equal(r.comision, 690);
  assert.equal(r.neto, 10810);
});

test('en efectivo no hay recargo aunque se cargue', () => {
  const r = calcularVenta({ monto: 5000, recargoPct: 10, medio: 'efectivo', config });
  assert.equal(r.recargo, 0);
  assert.equal(r.total, 5000);
  assert.equal(r.comision, 0);
});

test('resumen del día separa tarjetas por posnet y no cuenta anuladas', () => {
  const ventas = [
    { medio: 'efectivo', monto: 1000, recargo: 0, total: 1000, comision: 0, costo: 400 },
    { medio: 'credito', posnet: 'getnet', monto: 2000, recargo: 200, total: 2200, comision: 88, costo: null },
    { medio: 'debito', posnet: 'mercadopago', monto: 3000, recargo: 0, total: 3000, comision: 45, costo: 1000 },
    { medio: 'qr', monto: 500, recargo: 0, total: 500, comision: 4 },
    { medio: 'efectivo', monto: 9999, recargo: 0, total: 9999, comision: 0, anulada: true },
  ];
  const r = resumenDia(ventas);
  assert.equal(r.cantidad, 4);
  assert.equal(r.anuladas, 1);
  assert.equal(r.total, 6700);
  assert.equal(r.porMedio.efectivo, 1000);
  assert.equal(r.porMedio.credito_getnet, 2200);
  assert.equal(r.porMedio.debito_mercadopago, 3000);
  assert.equal(r.porMedio.qr, 500);
  assert.equal(r.cantidadPorMedio.efectivo, 1);
  assert.deepEqual(r.recargos, { cantidad: 1, monto: 200 });
  assert.equal(r.comisiones, 137);
  assert.equal(r.ganancia, 2600); // (1000-400) + (3000-1000); el recargo no suma ganancia
  assert.equal(r.aAcreditar.getnet, 2112);
  assert.equal(r.aAcreditar.mercadopago, 2955);
  assert.equal(r.aAcreditar.qr, 496);
  assert.equal(r.efectivo, 1000);
});

test('cuenta de caja', () => {
  assert.deepEqual(cuentaCaja(5000, 12000, 16500), { esperado: 17000, diferencia: -500 });
  assert.equal(textoDiferencia(-500), 'Faltan $ 500');
  assert.equal(textoDiferencia(250), 'Sobran $ 250');
  assert.equal(textoDiferencia(0), 'Está justo');
  assert.equal(cuentaCaja(100, 0, '').diferencia, null);
});

test('ganancia por producto', () => {
  assert.deepEqual(gananciaProducto({ costo: 1000, precio: 2500 }), { ganancia: 1500, porcentaje: 150 });
  assert.deepEqual(gananciaProducto({ costo: 0, precio: 800 }), { ganancia: 800, porcentaje: null });
});

test('leer números como los escribe la gente', () => {
  assert.equal(leerNumero('12.500'), 12500);
  assert.equal(leerNumero('12500,50'), 12500.5);
  assert.equal(leerNumero('$ 3000'), 3000);
  assert.equal(leerNumero('1.234.567'), 1234567);
  assert.equal(leerNumero('12.5'), 12.5);
  assert.equal(leerNumero(''), 0);
});

test('fechas en hora de Córdoba', () => {
  // 01:30 UTC del 27 es todavía 26 en Argentina (UTC-3)
  assert.equal(fechaLocal('2026-11-27T01:30:00Z'), '2026-11-26');
  assert.equal(inicioSemana('2026-11-26'), '2026-11-23'); // jueves -> lunes
  assert.equal(inicioSemana('2026-11-29'), '2026-11-23'); // domingo -> lunes anterior
  assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
});

test('agrupar historial por semana y mes', () => {
  const filas = [
    { fecha: '2026-11-24', total: 100, ventas: 1, diferencia: -10 },
    { fecha: '2026-11-26', total: 200, ventas: 2, diferencia: null },
    { fecha: '2026-11-02', total: 50, ventas: 1, diferencia: 5 },
  ];
  const semanas = agruparPeriodo(filas, 'semana');
  assert.equal(semanas.length, 2);
  assert.equal(semanas[0].total, 300);
  assert.equal(semanas[0].diferencia, -10);
  const meses = agruparPeriodo(filas, 'mes');
  assert.equal(meses.length, 1);
  assert.equal(meses[0].total, 350);
  assert.equal(meses[0].etiqueta, 'Noviembre 2026');
});
