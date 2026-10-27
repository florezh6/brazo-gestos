// Reproduce lo que vive un profesor cuando se publica una version nueva:
// tenia abierta la version A (con su service worker), se publica la B y
// recarga. En cada carga revisa que el HTML y el CSS sean de la MISMA
// version, mirando una marca propia de la version B en cada uno.
//
// Uso: node pruebas/actualizacion.mjs <carpeta A> <carpeta B> <marca-html> <marca-css>
//   marca-html: selector que solo existe en el HTML de B
//   marca-css:  selector que solo existe en el CSS de B
import { chromium } from 'playwright-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [A, B, marcaHtml, marcaCss] = process.argv.slice(2);
const BASE = 'http://localhost:8766/';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
await fetch(BASE + '__version?dir=' + encodeURIComponent(A));

const perfil = mkdtempSync(join(tmpdir(), 'perfil-'));
const contexto = await chromium.launchPersistentContext(perfil, {
  channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ...(process.env.SIN_WEBGL ? [] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'])],
  permissions: ['camera'],
});
const pagina = contexto.pages()[0] || await contexto.newPage();

async function estado() {
  return pagina.evaluate(([h, c]) => {
    const reglas = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].map((r) => r.selectorText || ''); } catch (e) { return []; } });
    return { html: !!document.querySelector(h), css: reglas.some((r) => r && r.includes(c)) };
  }, [marcaHtml, marcaCss]);
}

await pagina.goto(BASE);
await pagina.evaluate(() => navigator.serviceWorker.ready);
await esperar(4000);                     // que el service worker guarde todo
await pagina.reload();
await esperar(1500);
console.log('con A publicada:', JSON.stringify(await estado()));

await fetch(BASE + '__version?dir=' + encodeURIComponent(B));
// Con --transicion se acepta que la PRIMERA recarga mezcle: es el paso
// desde una version cuyo service worker viejo todavia atiende mientras se
// instala el nuevo. Desde la segunda recarga todo debe ser consistente.
const transicion = process.argv.includes('--transicion');
let mezclas = 0;
for (let k = 1; k <= 4; k++) {
  await Promise.race([pagina.reload().catch(() => {}), esperar(15000)]);
  await esperar(Number(process.env.ESPERA || 2500));
  // Si el service worker nuevo justo recargo la pagina, se espera y se
  // vuelve a mirar: esa recarga sola es el comportamiento esperado.
  let e = null;
  for (let intento = 0; intento < 3 && !e; intento++) {
    e = await Promise.race([estado().catch(() => null), esperar(8000).then(() => null)]);
    if (!e) await esperar(2000);
  }
  const mezcla = !e || e.html !== e.css;
  if (mezcla && !(transicion && k === 1)) mezclas++;
  const sw = await Promise.race([pagina.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return [r.active && 'activo', r.waiting && 'esperando', r.installing && 'instalando', (await caches.keys()).join('+')].filter(Boolean).join(' ');
  }).catch(() => '?'), esperar(5000).then(() => 'sin respuesta')]);
  console.log(`recarga ${k} con B publicada:`, JSON.stringify(e), mezcla ? 'MEZCLA DE VERSIONES' : '', '| sw:', sw);
}
await contexto.close();
process.exit(mezclas ? 1 : 0);
