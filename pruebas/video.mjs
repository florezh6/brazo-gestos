// Compara cuadro a cuadro la version Python del taller con la pagina,
// sobre el mismo video real. Criterio acordado: al menos 95 % de
// cuadros con la misma lectura.
//
// Pasos:
//   pruebas/video_preparar.sh <video>
//   <python con mediapipe 1.0.0> pruebas/video_python.py <deteccion_dedos.py> modelo/hand_landmarker.task
//   node pruebas/servidor.mjs   (en otra terminal)
//   node pruebas/video.mjs
import { chromium } from 'playwright-core';
import { readFileSync, readdirSync } from 'node:fs';

const carpeta = new URL('./datos/video/', import.meta.url);
const python = JSON.parse(readFileSync(new URL('python.json', carpeta), 'utf8'));
const n = readdirSync(carpeta).filter((f) => f.endsWith('.jpg')).length;

const nav = await chromium.launch({
  channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const pagina = await nav.newPage();
await pagina.goto(`http://localhost:8765/pruebas/video.html?n=${n}`);
await pagina.waitForFunction(() => window.resultado, null, { timeout: 600000 });
const { motor, lecturas } = await pagina.evaluate(() => window.resultado);
await nav.close();

const nombre = (v) => (v === null ? 'sin mano' : String(v));
let iguales = 0;
const confusion = {};
const conMano = { total: 0, iguales: 0 };
lecturas.forEach((v, i) => {
  const p = python[i];
  if (v === p) iguales++;
  if (p !== null || v !== null) {
    conMano.total++;
    if (v === p) conMano.iguales++;
  }
  const clave = `${nombre(p)} -> ${nombre(v)}`;
  confusion[clave] = (confusion[clave] || 0) + 1;
});
const pct = (a, b) => (100 * a / b).toFixed(1) + ' %';
console.log(`Detector de la pagina en ${motor}. ${n} cuadros.`);
console.log(`Misma lectura: ${iguales} de ${n} (${pct(iguales, n)}).`);
if (conMano.total) console.log(`Solo cuadros con alguna mano: ${conMano.iguales} de ${conMano.total} (${pct(conMano.iguales, conMano.total)}).`);
console.log('Python -> pagina:');
for (const [k, v] of Object.entries(confusion).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
process.exit(iguales / n >= 0.95 ? 0 : 1);
