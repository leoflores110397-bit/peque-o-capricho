import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertirPrototipo, idDesdePrototipo } from '../js/importar.js';

const copia = {
  stock: [
    { id: 1, name: 'Pelota nº5', qty: 4, cost: 2000, price: 4500 },
    { id: 2, name: '  ', qty: 1, cost: 1, price: 1 },
  ],
  sales: [
    { id: 1764200000000, t: '2026-11-27T01:30:00.000Z', amt: 5175, base: 4500, rec: 675, qty: 1, name: 'Pelota nº5', cat: 'Juguetes', pay: 'Crédito', term: 'Getnet' },
    { id: 1764200000001, t: '2026-11-26T15:00:00.000Z', amt: 3000, base: 3000, rec: 0, qty: 2, name: '', cat: 'Ojotas', pay: 'Efectivo', term: '' },
    { id: 1764200000002, t: '2026-11-26T15:00:00.000Z', amt: 0, pay: 'Efectivo' },
  ],
};

test('convierte la copia del prototipo', () => {
  const r = convertirPrototipo(JSON.stringify(copia));
  assert.equal(r.productos.length, 1);
  assert.deepEqual(r.productos[0], { nombre: 'Pelota nº5', rubro: 'Juguetes', cantidad: 4, costo: 2000, precio: 4500 });
  assert.equal(r.ventas.length, 2);
  const [tarjeta, efectivo] = r.ventas;
  assert.equal(tarjeta.medio, 'credito');
  assert.equal(tarjeta.posnet, 'getnet');
  assert.equal(tarjeta.monto, 4500);
  assert.equal(tarjeta.recargo, 675);
  assert.equal(tarjeta.recargo_pct, 15);
  assert.equal(tarjeta.fecha, '2026-11-26'); // 22:30 en Córdoba
  assert.equal(efectivo.posnet, null);
  assert.equal(efectivo.cantidad, 2);
  assert.equal(efectivo.producto_nombre, null);
});

test('el mismo id del prototipo da siempre el mismo id nuevo', () => {
  assert.equal(idDesdePrototipo(1764200000000), idDesdePrototipo(1764200000000));
  assert.match(idDesdePrototipo(1764200000000), /^[0-9a-f-]{36}$/);
});

test('rechaza texto que no es una copia', () => {
  assert.throws(() => convertirPrototipo('hola'), /no parece una copia/);
  assert.throws(() => convertirPrototipo('{"a":1}'), /no parece una copia/);
});
