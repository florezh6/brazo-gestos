// Lo que se habla con la placa: nombres de las claves de configuracion,
// pines validos y lectura de las lineas que responde.
//
// Debe coincidir con firmware/brazo_web/brazo_web.ino.

export const IDENTIDAD = 'IMEC-BRAZO v1';

// El saludo del programa original del taller (version Python). Se
// reconoce para poder decir "esta placa tiene el programa viejo".
export const SALUDO_ANTIGUO = 'Brazo listo.';

export const SERVOS = [
  { id: 'base', nombre: 'Base', pin: 'pin_base' },
  { id: 'altura', nombre: 'Altura', pin: 'pin_altura' },
  { id: 'alcance', nombre: 'Alcance', pin: 'pin_alcance' },
  { id: 'garra', nombre: 'Garra', pin: 'pin_garra' },
];

// Los angulos que se calibran, agrupados por servo, con el nombre que
// ve el profesor.
export const POSICIONES = [
  { clave: 'base_izq', servo: 'base', nombre: 'Tope al girar a la izquierda' },
  { clave: 'base_der', servo: 'base', nombre: 'Tope al girar a la derecha' },
  { clave: 'base_reposo', servo: 'base', nombre: 'Reposo al encender' },
  { clave: 'altura_arriba', servo: 'altura', nombre: 'Brazo arriba' },
  { clave: 'altura_abajo', servo: 'altura', nombre: 'Brazo abajo' },
  { clave: 'altura_reposo', servo: 'altura', nombre: 'Reposo al encender' },
  { clave: 'alcance', servo: 'alcance', nombre: 'Posición fija' },
  { clave: 'garra_cerrada', servo: 'garra', nombre: 'Cerrada' },
  { clave: 'garra_abierta', servo: 'garra', nombre: 'Abierta' },
];

// Los valores de fabrica del programa, medidos en el brazo del Uno el
// 9 de agosto. Solo para mostrarlos; la placa tiene los suyos.
export const DE_FABRICA = {
  pin_base: 9, pin_altura: 10, pin_alcance: 11, pin_garra: 3,
  base_izq: 145, base_der: 25, base_reposo: 90,
  altura_arriba: 80, altura_abajo: 45, altura_reposo: 62,
  alcance: 125,
  garra_cerrada: 90, garra_abierta: 130,
};

// Pines que sirven para un servo. Los 0 y 1 son los del cable USB.
export const PINES = [
  ...Array.from({ length: 12 }, (_, k) => ({ valor: k + 2, nombre: 'D' + (k + 2) })),
  ...Array.from({ length: 6 }, (_, k) => ({ valor: k + 14, nombre: 'A' + k })),
];

export function nombrePin(valor) {
  const p = PINES.find((x) => x.valor === Number(valor));
  return p ? p.nombre : String(valor);
}

export function pinValido(valor) {
  return PINES.some((p) => p.valor === Number(valor));
}

// Fabricantes de chip USB que se ven en placas Uno y Nano.
export const FILTROS_USB = [
  { usbVendorId: 0x2341 },   // Arduino SA (Uno original)
  { usbVendorId: 0x2a03 },   // Arduino.org
  { usbVendorId: 0x1a86 },   // CH340 (Nano y Uno clones)
  { usbVendorId: 0x0403 },   // FTDI (Nano antiguos)
  { usbVendorId: 0x10c4 },   // CP210x
];

export function nombreChipUsb(info) {
  return {
    0x2341: 'Arduino',
    0x2a03: 'Arduino',
    0x1a86: 'chip CH340, típico de Nano y Uno clones',
    0x0403: 'chip FTDI',
    0x10c4: 'chip CP210x',
  }[info && info.usbVendorId] || 'dispositivo USB serie';
}

// Clasifica una linea que llego de la placa.
export function leerLinea(linea) {
  const texto = linea.trim();
  let m;
  if (texto === IDENTIDAD) return { tipo: 'identidad' };
  if (texto === SALUDO_ANTIGUO || texto.startsWith('Brazo listo')) return { tipo: 'saludo' };
  if (texto === 'cfg fin') return { tipo: 'fin-config' };
  if ((m = texto.match(/^cfg (\w+)=(\d+)$/))) return { tipo: 'config', clave: m[1], valor: Number(m[2]) };
  if ((m = texto.match(/base=(\d+)\s+altura=(\d+)\s+alcance=(\d+)\s+garra=(\d+)/))) {
    return {
      tipo: 'angulos',
      ok: texto.startsWith('ok'),
      angulos: { base: +m[1], altura: +m[2], alcance: +m[3], garra: +m[4] },
    };
  }
  if (texto.startsWith('ok')) return { tipo: 'ok', texto: texto.slice(2).trim() };
  if (texto.startsWith('error')) return { tipo: 'error', texto: texto.slice(5).trim() };
  if (texto.startsWith('Sin senal')) return { tipo: 'watchdog' };
  return { tipo: 'otro', texto };
}

// Traduce los errores de la placa (sin tildes, por ser del Arduino) a
// un mensaje para el profesor.
export function traducirError(texto) {
  if (texto.startsWith('el pin ya lo usa')) {
    const otro = texto.split(' ').pop().replace('pin_', '');
    return `Ese pin ya lo usa el servo de ${otro}.`;
  }
  if (texto.startsWith('pin no valido')) return 'Ese pin no sirve para un servo. Use D2 a D13 o A0 a A5.';
  if (texto.startsWith('el angulo')) return 'El ángulo debe estar entre 0 y 180.';
  return 'La placa respondió «' + texto + '».';
}
