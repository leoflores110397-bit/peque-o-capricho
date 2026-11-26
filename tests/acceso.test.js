import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correoDeAcceso, dniValido, normalizarDni } from '../js/acceso.js';

test('el DNI se escribe con o sin puntos', () => {
  assert.equal(normalizarDni('30.123.456'), '30123456');
  assert.equal(normalizarDni(' 30 123 456 '), '30123456');
  assert.ok(dniValido('30.123.456'));
  assert.ok(dniValido('5123456'));
  assert.ok(!dniValido('1234'));
});

test('cada DNI da un acceso distinto y siempre el mismo', async () => {
  const a = await correoDeAcceso('PequenoCapricho@gmail.com ', '30.123.456');
  const b = await correoDeAcceso('pequenocapricho@gmail.com', '30123456');
  const c = await correoDeAcceso('pequenocapricho@gmail.com', '30123457');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^pequenocapricho\+u[0-9a-f]{12}@gmail\.com$/);
  assert.ok(!a.includes('30123456'), 'el DNI no queda escrito en el acceso');
});

test('correo del local mal escrito', async () => {
  await assert.rejects(() => correoDeAcceso('sin-arroba', '30123456'), /no parece bien escrito/);
});
