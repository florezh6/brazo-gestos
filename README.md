# Al alcance de la mano

Actividad del Departamento de Ingeniería Mecánica de la Universidad de los Andes. Un brazo EEZYbotARM con Arduino Uno o Nano obedece gestos de la mano reconocidos con MediaPipe en el navegador.

La página está en **https://florezh6.github.io/brazo-gestos/**. Funciona en Google Chrome y Microsoft Edge, en Windows y Mac, sin instalar nada. La guía para el profesor es una pestaña de la misma página.

## Qué hace la página

- Detecta la mano con la cámara del portátil y cuenta los dedos de 0 a 5, con la misma regla y los mismos umbrales de la versión Python del 13 de agosto de 2026.
- Habla con el Arduino por Web Serial y carga en la placa el programa del taller con el botón «Preparar la placa», sin Arduino IDE.
- Permite cambiar los pines y los límites de cada servo desde la pestaña Brazo. Quedan guardados en la EEPROM de la placa.
- Funciona sin internet después de la primera visita, gracias a `sw.js`.

## Archivos

| Ruta | Qué es |
|---|---|
| `index.html`, `css/`, `js/` | La página, con las pestañas Actividad, Cómo funciona, Brazo y Guía. Sin paso de compilación. |
| `marca/` | Logos oficiales del departamento, tomados de mecanica.uniandes.edu.co, y la Mechita provisional. |
| `js/deteccion.js` | Conteo de dedos y estabilizador, traducidos línea por línea del Python. |
| `js/brazo.js`, `js/protocolo.js` | Conexión con la placa por Web Serial. |
| `js/programador.js` | Carga del `.hex` por el bootloader, protocolo STK500 v1. |
| `firmware/brazo_web/brazo_web.ino` | Programa de la placa. |
| `firmware/brazo_web.hex` | El mismo programa compilado, que es lo que carga la página. |
| `vendor/mediapipe/`, `modelo/` | MediaPipe Tasks Vision 1.0.1 y el modelo `hand_landmarker.task`, copiados en versión fija. |
| `pruebas/` | Pruebas con un Arduino simulado. La página no las carga. |

## Antes de publicar un cambio

```
python3 herramientas/diagramas.py   # si se tocaron los diagramas
python3 herramientas/versionar.py   # siempre que cambie CSS o JavaScript
npm test
```

`versionar.py` pone en `index.html` un código sacado del contenido en la dirección de cada CSS y JavaScript, como `estilo.css?v=3f9a2c`. Sin eso, el navegador puede seguir usando un archivo viejo de su memoria y mezclar versiones: HTML nuevo con CSS viejo. `npm test` falla si se olvida.

`sw.js` pide los archivos de la página primero a internet y usa lo guardado solo sin conexión. MediaPipe y el modelo se sirven siempre de lo guardado.

Para probar que una actualización llega limpia, con dos copias del sitio, la publicada y la nueva:

```
node pruebas/servidor_pages.mjs <copia publicada>        # imita a GitHub Pages, puerto 8766
node pruebas/actualizacion.mjs <copia publicada> <copia nueva> <selector solo en el HTML nuevo> <selector solo en el CSS nuevo>
```

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
