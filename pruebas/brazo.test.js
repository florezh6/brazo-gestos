// Pruebas de la conexion (js/brazo.js) contra la placa simulada, con
// un navigator.serial falso. Tiempo real.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PlacaSimulada, PuertoSimulado } from './placa_simulada.js';
import { Brazo } from '../js/brazo.js';

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8');
const HEX = leer('../firmware/brazo_web.hex');
const ANTIGUO = leer('./firmware_antiguo.hex');
const OPTIBOOT = leer('./bootloaders/optiboot_atmega328.hex');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Un navigator.serial con un solo puerto, ya autorizado.
class SerialFalso extends EventTarget {
  constructor(puerto) {
    super();
    this.puerto = puerto;
    puerto.ondisconnect = () => {
      const e = new Event('disconnect');
      Object.defineProperty(e, 'port', { value: puerto });
      this.dispatchEvent(e);
    };
  }
  async getPorts() { return [this.puerto]; }
  async requestPort() { return this.puerto; }
}

function armar(opciones) {
  const placa = new PlacaSimulada(opciones);
  const puerto = new PuertoSimulado(placa);
  const brazo = new Brazo(new SerialFalso(puerto), null);
  const estados = [];
  brazo.addEventListener('estado', (e) => estados.push(e.detail.estado));
  return { placa, puerto, brazo, estados };
}

test('conecta con el programa del taller y lee la configuracion', async () => {
  const { puerto, brazo } = armar({ app: HEX, bootloader: OPTIBOOT });
  try {
    assert.equal(await brazo.reconectar(), true);
    assert.equal(brazo.estado, 'listo');
    assert.equal(brazo.config.pin_base, 9);
    assert.equal(brazo.config.garra_abierta, 130);
  } finally {
    await brazo.desconectar();
    puerto.apagar();
  }
});

test('el latido sostiene el giro y suspender lo detiene', async () => {
  const { placa, puerto, brazo } = armar({ app: HEX, bootloader: OPTIBOOT });
  try {
    const consola = [];
    brazo.addEventListener('consola', (e) => consola.push(e.detail.sentido + ': ' + e.detail.texto));
    await brazo.reconectar();
    const inicio = placa.anguloEnPin(9);
    assert.ok(Math.abs(inicio - 90) <= 1, 'la base debe arrancar en reposo: ' + inicio + '\n' + consola.join('\n'));
    brazo.enviar('i');
    await esperar(1000);
    const girado = placa.anguloEnPin(9);
    assert.ok(girado - inicio >= 20, `en 1 s debe girar ~30 grados: ${inicio} -> ${girado}\n` + consola.join('\n'));
    brazo.suspender();
    await esperar(200);
    const quieto = placa.anguloEnPin(9);
    await esperar(800);
    assert.ok(Math.abs(placa.anguloEnPin(9) - quieto) <= 3, 'debe quedar quieto');
  } finally {
    await brazo.desconectar();
    puerto.apagar();
  }
});

test('ordenes de configuracion: cambio de pin y error de pin repetido', async () => {
  const { placa, puerto, brazo } = armar({ app: HEX, bootloader: OPTIBOOT });
  try {
    await brazo.reconectar();
    const ok = await brazo.orden('set pin_garra 6');
    assert.equal(ok.tipo, 'ok');
    const malo = await brazo.orden('set pin_base 6');
    assert.equal(malo.tipo, 'error');
    assert.match(malo.texto, /pin_garra/);
    await brazo.orden('mover garra 120');
    await esperar(150);
    assert.ok(Math.abs(placa.anguloEnPin(6) - 120) <= 1);
  } finally {
    await brazo.desconectar();
    puerto.apagar();
  }
});

test('reconoce el programa de agosto (version Python) sin configuracion', async () => {
  const { puerto, brazo } = armar({ app: ANTIGUO, bootloader: OPTIBOOT });
  try {
    await brazo.reconectar();
    assert.equal(brazo.estado, 'programa-antiguo');
    assert.equal(brazo.configurable, false);
  } finally {
    await brazo.desconectar();
    puerto.apagar();
  }
});

test('placa vacia: dice que no tiene el programa, y se puede preparar', async () => {
  const { puerto, brazo, estados } = armar({ bootloader: OPTIBOOT });
  try {
    assert.equal(await brazo.reconectar(), false);
    assert.equal(brazo.estado, 'sin-programa');
    await brazo.preparar(HEX, () => {});
    assert.ok(estados.includes('programando'));
    assert.equal(brazo.estado, 'listo');
  } finally {
    await brazo.desconectar();
    puerto.apagar();
  }
});

test('desenchufar el cable deja el estado en "perdido"', async () => {
  const { puerto, brazo } = armar({ app: HEX, bootloader: OPTIBOOT });
  await brazo.reconectar();
  puerto.desconectar();
  await esperar(50);
  assert.equal(brazo.estado, 'perdido');
  // Mandar letras despues no debe lanzar nada.
  brazo.enviar('i');
  puerto.apagar();
});

test('si la pagina se atrasa en pleno giro, la base retoma sola', async () => {
  const { placa, puerto, brazo } = armar({ app: HEX, bootloader: OPTIBOOT });
  try {
    await brazo.reconectar();
    brazo.enviar('i');
    await esperar(400);
    // La pagina se congela 600 ms: el watchdog de la placa detiene la base.
    brazo.latidoActivo = false;
    await esperar(600);
    const detenida = placa.anguloEnPin(9);
    await esperar(300);
    assert.ok(Math.abs(placa.anguloEnPin(9) - detenida) <= 3, 'el watchdog debe detenerla');
    // La pagina vuelve: el gesto sigue sostenido y la base sigue girando.
    brazo.latidoActivo = true;
    await esperar(700);
    assert.ok(placa.anguloEnPin(9) - detenida >= 12, `debe retomar: ${detenida} -> ${placa.anguloEnPin(9)}`);
    // Otra orden apaga la repeticion.
    brazo.enviar('c');
    await esperar(300);
    const quieta = placa.anguloEnPin(9);
    await esperar(500);
    assert.ok(Math.abs(placa.anguloEnPin(9) - quieta) <= 3, 'tras cerrar la garra la base queda quieta');
  } finally {
    await brazo.desconectar();
    puerto.apagar();
  }
});
