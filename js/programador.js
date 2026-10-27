// Carga el programa del taller en la placa, por el mismo cable USB.
//
// Hace lo mismo que el boton "Subir" del Arduino IDE, pero desde la
// pagina: reinicia la placa para que entre a su bootloader (el pequeno
// programa de fabrica que sabe recibir programas nuevos), le habla en
// su idioma, que es el protocolo STK500 version 1, y le escribe el
// archivo .hex pagina por pagina. Despues relee todo y lo compara.
//
// Sirve para Arduino Uno y Nano, que usan el mismo chip (ATmega328P).
// El Uno y los Nano nuevos traen el bootloader "optiboot" a 115200
// baudios; muchos Nano clones traen el viejo, a 57600. Se prueban los
// dos, en ese orden.

// ---------------------------------------------------------------------
//  ARCHIVO .HEX
//
//  Es texto. Cada linea empieza con ':' y trae unos pocos bytes del
//  programa y la direccion donde van. Esta funcion lo convierte en una
//  imagen de la memoria del chip.
// ---------------------------------------------------------------------
export function leerHex(texto) {
  const bytes = new Map();
  let base = 0;
  let fin = false;

  const lineas = texto.split(/\r?\n/);
  for (let n = 0; n < lineas.length; n++) {
    const linea = lineas[n].trim();
    if (linea === '') continue;
    if (fin) break;
    if (linea[0] !== ':') {
      throw new Error('El archivo .hex está dañado (línea ' + (n + 1) + ').');
    }

    const datos = [];
    for (let k = 1; k < linea.length; k += 2) {
      datos.push(parseInt(linea.substr(k, 2), 16));
    }
    if (datos.some(Number.isNaN)) {
      throw new Error('El archivo .hex está dañado (línea ' + (n + 1) + ').');
    }
    const suma = datos.reduce((a, b) => a + b, 0) & 0xff;
    if (suma !== 0) {
      throw new Error('El archivo .hex está dañado. Falla la suma de verificación en la línea ' + (n + 1) + '.');
    }

    const largo = datos[0];
    const direccion = (datos[1] << 8) | datos[2];
    const tipo = datos[3];
    const carga = datos.slice(4, 4 + largo);

    if (tipo === 0x00) {
      carga.forEach((b, k) => bytes.set(base + direccion + k, b));
    } else if (tipo === 0x01) {
      fin = true;
    } else if (tipo === 0x02) {
      base = ((carga[0] << 8) | carga[1]) * 16;
    } else if (tipo === 0x04) {
      base = ((carga[0] << 8) | carga[1]) * 65536;
    }
    // Los tipos 03 y 05 solo dicen donde arranca el programa: no se usan.
  }

  if (bytes.size === 0) {
    throw new Error('El archivo .hex está vacío.');
  }

  const direcciones = [...bytes.keys()];
  const inicio = Math.min(...direcciones);
  const final = Math.max(...direcciones) + 1;
  // Lo que el archivo no menciona queda en 0xFF, que es como queda la
  // memoria flash borrada.
  const imagen = new Uint8Array(final - inicio).fill(0xff);
  for (const [dir, b] of bytes) imagen[dir - inicio] = b;
  return { inicio, datos: imagen };
}

// ---------------------------------------------------------------------
//  PROTOCOLO STK500 v1
// ---------------------------------------------------------------------
const STK = {
  OK: 0x10,
  INSYNC: 0x14,
  CRC_EOP: 0x20,
  GET_SYNC: 0x30,
  ENTER_PROGMODE: 0x50,
  LEAVE_PROGMODE: 0x51,
  LOAD_ADDRESS: 0x55,
  PROG_PAGE: 0x64,
  READ_PAGE: 0x74,
  READ_SIGN: 0x75,
};

// ATmega328P (0x0F) y ATmega328 sin P (0x14). Cualquier otra cosa no es
// una placa que este programa sepa manejar.
const FIRMAS_VALIDAS = [
  [0x1e, 0x95, 0x0f],
  [0x1e, 0x95, 0x14],
];

const TAMANO_PAGINA = 128;

// El bootloader ocupa el final de la memoria; el programa no puede
// pasar de aqui. Es el limite del Nano con bootloader viejo, el mas
// chico de los dos.
const MAXIMO_PROGRAMA = 30720;

// Un error con un mensaje pensado para mostrarse tal cual al profesor.
export class ErrorProgramador extends Error {}

// Lee bytes del puerto con tiempo limite. El lector de Web Serial no
// tiene "lee exactamente N bytes"; esta clase lo arma encima.
class Lector {
  constructor(readable) {
    this.lector = readable.getReader();
    this.buffer = [];
    this.esperando = null;
    this.cerrado = false;
    this.bombear();
  }

  async bombear() {
    try {
      for (;;) {
        const { value, done } = await this.lector.read();
        if (done) break;
        for (const b of value) this.buffer.push(b);
        if (this.esperando) this.esperando();
      }
    } catch (e) {
      // El puerto se cerro o se desconecto el cable.
    }
    this.cerrado = true;
    if (this.esperando) this.esperando();
  }

  vaciar() {
    this.buffer = [];
  }

  async leer(cantidad, msLimite) {
    const limite = Date.now() + msLimite;
    while (this.buffer.length < cantidad) {
      if (this.cerrado) throw new ErrorProgramador('Se perdió la conexión con la placa.');
      const falta = limite - Date.now();
      if (falta <= 0) return null;
      await new Promise((resolver) => {
        const reloj = setTimeout(resolver, falta);
        this.esperando = () => { clearTimeout(reloj); resolver(); };
      });
      this.esperando = null;
    }
    return this.buffer.splice(0, cantidad);
  }

  async soltar() {
    try { await this.lector.cancel(); } catch (e) { /* ya estaba cerrado */ }
    try { this.lector.releaseLock(); } catch (e) { /* idem */ }
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

class Sesion {
  constructor(puerto) {
    this.puerto = puerto;
  }

  async abrir(baudios) {
    await this.puerto.open({ baudRate: baudios });
    this.escritor = this.puerto.writable.getWriter();
    this.lector = new Lector(this.puerto.readable);
  }

  async cerrar() {
    if (this.lector) await this.lector.soltar();
    if (this.escritor) {
      try { this.escritor.releaseLock(); } catch (e) { /* nada */ }
    }
    try { await this.puerto.close(); } catch (e) { /* ya cerrado */ }
    this.lector = null;
    this.escritor = null;
  }

  // Reinicia la placa. En el Uno y el Nano, la linea DTR del puerto
  // esta conectada al pin de reset a traves de un condensador: bajarla
  // y volverla a subir produce un pulso que reinicia el chip, y el
  // bootloader queda escuchando cerca de un segundo.
  async reiniciar() {
    await this.puerto.setSignals({ dataTerminalReady: false, requestToSend: false });
    await esperar(250);
    await this.puerto.setSignals({ dataTerminalReady: true, requestToSend: true });
    await esperar(50);
    this.lector.vaciar();
  }

  async enviar(bytes) {
    await this.escritor.write(new Uint8Array(bytes));
  }

  // Manda una orden y espera INSYNC, la respuesta, y OK.
  async orden(bytes, largoRespuesta = 0, msLimite = 500) {
    await this.enviar([...bytes, STK.CRC_EOP]);
    const r = await this.lector.leer(largoRespuesta + 2, msLimite);
    if (r === null) {
      throw new ErrorProgramador('La placa dejó de responder mientras se programaba.');
    }
    if (r[0] !== STK.INSYNC || r[r.length - 1] !== STK.OK) {
      throw new ErrorProgramador('La placa respondió algo inesperado mientras se programaba.');
    }
    return r.slice(1, 1 + largoRespuesta);
  }

  // Intenta sincronizar con el bootloader varias veces. Devuelve true
  // si contesto.
  async sincronizar() {
    for (let intento = 0; intento < 10; intento++) {
      this.lector.vaciar();
      await this.enviar([STK.GET_SYNC, STK.CRC_EOP]);
      const r = await this.lector.leer(2, 150);
      if (r && r[0] === STK.INSYNC && r[1] === STK.OK) {
        // Puede quedar algun eco de los intentos anteriores.
        await esperar(30);
        this.lector.vaciar();
        return true;
      }
    }
    return false;
  }
}

// Velocidades que se prueban, en orden.
const VELOCIDADES = [
  { baudios: 115200, nombre: 'bootloader optiboot (Uno, Nano nuevo)' },
  { baudios: 57600, nombre: 'bootloader viejo (Nano clon)' },
];

// Carga el programa. "puerto" es un SerialPort de Web Serial, CERRADO.
// "alAvanzar" recibe { fase, hecho, total } para la barra de progreso.
// Devuelve un resumen de lo que se hizo; si algo falla, lanza un
// ErrorProgramador con un mensaje para mostrar.
export async function programar(puerto, textoHex, alAvanzar = () => {}) {
  const { inicio, datos } = leerHex(textoHex);
  if (inicio !== 0) {
    throw new ErrorProgramador('El archivo .hex no empieza en la dirección 0.');
  }
  if (datos.length > MAXIMO_PROGRAMA) {
    throw new ErrorProgramador('El programa no cabe en la placa.');
  }

  // Se rellena hasta completar la ultima pagina.
  const paginas = Math.ceil(datos.length / TAMANO_PAGINA);
  const imagen = new Uint8Array(paginas * TAMANO_PAGINA).fill(0xff);
  imagen.set(datos);

  const sesion = new Sesion(puerto);
  let velocidad = null;

  try {
    alAvanzar({ fase: 'buscando', hecho: 0, total: paginas });
    for (const v of VELOCIDADES) {
      try {
        await sesion.abrir(v.baudios);
      } catch (e) {
        throw new ErrorProgramador(
          'No se pudo abrir el puerto. Cierre el Arduino IDE o cualquier otra pestaña que esté usando la placa y vuelva a intentar.');
      }
      await sesion.reiniciar();
      if (await sesion.sincronizar()) {
        velocidad = v;
        break;
      }
      await sesion.cerrar();
    }

    if (!velocidad) {
      throw new ErrorProgramador(
        'La placa no respondió como un Arduino Uno o Nano. Revise que el cable USB sea de datos y no solo de carga, y que la placa sea un Uno o un Nano.');
    }

    const firma = await sesion.orden([STK.READ_SIGN], 3);
    if (!FIRMAS_VALIDAS.some((f) => f.every((b, k) => b === firma[k]))) {
      throw new ErrorProgramador(
        'La placa respondió, pero no tiene el chip de un Arduino Uno o Nano, el ATmega328P. Este programa solo sirve para esas dos placas.');
    }

    await sesion.orden([STK.ENTER_PROGMODE]);

    for (let p = 0; p < paginas; p++) {
      const direccionPalabra = (p * TAMANO_PAGINA) >> 1;
      await sesion.orden([STK.LOAD_ADDRESS, direccionPalabra & 0xff, direccionPalabra >> 8]);
      const pagina = imagen.subarray(p * TAMANO_PAGINA, (p + 1) * TAMANO_PAGINA);
      await sesion.orden([STK.PROG_PAGE, 0, TAMANO_PAGINA, 0x46, ...pagina], 0, 1000);
      alAvanzar({ fase: 'escribiendo', hecho: p + 1, total: paginas });
    }

    for (let p = 0; p < paginas; p++) {
      const direccionPalabra = (p * TAMANO_PAGINA) >> 1;
      await sesion.orden([STK.LOAD_ADDRESS, direccionPalabra & 0xff, direccionPalabra >> 8]);
      const leida = await sesion.orden([STK.READ_PAGE, 0, TAMANO_PAGINA, 0x46], TAMANO_PAGINA, 1000);
      for (let k = 0; k < TAMANO_PAGINA; k++) {
        if (leida[k] !== imagen[p * TAMANO_PAGINA + k]) {
          throw new ErrorProgramador(
            'El programa se escribió, pero al releerlo no coincide. Vuelva a intentar. Si se repite, la placa puede estar dañada.');
        }
      }
      alAvanzar({ fase: 'verificando', hecho: p + 1, total: paginas });
    }

    // Al salir, el bootloader reinicia la placa y arranca el programa.
    await sesion.orden([STK.LEAVE_PROGMODE]);
    alAvanzar({ fase: 'listo', hecho: paginas, total: paginas });
    return { bytes: datos.length, paginas, bootloader: velocidad.nombre, firma };
  } finally {
    await sesion.cerrar();
  }
}
