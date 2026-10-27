# Brazo por gestos

Versión web de la actividad de un brazo del taller IMEC de Ingeniería Mecánica, Universidad de los Andes. Un brazo EEZYbotARM con Arduino Uno o Nano obedece gestos de la mano reconocidos con MediaPipe en el navegador.

La página está en **https://florezh6.github.io/brazo-gestos/**. Funciona en Google Chrome y Microsoft Edge, en Windows y Mac, sin instalar nada. La guía para el profesor está en `guia.html`.

## Qué hace la página

- Detecta la mano con la cámara del portátil y cuenta los dedos de 0 a 5, con la misma regla y los mismos umbrales de la versión Python del 13 de agosto de 2026.
- Habla con el Arduino por Web Serial y carga en la placa el programa del taller con el botón «Preparar la placa», sin Arduino IDE.
- Permite cambiar los pines y los límites de cada servo desde la pestaña Brazo. Quedan guardados en la EEPROM de la placa.
- Funciona sin internet después de la primera visita, gracias a `sw.js`.

## Archivos

| Ruta | Qué es |
|---|---|
| `index.html`, `css/`, `js/` | La página. Sin paso de compilación. |
| `js/deteccion.js` | Conteo de dedos y estabilizador, traducidos línea por línea del Python. |
| `js/brazo.js`, `js/protocolo.js` | Conexión con la placa por Web Serial. |
| `js/programador.js` | Carga del `.hex` por el bootloader, protocolo STK500 v1. |
| `firmware/brazo_web/brazo_web.ino` | Programa de la placa. |
| `firmware/brazo_web.hex` | El mismo programa compilado, que es lo que carga la página. |
| `vendor/mediapipe/`, `modelo/` | MediaPipe Tasks Vision 1.0.1 y el modelo `hand_landmarker.task`, copiados en versión fija. |
| `pruebas/` | Pruebas con un Arduino simulado. La página no las carga. |

## Cambiar el programa de la placa

Después de editar `brazo_web.ino` hay que recompilar el `.hex`, porque es lo que carga la página:

```
arduino-cli compile --fqbn arduino:avr:uno --output-dir build firmware/brazo_web
cp build/brazo_web.ino.hex firmware/brazo_web.hex
```

El mismo `.hex` sirve para Uno y Nano. Si cambian las órdenes de configuración, hay que actualizar `js/protocolo.js`.

## Pruebas

```
npm install
npm test                         # programa de la placa, programador, conexión y paridad con Python
node pruebas/servidor.mjs        # en otra terminal
node pruebas/navegador.mjs       # usuario simulado en Chrome
```

Las pruebas corren el `.hex` real en avr8js, un emulador del ATmega328P, junto con los bootloaders reales de Arduino. `pruebas/generar_paridad.py` extrae `contar_dedos` del archivo Python original y genera los casos con los que se compara la versión JavaScript.

Lo único que no se puede simular es el reinicio de la placa por la línea DTR del USB. Eso se prueba con el brazo real.
