// Pruebas del programador contra los bootloaders REALES de Arduino
// (optiboot del Uno y el viejo de los Nano clones) corriendo en el chip
// simulado. Aqui el tiempo es real, porque el programador espera con
// relojes de verdad, igual que en el navegador.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PlacaSimulada, PuertoSimulado } from './placa_simulada.js';
import { programar, leerHex, ErrorProgramador } from '../js/programador.js';

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8');
const HEX = leer('../firmware/brazo_web.hex');
const OPTIBOOT = leer('./bootloaders/optiboot_atmega328.hex');
const VIEJO = leer('./bootloaders/ATmegaBOOT_168_atmega328.hex');

// Abre el puerto como lo hara la pagina y junta lo que diga la placa.
async function escuchar(puerto, ms) {
  await puerto.open({ baudRate: 115200 });
  const lector = puerto.readable.getReader();
  let texto = '';
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const r = await Promise.race([
      lector.read(),
      new Promise((ok) => setTimeout(() => ok(null), fin - Date.now())),
    ]);
    if (!r || r.done) break;
    texto += String.fromCharCode(...r.value);
  }
  await lector.cancel();
  await puerto.close();
  return texto;
}

function flashIgualAlHex(placa) {
  const { datos } = leerHex(HEX);
  const flash = new Uint8Array(placa.flash.buffer);
  return datos.every((b, k) => flash[k] === b);
}

test('programa una placa con optiboot (Uno) y el programa arranca', async () => {
  const placa = new PlacaSimulada({ bootloader: OPTIBOOT });
  const puerto = new PuertoSimulado(placa);
  const fases = new Set();
  try {
    const r = await programar(puerto, HEX, (a) => fases.add(a.fase));
    assert.equal(r.bootloader, 'bootloader optiboot (Uno, Nano nuevo)');
    assert.deepEqual(r.firma, [0x1e, 0x95, 0x0f]);
    assert.ok(fases.has('escribiendo') && fases.has('verificando') && fases.has('listo'));
    assert.ok(flashIgualAlHex(placa), 'la flash debe quedar igual al .hex');

    const saludo = await escuchar(puerto, 2500);
    assert.match(saludo, /IMEC-BRAZO v1/);
  } finally {
    puerto.apagar();
  }
});

test('programa un Nano con el bootloader viejo, a 57600', async () => {
  const placa = new PlacaSimulada({ bootloader: VIEJO });
  const puerto = new PuertoSimulado(placa, { usbVendorId: 0x1a86, usbProductId: 0x7523 });
  try {
    const r = await programar(puerto, HEX);
    assert.equal(r.bootloader, 'bootloader viejo (Nano clon)');
    assert.ok(flashIgualAlHex(placa));
    // El bootloader viejo tarda mas en ceder el control al programa.
    const saludo = await escuchar(puerto, 5000);
    assert.match(saludo, /IMEC-BRAZO v1/);
  } finally {
    puerto.apagar();
  }
});

test('se puede volver a programar una placa que ya tiene el programa', async () => {
  const placa = new PlacaSimulada({ app: HEX, bootloader: OPTIBOOT });
  const puerto = new PuertoSimulado(placa);
  try {
    await programar(puerto, HEX);
    assert.match(await escuchar(puerto, 2500), /IMEC-BRAZO v1/);
  } finally {
    puerto.apagar();
  }
});

test('sin bootloader falla con un mensaje claro', async () => {
  const placa = new PlacaSimulada({ app: HEX });
  const puerto = new PuertoSimulado(placa);
  try {
    await assert.rejects(programar(puerto, HEX), (e) => {
      assert.ok(e instanceof ErrorProgramador);
      assert.match(e.message, /no respondió como un Arduino Uno o Nano/);
      return true;
    });
    assert.equal(puerto.abierto, false, 'el puerto debe quedar cerrado');
  } finally {
    puerto.apagar();
  }
});

test('un .hex danado se rechaza antes de tocar la placa', async () => {
  assert.throws(() => leerHex(':10000000FFFF\n'), /dañado/);
  assert.throws(() => leerHex(''), /vacío/);
  const { inicio, datos } = leerHex(':0400000001020304F2\n:00000001FF\n');
  assert.equal(inicio, 0);
  assert.deepEqual([...datos], [1, 2, 3, 4]);
});
