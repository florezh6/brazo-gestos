// Un navigator.serial falso para las pruebas en el navegador. Detras
// hay un Arduino Uno simulado (placa_simulada.js) que corre el .hex
// real. Lo instala pruebas/navegador.mjs antes de que cargue la pagina;
// la pagina publicada nunca lo usa.

import { PlacaSimulada, PuertoSimulado } from './placa_simulada.js';

const leer = (ruta) => fetch(new URL(ruta, import.meta.url)).then((r) => r.text());

export async function crear(escenario, serial) {
  const bootloader = await leer('./bootloaders/optiboot_atmega328.hex');
  let app = null;
  if (escenario.programa === 'nuevo') app = await leer('../firmware/brazo_web.hex');
  if (escenario.programa === 'antiguo') app = await leer('./firmware_antiguo.hex');

  const placa = new PlacaSimulada({ app, bootloader });
  const puerto = new PuertoSimulado(placa);
  const falso = { placa, puerto, autorizado: !!escenario.autorizado };

  puerto.ondisconnect = () => {
    const e = new Event('disconnect');
    Object.defineProperty(e, 'port', { value: puerto });
    serial.dispatchEvent(e);
  };

  // Volver a enchufar el cable.
  falso.enchufar = () => {
    puerto.desconectado = false;
    placa.reiniciar();
    const e = new Event('connect');
    Object.defineProperty(e, 'port', { value: puerto });
    serial.dispatchEvent(e);
  };

  return falso;
}
