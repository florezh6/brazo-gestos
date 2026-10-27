// Usuario simulado: recorre la pagina en Chrome, con camara falsa y un
// Arduino simulado, y revisa lo que veria un profesor.
//
// Uso:
//   python3 -m http.server 8765 --bind 127.0.0.1   (en la raiz del repo)
//   node pruebas/navegador.mjs [carpeta-de-capturas] [escenario...]
//
// Usa el Google Chrome instalado en el computador.

import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8765/';
const CAPTURAS = process.argv[2] || 'capturas';
const SOLO = process.argv.slice(3);
mkdirSync(CAPTURAS, { recursive: true });

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Se ejecuta dentro de la pagina antes que cualquier otra cosa.
function instalarSerialFalso(escenario) {
  // El script tambien corre en la pagina en blanco inicial: ahi no.
  if (!location.protocol.startsWith('http')) return;
  window.__ESCENARIO__ = escenario;
  if (escenario.sinSerial) {
    delete Navigator.prototype.serial;
    return;
  }
  const serial = new EventTarget();
  const listo = import(new URL('pruebas/serial_falso.js', location.href).href).then((m) => m.crear(escenario, serial));
  serial.getPorts = async () => { const f = await listo; return f.autorizado ? [f.puerto] : []; };
  serial.requestPort = async () => { const f = await listo; f.autorizado = true; return f.puerto; };
  Object.defineProperty(Navigator.prototype, 'serial', { get: () => serial, configurable: true });
  window.__falso = listo;
}

// Chrome sin pantalla no tiene tarjeta grafica: SwiftShader le da un
// WebGL por software, como el de un computador sin aceleracion grafica
// pero con WebGL disponible.
async function abrirNavegador({ camara = true, webgl = true } = {}) {
  const args = ['--use-fake-device-for-media-stream'];
  if (webgl) args.push('--enable-unsafe-swiftshader', '--use-angle=swiftshader');
  else args.push('--disable-webgl', '--disable-3d-apis');
  if (camara) args.push('--use-fake-ui-for-media-stream');
  return chromium.launch({ channel: 'chrome', headless: true, args });
}

async function nuevaPagina(navegador, escenario, { ancho = 1366, alto = 768, camara = true } = {}) {
  const contexto = await navegador.newContext({
    viewport: { width: ancho, height: alto },
    permissions: camara ? ['camera'] : [],
  });
  await contexto.addInitScript(instalarSerialFalso, escenario);
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  pagina.on('console', (m) => {
    // MediaPipe anota como error el intento con la tarjeta grafica cuando
    // no hay; la pagina sigue con el procesador, que es lo esperado.
    if (m.type() === 'error' && !/kGpuService|webgl|XNNPACK/i.test(m.text())) errores.push(m.text());
  });
  await pagina.goto(BASE);
  return { contexto, pagina, errores };
}

const estadoBrazo = (pagina) => pagina.evaluate(() => window.taller && window.taller.brazo.estado);
async function esperarEstado(pagina, esperado, ms = 15000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if ((await estadoBrazo(pagina)) === esperado) return;
    await esperar(100);
  }
  const consola = await pagina.evaluate(() => document.getElementById('consola').textContent);
  throw new Error(`el brazo no llego a "${esperado}", quedo en "${await estadoBrazo(pagina)}"\nconsola:\n${consola}`);
}
const letrasEnviadas = (pagina) => pagina.evaluate(async () => {
  const f = await window.__falso;
  return String.fromCharCode(...f.puerto.registro).replace(/\./g, '');
});
const textoDe = (pagina, sel) => pagina.locator(sel).innerText();

const ESCENARIOS = {
  async 'arranque normal con el programa del taller'(nav) {
    const { contexto, pagina, errores } = await nuevaPagina(nav, { programa: 'nuevo', autorizado: true });
    await esperarEstado(pagina, 'listo');
    await pagina.waitForFunction(() => document.getElementById('motor').textContent !== '', null, { timeout: 30000 });
    await pagina.waitForSelector('#cargando', { state: 'hidden', timeout: 30000 });
    assert.match(await textoDe(pagina, '#estado-texto'), /Brazo conectado/);
    // La deteccion debe seguir corriendo varios segundos sin avisar fallas.
    await esperar(3000);
    assert.equal(await pagina.isVisible('.aviso[data-id="deteccion"]'), false, 'la deteccion fallo');
    const cuadros = await pagina.evaluate(() => window.taller.estado.cuadros);
    assert.ok(cuadros > 20, 'la deteccion debe procesar cuadros: ' + cuadros);
    await pagina.screenshot({ path: `${CAPTURAS}/01-actividad-1366.png` });
    assert.deepEqual(errores, []);
    await contexto.close();
  },

  async 'cargar el diseno de un equipo'(nav) {
    const { contexto, pagina, errores } = await nuevaPagina(nav, { programa: 'nuevo', autorizado: true });
    await esperarEstado(pagina, 'listo');
    await pagina.keyboard.press('m');
    assert.equal(await pagina.evaluate(() => document.activeElement.dataset.gesto), '0');
    await esperar(300);
    assert.match(await letrasEnviadas(pagina), /p$/, 'al abrir la carga se manda una pausa');
    assert.equal(await pagina.isVisible('#quieto'), true);

    // Letra repetida
    await pagina.keyboard.type('oc');
    await pagina.keyboard.type('o');
    assert.match(await textoDe(pagina, '#aviso-mapeo'), /repetida/);
    await pagina.screenshot({ path: `${CAPTURAS}/02-mapeo-repetida.png` });

    // Corregir: Backspace en la casilla vacia vuelve a la anterior y la
    // borra, como en los campos de codigos de verificacion.
    await pagina.keyboard.press('Backspace');
    await pagina.keyboard.type('id');
    await pagina.keyboard.press('Enter');
    assert.match(await textoDe(pagina, '#aviso-mapeo'), /Faltan letras: van 4 de 6/);

    await pagina.keyboard.type('sb');
    await pagina.keyboard.press('Enter');
    assert.match(await textoDe(pagina, '#aviso-mapeo'), /Diseño cargado/);
    const filas = await pagina.locator('#filas-mapeo li').allInnerTexts();
    assert.match(filas[0], /abrir garra/);
    assert.match(filas[1], /cerrar garra/);
    assert.equal(await pagina.isVisible('#quieto'), false);

    // La c dentro de una casilla no cambia nada fuera, y la f tampoco.
    await pagina.locator('#casillas input').nth(2).focus();
    await pagina.keyboard.press('Escape');
    assert.match(await textoDe(pagina, '#aviso-mapeo'), /cancelada/);
    assert.match((await pagina.locator('#filas-mapeo li').allInnerTexts())[0], /abrir garra/);

    // F vuelve al de fabrica
    await pagina.locator('body').click({ position: { x: 5, y: 300 } });
    await pagina.keyboard.press('f');
    assert.match((await pagina.locator('#filas-mapeo li').allInnerTexts())[0], /cerrar garra/);
    const registro = await pagina.evaluate(() => JSON.parse(localStorage.getItem('imec-mapeos-usados')));
    assert.equal(registro.length, 2);
    await pagina.screenshot({ path: `${CAPTURAS}/03-mapeo-fabrica.png` });
    assert.deepEqual(errores, []);
    await contexto.close();
  },

  async 'placa vacia: preparar la placa desde la pagina'(nav) {
    const { contexto, pagina, errores } = await nuevaPagina(nav, { programa: 'vacia', autorizado: true });
    await esperarEstado(pagina, 'sin-programa');
    await pagina.waitForSelector('.aviso[data-id="brazo"]');
    await pagina.screenshot({ path: `${CAPTURAS}/04-sin-programa.png` });
    await pagina.click('.aviso[data-id="brazo"] button');
    assert.equal(await pagina.isVisible('#brazo'), true);
    await pagina.click('#boton-preparar');
    await pagina.waitForFunction(() => document.getElementById('texto-progreso').textContent.includes('Escribiendo'), null, { timeout: 10000 });
    await pagina.screenshot({ path: `${CAPTURAS}/05-preparando.png` });
    await esperarEstado(pagina, 'listo', 60000);
    await pagina.waitForFunction(() => document.getElementById('texto-progreso').textContent.includes('funcionando'));
    assert.equal(await pagina.isVisible('.aviso[data-id="brazo"]'), false);
    await pagina.screenshot({ path: `${CAPTURAS}/06-preparada.png`, fullPage: true });
    assert.deepEqual(errores, []);
    await contexto.close();
  },

  async 'programa de agosto: funciona pero no se configura'(nav) {
    const { contexto, pagina, errores } = await nuevaPagina(nav, { programa: 'antiguo', autorizado: true });
    await esperarEstado(pagina, 'programa-antiguo');
    await pagina.click('button[data-pestana="brazo"]');
    assert.equal(await pagina.locator('#pines select').first().isDisabled(), true);
    assert.match(await textoDe(pagina, '#posiciones'), /programa de agosto/);
    const enviadas = await letrasEnviadas(pagina);
    // Al programa viejo no se le puede mandar ninguna letra de
    // movimiento disfrazada: solo la pausa y, si no saludo a tiempo, #ver.
    assert.match(enviadas, /^(#ver\n)?p+$/, 'lo enviado al programa viejo: ' + JSON.stringify(enviadas));
    assert.deepEqual(errores, []);
    await contexto.close();
  },

  async 'pines: cambio, intercambio, rechazo y guardado'(nav) {
    const { contexto, pagina, errores } = await nuevaPagina(nav, { programa: 'nuevo', autorizado: true });
    await esperarEstado(pagina, 'listo');
    await pagina.click('button[data-pestana="brazo"]');
    await pagina.selectOption('#pin-base', '5');
    await pagina.waitForFunction(() => window.taller.brazo.config.pin_base === 5);
    assert.match(await textoDe(pagina, '#aviso-pines'), /Base ahora en el D5/);

    // Elegir el pin de la altura para la base: se intercambian.
    await pagina.selectOption('#pin-base', '10');
    await pagina.waitForFunction(() => window.taller.brazo.config.pin_base === 10 && window.taller.brazo.config.pin_altura === 5);
    assert.match(await textoDe(pagina, '#aviso-pines'), /Intercambiados/);
    assert.equal(await pagina.isVisible('#sin-guardar'), true);

    // Mover un poco: el pulso del pin de la base cambia y vuelve.
    await pagina.click('#pines .pin:nth-child(1) button');
    await pagina.waitForFunction(() => document.getElementById('aviso-pines').textContent.includes('Se movió'), null, { timeout: 5000 });

    // Posicion: +5 a la garra abierta
    await pagina.click('[aria-label="Abierta: sumar 5 grados"]');
    await pagina.waitForFunction(() => document.getElementById('aviso-posiciones').textContent.includes('135°'));
    await esperar(150);
    const angulo = await pagina.evaluate(async () => (await window.__falso).placa.anguloEnPin(3));
    assert.ok(Math.abs(angulo - 135) <= 1, 'la garra fue a 135: ' + angulo);

    await pagina.screenshot({ path: `${CAPTURAS}/07-brazo-config.png`, fullPage: true });
    await pagina.click('#boton-guardar');
    await pagina.waitForFunction(() => document.getElementById('aviso-posiciones').textContent.includes('Guardado'));
    assert.equal(await pagina.isVisible('#sin-guardar'), false);

    // Recargar: la placa conserva lo guardado (EEPROM simulada).
    const config = await pagina.evaluate(async () => {
      const f = await window.__falso;
      await window.taller.brazo.desconectar();
      f.placa.reiniciar();
      await window.taller.brazo.reconectar();
      return window.taller.brazo.config;
    });
    assert.equal(config.pin_base, 10);
    assert.equal(config.garra_abierta, 135);

    // Fabrica pide confirmacion
    await pagina.click('#boton-config-fabrica');
    assert.match(await textoDe(pagina, '#boton-config-fabrica'), /otra vez/);
    await pagina.click('#boton-config-fabrica');
    await pagina.waitForFunction(() => window.taller.brazo.config.pin_base === 9);
    assert.deepEqual(errores, []);
    await contexto.close();
  },

  async 'control manual y consola'(nav) {
    const { contexto, pagina, errores } = await nuevaPagina(nav, { programa: 'nuevo', autorizado: true });
    await esperarEstado(pagina, 'listo');
    await pagina.click('button[data-pestana="brazo"]');
    const boton = pagina.locator('#manual [data-letra="i"]');
    const caja = await boton.boundingBox();
    await pagina.mouse.move(caja.x + 10, caja.y + 10);
    await pagina.mouse.down();
    await esperar(1000);
    await pagina.mouse.up();
    await esperar(300);
    const a1 = await pagina.evaluate(async () => (await window.__falso).placa.anguloEnPin(9));
    await esperar(700);
    const a2 = await pagina.evaluate(async () => (await window.__falso).placa.anguloEnPin(9));
    assert.ok(a1 >= 110, 'giro mientras estaba presionado: ' + a1);
    assert.ok(Math.abs(a2 - a1) <= 3, 'quieto al soltar');

    await pagina.fill('#entrada-consola', '#info');
    await pagina.press('#entrada-consola', 'Enter');
    await pagina.waitForFunction(() => document.getElementById('consola').textContent.includes('← IMEC-BRAZO v1'));
    await pagina.locator('#t-consola').scrollIntoViewIfNeeded();
    await pagina.screenshot({ path: `${CAPTURAS}/08-consola.png` });
    assert.deepEqual(errores, []);
    await contexto.close();
  },

  async 'desconexion en caliente y reconexion sola'(nav) {
    const { contexto, pagina } = await nuevaPagina(nav, { programa: 'nuevo', autorizado: true });
    await esperarEstado(pagina, 'listo');
    await pagina.evaluate(async () => (await window.__falso).puerto.desconectar());
    await esperarEstado(pagina, 'perdido', 3000);
    await pagina.waitForSelector('.aviso[data-id="brazo"]');
    await pagina.screenshot({ path: `${CAPTURAS}/09-perdido.png` });
    await pagina.evaluate(async () => (await window.__falso).enchufar());
    await esperarEstado(pagina, 'listo', 10000);
    await contexto.close();
  },

  async 'dos pestanas: solo una tiene el brazo'(nav) {
    const contexto = await nav.newContext({ permissions: ['camera'] });
    await contexto.addInitScript(instalarSerialFalso, { programa: 'nuevo', autorizado: true });
    const p1 = await contexto.newPage();
    await p1.goto(BASE);
    await esperarEstado(p1, 'listo');
    const p2 = await contexto.newPage();
    await p2.goto(BASE);
    await esperarEstado(p2, 'otra-pestana', 10000);
    assert.match(await textoDe(p2, '.aviso[data-id="brazo"]'), /otra pestaña/);
    await contexto.close();
  },

  async 'navegador sin Web Serial (Safari o Firefox)'(nav) {
    const { contexto, pagina } = await nuevaPagina(nav, { sinSerial: true });
    await pagina.waitForSelector('.aviso[data-id="navegador"]');
    assert.match(await textoDe(pagina, '.aviso[data-id="navegador"]'), /Chrome o Microsoft Edge/);
    assert.equal(await estadoBrazo(pagina), 'sin-soporte');
    await pagina.screenshot({ path: `${CAPTURAS}/10-sin-web-serial.png` });
    await contexto.close();
  },

  async 'sin internet despues de la primera visita'(nav) {
    const { contexto, pagina, errores } = await nuevaPagina(nav, { programa: 'nuevo', autorizado: true });
    await pagina.waitForSelector('#cargando', { state: 'hidden', timeout: 60000 });
    // Esperar a que el service worker guarde todo lo basico.
    await pagina.evaluate(async () => {
      await navigator.serviceWorker.ready;
      for (let k = 0; k < 100; k++) {
        const caja = await caches.open('brazo-gestos-v1');
        const llaves = await caja.keys();
        if (llaves.some((r) => r.url.endsWith('.wasm')) && llaves.length >= 20) return;
        await new Promise((r) => setTimeout(r, 300));
      }
      throw new Error('el service worker no guardo los archivos');
    });
    await contexto.setOffline(true);
    await pagina.reload();
    await pagina.waitForSelector('#cargando', { state: 'hidden', timeout: 60000 });
    await esperar(2000);
    assert.equal(await pagina.isVisible('.aviso[data-id="modelo"]'), false, 'el modelo debe cargar sin internet');
    assert.equal(await pagina.isVisible('.aviso[data-id="deteccion"]'), false);
    await pagina.waitForFunction(() => window.taller.estado.cuadros > 20, null, { timeout: 15000 });
    assert.deepEqual(errores.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)), []);
    await contexto.close();
  },

  async 'pantallas: 1920, 1366 y telefono'(nav) {
    for (const [ancho, alto] of [[1920, 1080], [1280, 720], [390, 844]]) {
      const { contexto, pagina } = await nuevaPagina(nav, { programa: 'nuevo', autorizado: true }, { ancho, alto });
      await esperarEstado(pagina, 'listo');
      await pagina.waitForSelector('#cargando', { state: 'hidden', timeout: 30000 });
      const desborda = await pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(desborda, false, `sin scroll horizontal a ${ancho}px`);
      await pagina.screenshot({ path: `${CAPTURAS}/11-pantalla-${ancho}.png`, fullPage: ancho < 500 });
      await pagina.click('button[data-pestana="brazo"]');
      await pagina.screenshot({ path: `${CAPTURAS}/12-brazo-${ancho}.png`, fullPage: true });
      await contexto.close();
    }
  },
};

const ESCENARIOS_SIN_CAMARA = {
  async 'camara negada'(nav) {
    const { contexto, pagina } = await nuevaPagina(nav, { programa: 'nuevo', autorizado: true }, { camara: false });
    await pagina.waitForSelector('.aviso[data-id="camara"]', { timeout: 15000 });
    console.log('    aviso:', await textoDe(pagina, '.aviso[data-id="camara"]'));
    await pagina.screenshot({ path: `${CAPTURAS}/13-camara-negada.png` });
    await contexto.close();
  },
};

const ESCENARIOS_SIN_WEBGL = {
  async 'navegador sin aceleracion grafica'(nav) {
    const { contexto, pagina } = await nuevaPagina(nav, { programa: 'nuevo', autorizado: true });
    await pagina.waitForSelector('.aviso[data-id="modelo"]', { timeout: 15000 });
    assert.match(await textoDe(pagina, '.aviso[data-id="modelo"]'), /chrome:\/\/settings\/system/);
    // El brazo igual se conecta: el control manual sigue disponible.
    await esperarEstado(pagina, 'listo');
    await pagina.screenshot({ path: `${CAPTURAS}/14-sin-webgl.png` });
    await contexto.close();
  },
};

let fallas = 0;
for (const [grupo, conCamara, webgl] of [[ESCENARIOS, true, true], [ESCENARIOS_SIN_CAMARA, false, true], [ESCENARIOS_SIN_WEBGL, true, false]]) {
  const nav = await abrirNavegador({ camara: conCamara, webgl });
  for (const [nombre, escenario] of Object.entries(grupo)) {
    if (SOLO.length && !SOLO.some((s) => nombre.includes(s))) continue;
    const t0 = Date.now();
    try {
      await escenario(nav);
      console.log(`✔ ${nombre} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    } catch (e) {
      fallas++;
      console.log(`✖ ${nombre}\n    ${e.message.split('\n').join('\n    ')}`);
    }
  }
  await nav.close();
}
process.exit(fallas ? 1 : 0);
