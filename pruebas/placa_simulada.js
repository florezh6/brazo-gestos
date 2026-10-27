// Un Arduino Uno simulado, para probar sin hardware.
//
// Corre el .hex REAL (el mismo que se carga en la placa) dentro de
// avr8js, un emulador del chip ATmega328P escrito en JavaScript. Se
// usa en las pruebas de Node y, inyectado, en las pruebas del
// navegador. La pagina publicada NUNCA lo carga.
//
// Ademas de lo que trae avr8js, aqui se agrega:
//   - el pulso de reset por la linea DTR, como en el Uno de verdad;
//   - el bootloader (optiboot o el viejo del Nano) y la instruccion SPM
//     con la que escribe la memoria de programa, que avr8js no trae;
//   - una EEPROM que sobrevive a los reinicios;
//   - el registro de los pulsos de cada pin, para medir los servos;
//   - un puerto con la misma forma que el SerialPort de Web Serial.

import {
  CPU, avrInstruction, AVRTimer, timer0Config, timer1Config, timer2Config,
  AVRUSART, usart0Config, AVRIOPort, portBConfig, portCConfig, portDConfig,
  AVREEPROM, EEPROMMemoryBackend, AVRWatchdog, watchdogConfig, AVRClock, clockConfig,
} from './vendor/avr8js.mjs';
import { leerHex } from '../js/programador.js';

const FRECUENCIA = 16e6;
const MCUSR = 0x54;
const MCUSR_EXTRF = 0x02;
const SPMCSR = 0x57;
const UCSR0A = 0xc0;
const RXC0 = 0x80;
const UDR0 = 0xc6;
const UCSR0B = 0xc1;

// Pin de Arduino -> [puerto, bit]
function pinDeArduino(pin) {
  if (pin <= 7) return ['D', pin];
  if (pin <= 13) return ['B', pin - 8];
  return ['C', pin - 14];
}

export class PlacaSimulada {
  constructor({ app = null, bootloader = null } = {}) {
    this.flash = new Uint16Array(0x4000);           // 32 KB
    new Uint8Array(this.flash.buffer).fill(0xff);
    this.inicioBootloader = null;
    if (app) this.cargar(app);
    if (bootloader) {
      const { inicio } = this.cargar(bootloader);
      this.inicioBootloader = inicio;
    }
    this.eeprom = new EEPROMMemoryBackend(1024);
    this.eeprom.memory.fill(0xff);
    this.alTransmitir = null;      // (byte) => void
    this.pulsos = new Map();       // pin -> [{inicio, ancho}] en microsegundos
    this.reinicios = 0;
    this.encender(false);
  }

  cargar(textoHex) {
    const { inicio, datos } = leerHex(textoHex);
    const bytes = new Uint8Array(this.flash.buffer);
    bytes.set(datos, inicio);
    return { inicio, datos };
  }

  // Arma un chip nuevo con la misma memoria flash y la misma EEPROM.
  // "porReset" dice si fue un reset externo (pin de reset), que es lo
  // que el bootloader mira para decidir si se queda escuchando.
  encender(porReset, mcusr = 0) {
    const cpu = new CPU(this.flash);
    this.cpu = cpu;
    this.timers = [
      new AVRTimer(cpu, timer0Config),
      new AVRTimer(cpu, timer1Config),
      new AVRTimer(cpu, timer2Config),
    ];
    this.clock = new AVRClock(cpu, FRECUENCIA, clockConfig);
    this.usart = new AVRUSART(cpu, usart0Config, FRECUENCIA);
    this.puertos = {
      B: new AVRIOPort(cpu, portBConfig),
      C: new AVRIOPort(cpu, portCConfig),
      D: new AVRIOPort(cpu, portDConfig),
    };
    this.eepromPeriferico = new AVREEPROM(cpu, this.eeprom);
    this.watchdog = new AVRWatchdog(cpu, watchdogConfig, this.clock);

    cpu.data[MCUSR] = mcusr | (porReset ? MCUSR_EXTRF : 0);
    if (this.inicioBootloader !== null) {
      // Fusible BOOTRST: al encender arranca el bootloader, no el programa.
      cpu.pc = this.inicioBootloader >> 1;
    }

    // Un reset del watchdog (asi salta el bootloader al programa) se ve
    // aqui como cpu.reset(). Se reemplaza por un encendido completo.
    this.resetPendiente = null;
    const resetOriginal = cpu.reset.bind(cpu);
    cpu.reset = () => {
      resetOriginal();
      this.resetPendiente = 0x08;   // WDRF
    };

    this.usart.onByteTransmit = (b) => this.recibido(b);
    // Lo que va por el cable hacia el chip, y la memoria intermedia del
    // puerto serie del ATmega328P: ademas de UDR0, un segundo nivel de
    // FIFO y el registro de desplazamiento retienen dos bytes mas. En
    // total guarda TRES bytes sin leer (hoja de datos, seccion USART,
    // "Data OverRun"). Con solo dos, el simulador escondia una falla
    // real del programador: un byte sobrante de una sincronizacion.
    this.cable = [];
    this.transmitiendo = false;
    this.fifo = [];
    // avr8js borra la bandera de "byte recibido" (RXC) cada vez que el
    // programa escribe UCSR0B, y la libreria Serial de Arduino lo hace en
    // cada print para prender y apagar la interrupcion de envio. En el
    // chip real esa escritura no toca RXC. Sin esta correccion, un byte
    // que llega mientras la placa imprime algo se pierde en la
    // simulacion, cosa que no pasa en el Arduino de verdad.
    const escribirUCSRB = cpu.writeHooks[UCSR0B];
    cpu.writeHooks[UCSR0B] = (valor, anterior, direccion, mascara) => {
      const habiaByte = cpu.data[UCSR0A] & RXC0;
      const resultado = escribirUCSRB(valor, anterior, direccion, mascara);
      if (habiaByte && !(cpu.data[UCSR0A] & RXC0)) cpu.setInterruptFlag(this.usart.RXC);
      return resultado;
    };

    // Cuando el programa lee UDR0 se libera un lugar: entra el byte que
    // esperaba en la memoria intermedia.
    const leerUDR = cpu.readHooks[UDR0];
    cpu.readHooks[UDR0] = (direccion) => {
      const valor = leerUDR(direccion);
      if (this.fifo.length) {
        const b = this.fifo.shift();
        cpu.addClockEvent(() => this.usart.writeByte(b, true), 1);
      }
      return valor;
    };

    this.ultimoFlanco = new Map();
    for (const [nombre, puerto] of Object.entries(this.puertos)) {
      puerto.addListener((valor, anterior) => this.flancos(nombre, valor, anterior));
    }

    this.bufferPagina = new Uint16Array(64).fill(0xffff);
    this.reinicios++;
  }

  // Pulso por el pin de reset.
  reiniciar() {
    this.encender(true);
  }

  // ----------------- puerto serie -----------------

  // Los bytes solo pasan si el programa del chip esta escuchando a la
  // misma velocidad que el computador (con 3 % de tolerancia, como un
  // UART real). Si no, se pierden: asi se prueba la busqueda de
  // velocidad del programador.
  velocidadCoincide(baudios) {
    const r = this.usart.baudRate / baudios;
    return r > 0.97 && r < 1.03;
  }

  // Los bytes viajan uno detras de otro, al ritmo del cable. Al llegar,
  // si el programa no ha leido el anterior, el nuevo espera en la
  // memoria intermedia; si tambien esta llena, se pierde (overrun),
  // igual que en el chip real. Optiboot depende de esto: pasa sus
  // primeros 190 ms parpadeando el LED sin leer, y lo que sincroniza
  // despues son los PRIMEROS bytes que llegaron, no los ultimos.
  escribirDesdeComputador(bytes, baudios) {
    if (!this.velocidadCoincide(baudios)) return;
    for (const b of bytes) this.cable.push(b);
    if (!this.transmitiendo) this.siguienteEnCable();
  }

  siguienteEnCable() {
    if (!this.cable.length) {
      this.transmitiendo = false;
      return;
    }
    this.transmitiendo = true;
    const b = this.cable.shift();
    const cpu = this.cpu;
    cpu.addClockEvent(() => {
      if (cpu !== this.cpu) return;   // la placa se reinicio en el camino
      this.llegaByte(b);
      this.siguienteEnCable();
    }, this.usart.cyclesPerChar);
  }

  llegaByte(b) {
    if (!this.usart.rxEnable) return;
    if (this.cpu.data[UCSR0A] & RXC0) {
      if (this.fifo.length < 2) this.fifo.push(b);
      return;
    }
    this.usart.writeByte(b, true);
  }

  recibido(b) {
    if (this.alTransmitir) this.alTransmitir(b, this.usart.baudRate);
  }

  // ----------------- pines -----------------

  flancos(nombrePuerto, valor, anterior) {
    const cambiados = valor ^ anterior;
    for (let bit = 0; bit < 8; bit++) {
      if (!(cambiados & (1 << bit))) continue;
      const pin = nombrePuerto === 'D' ? bit : nombrePuerto === 'B' ? bit + 8 : bit + 14;
      const ahora = this.cpu.cycles;
      if (valor & (1 << bit)) {
        this.ultimoFlanco.set(pin, ahora);
      } else if (this.ultimoFlanco.has(pin)) {
        const inicio = this.ultimoFlanco.get(pin);
        const lista = this.pulsos.get(pin) || [];
        lista.push({ inicio: inicio / 16, ancho: (ahora - inicio) / 16 });
        if (lista.length > 200) lista.shift();
        this.pulsos.set(pin, lista);
      }
    }
  }

  // El ultimo ancho de pulso del pin, en microsegundos, o null.
  ultimoPulso(pin) {
    const lista = this.pulsos.get(pin);
    return lista && lista.length ? lista[lista.length - 1].ancho : null;
  }

  // El angulo que esta pidiendo el pulso, con la misma escala de la
  // libreria Servo (544 us = 0 grados, 2400 us = 180 grados).
  anguloEnPin(pin) {
    const ancho = this.ultimoPulso(pin);
    if (ancho === null) return null;
    return Math.round(((ancho - 544) * 180) / (2400 - 544));
  }

  // ----------------- reloj -----------------

  get milisegundos() {
    return this.cpu.cycles / 16000;
  }

  // Ejecuta el chip durante "ms" milisegundos de tiempo simulado.
  avanzar(ms) {
    const objetivo = this.cpu.cycles + ms * 16000;
    while (this.cpu.cycles < objetivo) {
      const cpu = this.cpu;
      if (cpu.progMem[cpu.pc] === 0x95e8) this.spm();
      avrInstruction(cpu);
      cpu.tick();
      if (this.resetPendiente !== null) {
        const flags = this.resetPendiente;
        this.encender(false, flags);
      }
    }
  }

  // La instruccion SPM: el bootloader escribe la flash con ella.
  spm() {
    const cpu = this.cpu;
    const control = cpu.data[SPMCSR];
    const z = cpu.data[30] | (cpu.data[31] << 8);
    const pagina = z & ~0x7f;
    const palabras = this.flash;
    switch (control & 0x1f) {
      case 0x01:   // llenar el buffer temporal con r1:r0
        this.bufferPagina[(z & 0x7f) >> 1] = cpu.data[0] | (cpu.data[1] << 8);
        break;
      case 0x03:   // borrar la pagina
        if (this.inicioBootloader === null || pagina < this.inicioBootloader) {
          palabras.fill(0xffff, pagina >> 1, (pagina >> 1) + 64);
        }
        break;
      case 0x05:   // escribir la pagina
        if (this.inicioBootloader === null || pagina < this.inicioBootloader) {
          for (let k = 0; k < 64; k++) palabras[(pagina >> 1) + k] &= this.bufferPagina[k];
        }
        this.bufferPagina.fill(0xffff);
        break;
      default:     // RWWSRE y otros: no hay nada que simular
        break;
    }
    cpu.data[SPMCSR] = control & ~0x41;   // termina en el acto
  }
}

// ---------------------------------------------------------------------
//  PUERTO CON LA FORMA DE WEB SERIAL
//
//  Se comporta como un SerialPort de Chrome conectado a la placa
//  simulada. La placa corre en tiempo real, en pedazos de 5 ms.
// ---------------------------------------------------------------------
export class PuertoSimulado {
  constructor(placa, info = { usbVendorId: 0x2341, usbProductId: 0x0043 }) {
    this.placa = placa;
    this.info = info;
    this.abierto = false;
    this.dtr = false;
    this.desconectado = false;
    this.reloj = null;
    this.registro = [];   // todo lo que manda el computador, para revisar
  }

  getInfo() {
    return this.info;
  }

  arrancarReloj() {
    if (this.reloj) return;
    let anterior = Date.now();
    this.reloj = setInterval(() => {
      const ahora = Date.now();
      // Si la pagina estuvo ocupada (la deteccion puede tomar 100 ms por
      // cuadro), la placa se pone al dia de una vez: un Arduino real no
      // se detiene porque el computador este ocupado.
      this.placa.avanzar(Math.min(ahora - anterior, 500));
      anterior = ahora;
    }, 5);
  }

  pararReloj() {
    clearInterval(this.reloj);
    this.reloj = null;
  }

  async open({ baudRate }) {
    if (this.desconectado) throw new DOMException('Failed to open serial port.', 'NetworkError');
    if (this.abierto) throw new DOMException('The port is already open.', 'InvalidStateError');
    this.baudios = baudRate;
    this.abierto = true;
    this.arrancarReloj();

    this.readable = new ReadableStream({
      start: (control) => {
        this.controlLectura = control;
        this.placa.alTransmitir = (b, baudiosChip) => {
          // Si las velocidades no coinciden, llega basura en vez del byte.
          const r = baudiosChip / this.baudios;
          const llega = r > 0.97 && r < 1.03 ? b : (b ^ 0x5a);
          try { control.enqueue(new Uint8Array([llega])); } catch (e) { /* cerrado */ }
        };
      },
      cancel: () => { this.placa.alTransmitir = null; },
    });
    this.writable = new WritableStream({
      write: (bytes) => {
        if (this.desconectado) throw new DOMException('The device has been lost.', 'NetworkError');
        this.registro.push(...bytes);
        this.placa.escribirDesdeComputador(bytes, this.baudios);
      },
    });

    // Abrir el puerto sube DTR, y en un Uno eso reinicia la placa.
    await this.setSignals({ dataTerminalReady: true });
  }

  async setSignals({ dataTerminalReady }) {
    if (!this.abierto) throw new DOMException('The port is closed.', 'InvalidStateError');
    if (dataTerminalReady !== undefined) {
      if (dataTerminalReady && !this.dtr) this.placa.reiniciar();
      this.dtr = dataTerminalReady;
    }
  }

  async close() {
    if (!this.abierto) throw new DOMException('The port is already closed.', 'InvalidStateError');
    try { this.controlLectura.close(); } catch (e) { /* ya cerrado */ }
    this.placa.alTransmitir = null;
    this.abierto = false;
    this.dtr = false;
    // La placa sigue encendida (la alimenta el USB), solo que nadie la
    // escucha. El reloj sigue corriendo.
  }

  // Simula que alguien tropieza con el cable.
  desconectar() {
    this.desconectado = true;
    this.pararReloj();
    if (this.controlLectura) {
      try { this.controlLectura.error(new DOMException('The device has been lost.', 'NetworkError')); } catch (e) { /* nada */ }
    }
    this.abierto = false;
    if (this.ondisconnect) this.ondisconnect();
  }

  // Para las pruebas de Node: soltar el reloj al terminar.
  apagar() {
    this.pararReloj();
  }
}
