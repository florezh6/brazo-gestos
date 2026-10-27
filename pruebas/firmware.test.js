// Pruebas del programa de la placa (firmware/brazo_web.hex) corriendo
// en el chip simulado. El tiempo es simulado: no dependen de lo rapido
// que sea el computador.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PlacaSimulada } from './placa_simulada.js';

const HEX = readFileSync(new URL('../firmware/brazo_web.hex', import.meta.url), 'utf8');

function nuevaPlaca() {
  const placa = new PlacaSimulada({ app: HEX });
  const p = { placa, salida: '' };
  placa.alTransmitir = (b) => { p.salida += String.fromCharCode(b); };
  p.enviar = (texto) => placa.escribirDesdeComputador([...Buffer.from(texto)], 115200);
  // Manda latidos cada 100 ms durante "ms", como hace la pagina.
  p.latir = (ms) => {
    for (let t = 0; t < ms; t += 100) { p.enviar('.'); placa.avanzar(100); }
  };
  p.angulo = (pin) => placa.anguloEnPin(pin);
  p.orden = (texto, ms = 100) => { p.salida = ''; p.enviar(texto); placa.avanzar(ms); return p.salida; };
  placa.avanzar(300);
  return p;
}

const cerca = (real, esperado, msg) =>
  assert.ok(Math.abs(real - esperado) <= 1, `${msg}: ${real} y se esperaba ${esperado}`);

test('saluda al arrancar y dice que usa la configuracion de fabrica', () => {
  const p = nuevaPlaca();
  assert.match(p.salida, /Brazo listo\./);
  assert.match(p.salida, /IMEC-BRAZO v1/);
  assert.match(p.salida, /de fabrica/);
});

test('arranca con los servos en los pines y angulos de fabrica', () => {
  const p = nuevaPlaca();
  cerca(p.angulo(9), 90, 'base');
  cerca(p.angulo(10), 62, 'altura');
  cerca(p.angulo(11), 125, 'alcance');
  cerca(p.angulo(3), 130, 'garra abierta');
});

test('#info y #config', () => {
  const p = nuevaPlaca();
  assert.match(p.orden('#info\n'), /^IMEC-BRAZO v1/);
  assert.match(p.orden('#ver\n'), /^IMEC-BRAZO v1/);
  const config = p.orden('#config\n', 200);
  assert.match(config, /cfg pin_base=9/);
  assert.match(config, /cfg garra_abierta=130/);
  assert.match(config, /cfg fin/);
});

test('cambiar el pin de la base mueve la senal a ese pin', () => {
  const p = nuevaPlaca();
  assert.match(p.orden('#set pin_base 5\n'), /^ok pin_base=5/);
  const pulsosEn9 = (p.placa.pulsos.get(9) || []).length;
  p.placa.avanzar(200);
  cerca(p.angulo(5), 90, 'base en el pin 5');
  assert.equal((p.placa.pulsos.get(9) || []).length, pulsosEn9, 'el pin 9 debe quedar quieto');
  cerca(p.angulo(10), 62, 'la altura sigue en su pin');
});

test('rechaza pines invalidos o repetidos', () => {
  const p = nuevaPlaca();
  assert.match(p.orden('#set pin_base 10\n'), /^error el pin ya lo usa pin_altura/);
  assert.match(p.orden('#set pin_base 1\n'), /^error pin no valido/);
  assert.match(p.orden('#set pin_base 20\n'), /^error pin no valido/);
  assert.match(p.orden('#set pin_garra 14\n'), /^ok/, 'A0 debe servir');
  assert.match(p.orden('#set nada 3\n'), /^error clave desconocida/);
  assert.match(p.orden('#set base_izq 200\n'), /^error el angulo/);
  assert.match(p.orden('#volar\n'), /^error orden desconocida/);
});

test('#guardar sobrevive a un reinicio y #fabrica lo devuelve', () => {
  const p = nuevaPlaca();
  p.orden('#set pin_base 5\n');
  p.orden('#set garra_abierta 140\n');
  assert.match(p.orden('#guardar\n', 200), /^ok guardado/);

  p.salida = '';
  p.placa.reiniciar();
  p.placa.avanzar(300);
  assert.match(p.salida, /la guardada/);
  cerca(p.angulo(5), 90, 'base en el pin guardado');
  cerca(p.angulo(3), 140, 'garra abierta guardada');

  assert.match(p.orden('#fabrica\n', 300), /ok fabrica/);
  p.salida = '';
  p.placa.reiniciar();
  p.placa.avanzar(300);
  assert.match(p.salida, /la guardada/);   // fabrica tambien se guarda
  assert.match(p.orden('#config\n', 200), /cfg pin_base=9/);
  cerca(p.angulo(9), 90, 'base de vuelta en el 9');
});

test('girar: 30 grados por segundo mientras hay latido, y se detiene en el limite', () => {
  const p = nuevaPlaca();
  p.enviar('i');
  p.latir(1000);
  const a = p.angulo(9);
  assert.ok(a >= 114 && a <= 123, 'tras 1 s girando a la izquierda: ' + a);
  p.latir(2000);
  cerca(p.angulo(9), 145, 'tope izquierdo');
});

test('watchdog: sin latido el brazo se detiene solo y avisa', () => {
  const p = nuevaPlaca();
  p.enviar('d');
  p.latir(300);
  p.salida = '';
  p.placa.avanzar(450);
  const detenido = p.angulo(9);
  p.placa.avanzar(1000);
  assert.equal(p.angulo(9), detenido, 'la base no debe seguir girando');
  assert.match(p.salida, /Sin senal/);
  assert.ok(detenido >= 66 && detenido <= 78, 'giro antes de detenerse: ' + detenido);
});

test('cualquier otro gesto detiene el giro', () => {
  const p = nuevaPlaca();
  p.enviar('i');
  p.latir(500);
  p.enviar('c');
  const al = p.angulo(9);
  p.latir(800);
  assert.ok(Math.abs(p.angulo(9) - al) <= 3, 'la base debe quedar quieta');
});

test('subir va de golpe y bajar va de a 7 grados', () => {
  const p = nuevaPlaca();
  p.enviar('s');
  p.placa.avanzar(30);
  cerca(p.angulo(10), 80, 'arriba de inmediato');
  p.enviar('b');
  p.latir(200);
  const a = p.angulo(10);
  assert.ok(a < 80 && a > 45, 'a mitad de la bajada: ' + a);
  p.latir(800);
  cerca(p.angulo(10), 45, 'abajo');
});

test('cerrar la garra va de a poco y abrir va de golpe', () => {
  const p = nuevaPlaca();
  p.enviar('c');
  p.latir(200);
  const a = p.angulo(3);
  assert.ok(a < 130 && a > 90, 'a mitad del cierre: ' + a);
  p.latir(600);
  cerca(p.angulo(3), 90, 'cerrada');
  p.enviar('o');
  p.placa.avanzar(130);
  cerca(p.angulo(3), 130, 'abierta de golpe');
});

test('las letras dentro de una linea # no mueven el brazo', () => {
  const p = nuevaPlaca();
  // "set base_izq" trae s, b, i, d... ninguna debe actuar.
  p.orden('#set base_izq 150\n');
  p.latir(600);
  cerca(p.angulo(9), 90, 'base quieta');
  cerca(p.angulo(10), 62, 'altura quieta');
  cerca(p.angulo(3), 130, 'garra quieta');
});

test('un servo montado al reves se arregla intercambiando los extremos', () => {
  const p = nuevaPlaca();
  p.orden('#set base_izq 25\n');
  p.orden('#set base_der 145\n');
  p.enviar('i');
  p.latir(1000);
  const a = p.angulo(9);
  assert.ok(a < 70, 'izquierda ahora baja el angulo: ' + a);
});

test('#mover para calibrar, y la tecla 7 no pasa del cierre', () => {
  const p = nuevaPlaca();
  assert.match(p.orden('#mover garra 70\n'), /^ok base=90/);
  p.placa.avanzar(100);
  cerca(p.angulo(3), 70, '#mover lleva la garra a 70');
  p.orden('#mover garra 95\n');
  p.orden('7'); p.orden('7'); p.orden('7');
  p.placa.avanzar(100);
  cerca(p.angulo(3), 90, 'las teclas paran en la garra cerrada');
  assert.match(p.orden('#mover codo 10\n'), /^error servo desconocido/);
});
