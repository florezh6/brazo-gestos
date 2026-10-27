// La regla de conteo en JavaScript debe dar EXACTAMENTE lo mismo que la
// funcion contar_dedos original de Python, que es la que se midio con
// 98.8 % de acierto. Los casos los genera pruebas/generar_paridad.py
// ejecutando el codigo Python del taller, sin modificarlo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contarDedos, MARGEN_PULGAR, Estabilizador, leerManos, PAUSA } from '../js/deteccion.js';

const datos = JSON.parse(readFileSync(new URL('./datos/paridad.json', import.meta.url), 'utf8'));

test('mismo margen del pulgar que en Python', () => {
  assert.equal(MARGEN_PULGAR, datos.margen);
});

test(`contarDedos coincide con Python en ${datos.casos.length} manos`, () => {
  let distintos = 0;
  for (const caso of datos.casos) {
    const puntos = caso.puntos.map(([x, y]) => ({ x, y, z: 0 }));
    if (contarDedos(puntos) !== caso.dedos) distintos++;
  }
  assert.equal(distintos, 0);
});

test('el estabilizador confirma a los 5 cuadros y una sola vez', () => {
  const e = new Estabilizador();
  const salidas = [3, 3, 3, 3, 3, 3, 3].map((v) => e.actualizar(v));
  assert.deepEqual(salidas, [false, false, false, false, true, false, false]);
  assert.equal(e.confirmado, 3);
  // Un parpadeo de un cuadro no cambia nada.
  assert.equal(e.actualizar(4), false);
  assert.equal(e.confirmado, 3);
});

test('sin mano al arrancar no se confirma nada (igual que Python)', () => {
  const e = new Estabilizador();
  for (let k = 0; k < 10; k++) assert.equal(e.actualizar(null), false);
});

test('reiniciar deja el sistema en PAUSA y vuelve a confirmar el mismo gesto', () => {
  const e = new Estabilizador();
  for (let k = 0; k < 5; k++) e.actualizar(2);
  e.reiniciar();
  assert.equal(e.confirmado, PAUSA);
  const salidas = [2, 2, 2, 2, 2].map((v) => e.actualizar(v));
  assert.equal(salidas[4], true);
});

test('dos manos son PAUSA y ninguna es null', () => {
  const mano = datos.casos[1].puntos.map(([x, y]) => ({ x, y }));
  assert.equal(leerManos([mano, mano]), PAUSA);
  assert.equal(leerManos([]), null);
});
