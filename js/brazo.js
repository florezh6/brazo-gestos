// El cable entre la pagina y el Arduino, por Web Serial.
//
// Mismo principio que la clase Brazo de la version Python: si el
// Arduino no aparece, o se desconecta en pleno taller, todo lo de aqui
// se vuelve silencioso y la deteccion sigue funcionando sin brazo. Una
// camara congelada frente a 20 estudiantes es peor que un brazo quieto.

import {
  IDENTIDAD, FILTROS_USB, leerLinea, nombreChipUsb,
} from './protocolo.js';
import { programar } from './programador.js';
import { LETRA_LATIDO, LETRA_PAUSA } from './mapeo.js';

const BAUDIOS = 115200;

// EL LATIDO. El Arduino tiene un watchdog: si pasan 400 ms sin recibir
// NADA por el cable, detiene el brazo solo. Mientras el operador
// SOSTIENE un gesto no se manda nada nuevo, asi que sin latido el brazo
// se detendria cada 400 ms a mitad de un giro. 100 ms contra 400 ms da
// margen para que se pierdan tres latidos seguidos.
const MS_ENTRE_LATIDOS = 100;

// Al abrir el puerto la placa se REINICIA. El bootloader del Uno tarda
// cerca de 1,7 s en cederle el control al programa, y el viejo de los
// Nano clones un poco mas.
const MS_ESPERA_SALUDO = 3500;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Estados posibles, con el texto que ve el profesor.
export const ESTADOS = {
  'sin-soporte': 'Este navegador no puede hablar con el Arduino',
  'desconectado': 'Brazo sin conectar',
  'conectando': 'Conectando…',
  'listo': 'Brazo conectado',
  'programa-antiguo': 'Brazo conectado, con el programa anterior',
  'sin-programa': 'La placa no tiene el programa del taller',
  'ocupado': 'El puerto está ocupado',
  'otra-pestana': 'El brazo se está usando en otra pestaña',
  'programando': 'Cargando el programa en la placa…',
  'perdido': 'Se perdió la conexión con el brazo',
};

export class Brazo extends EventTarget {
  constructor(serial = globalThis.navigator && navigator.serial, candados = globalThis.navigator && navigator.locks) {
    super();
    this.serial = serial;
    this.candados = candados;
    this.puerto = null;
    this.estado = serial ? 'desconectado' : 'sin-soporte';
    this.detalle = '';
    this.config = {};
    this.angulos = null;
    this.ultimoEnvio = 0;
    this.latidoActivo = true;
    this.esperandoRespuesta = null;
    this.colaOrdenes = Promise.resolve();
    this.lineaParcial = '';

    if (serial) {
      // Si alguien desenchufa el cable.
      serial.addEventListener('disconnect', (e) => {
        if (e.target === this.puerto || (e.port && e.port === this.puerto)) this.perdido();
      });
      // Si se vuelve a enchufar una placa que ya se habia autorizado.
      serial.addEventListener('connect', () => {
        if (this.estado === 'desconectado' || this.estado === 'perdido') this.reconectar();
      });
    }
  }

  get conectado() {
    return this.estado === 'listo' || this.estado === 'programa-antiguo';
  }

  // Solo el programa del taller entiende las ordenes de configuracion.
  get configurable() {
    return this.estado === 'listo';
  }

  cambiarEstado(estado, detalle = '') {
    this.estado = estado;
    this.detalle = detalle;
    this.dispatchEvent(new CustomEvent('estado', { detail: { estado, detalle } }));
  }

  anotar(sentido, texto) {
    this.dispatchEvent(new CustomEvent('consola', { detail: { sentido, texto } }));
  }

  // Abre la ventanita del navegador para elegir la placa. "todos" la
  // abre sin filtro, para placas con un chip USB poco comun.
  async elegir(todos = false) {
    if (!this.serial) return false;
    let puerto;
    try {
      puerto = await this.serial.requestPort(todos ? {} : { filters: FILTROS_USB });
    } catch (e) {
      // El usuario cerro la ventanita sin elegir: no es un error.
      return false;
    }
    await this.desconectar();
    return this.abrir(puerto);
  }

  // Al cargar la pagina: si ya hay una placa autorizada y enchufada,
  // se conecta sola, sin preguntar.
  async reconectar() {
    if (!this.serial || this.conectado || this.estado === 'conectando' || this.estado === 'programando') return false;
    const puertos = await this.serial.getPorts();
    if (!puertos.length) return false;
    return this.abrir(puertos[0]);
  }

  // Toma el candado que comparten las pestanas de esta pagina. Si otra
  // pestana ya tiene el brazo, esta no lo toca: dos programas mandando
  // ordenes a la vez es justo la trampa del MONITOR SERIE del 9 de
  // agosto.
  async tomarCandado() {
    if (!this.candados) return true;
    if (this.soltarCandado) return true;
    return new Promise((resolver) => {
      this.candados.request('imec-brazo', { ifAvailable: true }, (candado) => {
        if (!candado) {
          resolver(false);
          return undefined;
        }
        resolver(true);
        return new Promise((soltar) => { this.soltarCandado = soltar; });
      });
    });
  }

  liberarCandado() {
    if (this.soltarCandado) this.soltarCandado();
    this.soltarCandado = null;
  }

  async abrir(puerto) {
    this.cambiarEstado('conectando', nombreChipUsb(puerto.getInfo()));

    if (!(await this.tomarCandado())) {
      this.cambiarEstado('otra-pestana');
      return false;
    }

    try {
      await puerto.open({ baudRate: BAUDIOS });
    } catch (e) {
      this.liberarCandado();
      this.cambiarEstado('ocupado');
      return false;
    }

    this.puerto = puerto;
    this.escritor = puerto.writable.getWriter();
    this.config = {};
    this.angulos = null;
    this.vioIdentidad = false;
    this.vioSaludo = false;
    this.leer();
    this.anotar('sistema', 'Puerto abierto. La placa se reinicia al conectar; espere unos segundos.');

    // PRUEBA DE VIDA. Al arrancar, el programa del taller saluda y dice
    // quien es. Si no llega nada, el puerto esta abierto pero al otro
    // lado no contesta nadie que conozcamos.
    const fin = Date.now() + MS_ESPERA_SALUDO;
    while (Date.now() < fin && !this.vioIdentidad && this.puerto) await esperar(50);
    if (!this.puerto) return false;
    // Se pregunta solo si la placa no dijo NADA conocido, y con "#ver",
    // que no tiene ninguna letra de movimiento: el programa de agosto no
    // entiende el '#' y leeria "#info" como i = girar a la izquierda y
    // o = abrir la garra.
    if (!this.vioIdentidad && !this.vioSaludo) {
      await this.escribirTexto('#ver\n');
      await esperar(400);
    }

    if (this.vioIdentidad) {
      this.enviar(LETRA_PAUSA);
      this.arrancarLatido();
      this.cambiarEstado('listo', nombreChipUsb(puerto.getInfo()));
      await this.leerConfiguracion();
      return true;
    }
    if (this.vioSaludo) {
      // Programa del taller de agosto: entiende las letras de
      // movimiento, pero no la configuracion de pines.
      this.enviar(LETRA_PAUSA);
      this.arrancarLatido();
      this.cambiarEstado('programa-antiguo', nombreChipUsb(puerto.getInfo()));
      return true;
    }
    this.cambiarEstado('sin-programa', nombreChipUsb(puerto.getInfo()));
    return false;
  }

  async leer() {
    const puerto = this.puerto;
    const decodificador = new TextDecoder();
    try {
      this.lector = puerto.readable.getReader();
      for (;;) {
        const { value, done } = await this.lector.read();
        if (done) break;
        this.lineaParcial += decodificador.decode(value, { stream: true });
        let corte;
        while ((corte = this.lineaParcial.search(/\r?\n/)) >= 0) {
          const linea = this.lineaParcial.slice(0, corte);
          this.lineaParcial = this.lineaParcial.slice(corte).replace(/^\r?\n/, '');
          if (linea.trim()) this.recibir(linea.trim());
        }
      }
    } catch (e) {
      // Se cerro el puerto o se desenchufo el cable.
      if (this.puerto === puerto) this.perdido();
    } finally {
      try { this.lector.releaseLock(); } catch (e) { /* nada */ }
    }
  }

  recibir(linea) {
    this.anotar('placa', linea);
    const r = leerLinea(linea);
    if (r.tipo === 'identidad') this.vioIdentidad = true;
    if (r.tipo === 'saludo') this.vioSaludo = true;
    if (r.tipo === 'config') this.config[r.clave] = r.valor;
    if (r.tipo === 'angulos') {
      this.angulos = r.angulos;
      this.dispatchEvent(new CustomEvent('angulos', { detail: r.angulos }));
    }
    if (this.esperandoRespuesta) this.esperandoRespuesta(r);
  }

  async escribirTexto(texto) {
    if (!this.escritor) return;
    try {
      await this.escritor.write(new TextEncoder().encode(texto));
      this.ultimoEnvio = Date.now();
    } catch (e) {
      this.perdido();
    }
  }

  // Manda una letra de movimiento. No hace nada si no hay brazo.
  enviar(letra) {
    if (!this.escritor) return;
    if (letra !== LETRA_LATIDO) {
      this.anotar('pagina', letra);
      this.giro = letra === 'i' || letra === 'd' ? letra : null;
    }
    this.escribirTexto(letra);
  }

  // Manda una orden de configuracion y espera su respuesta. Las ordenes
  // van en fila, una a la vez, para no mezclar las respuestas.
  orden(texto, msLimite = 1500) {
    const tarea = this.colaOrdenes.then(() => this.ordenAhora(texto, msLimite));
    this.colaOrdenes = tarea.catch(() => {});
    return tarea;
  }

  async ordenAhora(texto, msLimite) {
    if (!this.escritor) throw new Error('El brazo no está conectado.');
    const esConfig = texto === 'config';
    const respuesta = new Promise((resolver, rechazar) => {
      const reloj = setTimeout(() => {
        this.esperandoRespuesta = null;
        rechazar(new Error('La placa no respondió a tiempo.'));
      }, msLimite);
      this.esperandoRespuesta = (r) => {
        const termina = esConfig ? r.tipo === 'fin-config'
          : r.tipo === 'ok' || r.tipo === 'error' || r.tipo === 'identidad' || (r.tipo === 'angulos' && r.ok);
        if (!termina) return;
        clearTimeout(reloj);
        this.esperandoRespuesta = null;
        resolver(r);
      };
    });
    this.anotar('pagina', '#' + texto);
    this.giro = null;
    await this.escribirTexto('#' + texto + '\n');
    return respuesta;
  }

  async leerConfiguracion() {
    try {
      await this.orden('config');
      this.dispatchEvent(new CustomEvent('config', { detail: { ...this.config } }));
    } catch (e) {
      this.anotar('sistema', 'No se pudo leer la configuración de la placa.');
    }
    return this.config;
  }

  // Relee la configuracion despues de un cambio, sin tratarla como
  // recien conectada.
  async leerConfiguracionSinBorrar() {
    if (!this.configurable) return this.config;
    try {
      await this.orden('config');
      this.dispatchEvent(new CustomEvent('config-actualizada', { detail: { ...this.config } }));
    } catch (e) { /* la placa dira lo suyo en la consola */ }
    return this.config;
  }

  // Mientras se sostiene un giro, el latido repite la letra del giro en
  // vez del punto. Si la pagina se atraso mas de 400 ms (un computador
  // lento, o la deteccion ocupada) el watchdog de la placa detiene la
  // base; con un punto, la base se quedaria quieta aunque el gesto
  // siga sostenido. Repitiendo la letra, retoma sola. Para las demas
  // ordenes no hace falta: subir, bajar, abrir y cerrar no se detienen
  // con el watchdog.
  arrancarLatido() {
    this.pararLatido();
    this.reloj = setInterval(() => {
      if (!this.latidoActivo || !this.escritor) return;
      if (Date.now() - this.ultimoEnvio >= MS_ENTRE_LATIDOS) {
        this.escribirTexto(this.giro || LETRA_LATIDO);
      }
    }, 25);
  }

  pararLatido() {
    clearInterval(this.reloj);
    this.reloj = null;
  }

  // Con la pestana en segundo plano el navegador frena los relojes y
  // la deteccion se detiene. Mejor dejar el brazo quieto a proposito:
  // se manda la pausa y se deja de latir, y el watchdog de la placa
  // hace el resto.
  suspender() {
    this.enviar(LETRA_PAUSA);   // tambien apaga la repeticion del giro
    this.latidoActivo = false;
  }

  reanudar() {
    this.latidoActivo = true;
  }

  perdido() {
    if (!this.puerto) return;
    this.cerrarEnSilencio();
    this.cambiarEstado('perdido');
  }

  cerrarEnSilencio() {
    this.pararLatido();
    const puerto = this.puerto;
    this.puerto = null;
    if (this.lector) this.lector.cancel().catch(() => {});
    try { this.escritor && this.escritor.releaseLock(); } catch (e) { /* nada */ }
    this.escritor = null;
    this.lector = null;
    this.lineaParcial = '';
    if (puerto) puerto.close().catch(() => {});
    this.liberarCandado();
    return puerto;
  }

  // Deja el brazo quieto y suelta el puerto.
  async desconectar() {
    if (!this.puerto) return null;
    if (this.escritor) {
      try {
        await this.escritor.write(new TextEncoder().encode(LETRA_PAUSA));
      } catch (e) { /* nada */ }
    }
    this.pararLatido();
    const puerto = this.puerto;
    this.puerto = null;
    try { await this.lector.cancel(); } catch (e) { /* nada */ }
    await esperar(20);
    try { this.escritor.releaseLock(); } catch (e) { /* nada */ }
    this.escritor = null;
    this.lineaParcial = '';
    try { await puerto.close(); } catch (e) { /* nada */ }
    this.liberarCandado();
    this.cambiarEstado('desconectado');
    return puerto;
  }

  // Carga el programa del taller en la placa conectada (o en la ultima
  // elegida) y vuelve a conectar.
  async preparar(textoHex, alAvanzar) {
    let puerto = this.puerto || this.ultimoPuerto;
    if (this.puerto) await this.desconectar();
    if (!puerto) {
      const puertos = this.serial ? await this.serial.getPorts() : [];
      puerto = puertos[0];
    }
    if (!puerto) throw new Error('Primero conecte la placa con el botón «Conectar brazo».');

    if (!(await this.tomarCandado())) {
      this.cambiarEstado('otra-pestana');
      throw new Error('El brazo se está usando en otra pestaña. Ciérrela y vuelva a intentar.');
    }
    this.cambiarEstado('programando');
    try {
      const resumen = await programar(puerto, textoHex, alAvanzar);
      this.anotar('sistema', `Programa cargado: ${resumen.bytes} bytes, ${resumen.bootloader}.`);
      this.liberarCandado();
      await esperar(300);
      await this.abrir(puerto);
      return resumen;
    } catch (e) {
      this.liberarCandado();
      this.cambiarEstado('desconectado');
      throw e;
    }
  }

  set puerto(p) {
    this._puerto = p;
    if (p) this.ultimoPuerto = p;
  }

  get puerto() {
    return this._puerto;
  }
}

export { IDENTIDAD };
