// Falla si index.html no tiene los codigos de version al dia. Se
// arregla corriendo: python3 herramientas/versionar.py
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const raiz = new URL('../', import.meta.url);
const codigo = (ruta) => createHash('sha256').update(readFileSync(new URL(ruta, raiz))).digest('hex').slice(0, 10);
const html = readFileSync(new URL('index.html', raiz), 'utf8');

test('la hoja de estilos y app.js llevan la version de su contenido', () => {
  assert.ok(html.includes(`css/estilo.css?v=${codigo('css/estilo.css')}`), 'correr herramientas/versionar.py');
  assert.ok(html.includes(`js/app.js?v=${codigo('js/app.js')}`), 'correr herramientas/versionar.py');
});

test('el import map tiene la version de cada modulo', () => {
  const mapa = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  const modulos = readdirSync(new URL('js/', raiz)).filter((f) => f.endsWith('.js') && f !== 'app.js').map((f) => 'js/' + f);
  modulos.push('vendor/mediapipe/vision_bundle.mjs');
  for (const m of modulos) {
    assert.equal(mapa['./' + m], `./${m}?v=${codigo(m)}`, `${m}: correr herramientas/versionar.py`);
  }
});
