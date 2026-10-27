# Estado del desarrollo

Última actualización: 27 de octubre de 2026.

Plan aprobado: `~/.claude/plans/s-vamos-con-la-rippling-lampson.md`.

## Hecho y verificado

La página está publicada en https://florezh6.github.io/brazo-gestos/ desde el commit `538d1a0`. Incluye la actividad, la pestaña Brazo, la guía y el formulario.

| Parte | Cómo se verificó | Resultado |
|---|---|---|
| Programa de la placa `brazo_web.ino` | 14 pruebas con el `.hex` real en avr8js | Todas pasan |
| Programador desde el navegador | Contra optiboot real del Uno y el bootloader viejo del Nano, en avr8js | Escribe, verifica y el programa arranca en los dos |
| Conexión `brazo.js` | 7 pruebas contra la placa simulada | Todas pasan, tres vueltas seguidas |
| Regla de conteo | Comparada con `contar_dedos` del Python original en 12 000 manos sintéticas | Idéntica. Con margen 0,10 difieren 230, así que la prueba sí detecta cambios |
| Detección de punta a punta | Video real de Hugo, 294 cuadros, página contra el Python del taller | 99,7 % de cuadros iguales |
| Usuario simulado en Chrome | 13 escenarios en `pruebas/navegador.mjs`, en localhost y en la página publicada | Todos pasan |

Escenarios del usuario simulado: arranque, cargar el diseño de un equipo, placa vacía y prepararla, programa de agosto, pines con cambio e intercambio y guardado, control manual y consola, desconexión y reconexión, dos pestañas, navegador sin Web Serial, sin internet, tres tamaños de pantalla, cámara negada y navegador sin aceleración gráfica.

Comandos para repetir todo:

```
cd ~/Git/brazo-gestos
npm install
npm test
node pruebas/servidor.mjs            # en otra terminal
node pruebas/navegador.mjs capturas
BASE=https://florezh6.github.io/brazo-gestos/ node pruebas/navegador.mjs capturas
```

## Pendiente, en orden

1. **Prueba en Windows: hecha el 27 de octubre por Parsec, salvo la cámara.** En Edge sobre Windows 11, la página publicada carga completa, el modelo de la mano corre en la tarjeta gráfica y «Conectar brazo» abre la ventana de puertos de Web Serial, que sin Arduino dice «No se encontraron dispositivos compatibles». Falta la cámara, porque ese Windows no tiene ninguna conectada: la página lo dijo con el aviso correcto. El modo sin internet no se probó allá porque apagar la red cortaría Parsec; Edge usa el mismo motor que Chrome, donde sí pasó. Al usar Parsec, el texto escrito con el teclado simulado llega como una fila de letras «a» y Ctrl del Mac se vuelve la tecla Windows. Lo que funcionó fue pegar desde el portapapeles con clic derecho › «Pegar e ir a».
2. **Prueba con el brazo real**, unos 15 minutos, la hace Hugo:
   1. Conectar el Uno, «Preparar la placa» y ver «Brazo conectado». Es lo único que no se pudo simular: el reinicio de la placa por la línea DTR del USB.
   2. «Mover un poco» en cada servo y confirmar que los pines de fábrica coinciden.
   3. Los seis gestos con el brazo moviéndose, la pausa con dos manos y sacar la mano del encuadre.
   4. Desenchufar el USB con la base girando. Debe detenerse en menos de medio segundo.
   5. Repetir el paso 1 en el Windows.
3. **Paridad de punta a punta con un video real: hecha el 27 de octubre.** Con un video de Hugo de 29,5 s, 294 cuadros a 10 por segundo, la página y el Python del taller dan la misma lectura en 293 cuadros, el 99,7 %. La única diferencia es un cuadro suelto en una transición, que el estabilizador descarta. La primera corrida dio 96,3 % y mostró un 3 leído como 4 durante 7 cuadros seguidos, casi un segundo: la página detectaba sobre la imagen sin voltear y el Python sobre la imagen en espejo. El modelo de la mano no responde igual a una imagen y a su reflejo, y el umbral del pulgar se midió en espejo, así que ahora la página detecta sobre el cuadro ya volteado. Los cuadros del video quedan en `pruebas/datos/video/`, fuera de git porque muestran la cara de Hugo. Para repetir, con el servidor de pruebas corriendo:
   ```
   pruebas/video_preparar.sh <video>
   <python con mediapipe 1.0.0> pruebas/video_python.py <ruta a tecnico/deteccion_dedos.py> modelo/hand_landmarker.task
   node pruebas/video.mjs
   ```
4. **Aprobación de textos por Hugo.** La guía `guia.html` y los mensajes de la página están redactados con su marco de redacción, pero él no los ha leído. Mostrárselos antes de darlos por terminados.

## Rediseño del 27 de octubre

Hugo aprobó un plan con estos cambios, todos hechos:

- Nombre «Al alcance de la mano», logos oficiales del departamento, paleta de sus piezas gráficas, tipografía Barlow y la Mechita.
- Actividad sin la tabla de gestos ni el nombre de la orden en pantalla. El diseño se oculta al aplicarlo y el profesor puede verlo unos segundos. Pantalla completa con solo el video y la detección. Nombre del equipo en el registro.
- Pestaña nueva Cómo funciona, para proyectar: recorrido de un gesto, lo mecánico, aplicaciones y la relación con la IA.
- Brazo: control manual sobre un dibujo del brazo, PL2303 en la lista de chips, aviso específico para Mega, Leonardo, Micro, Uno R4, Nano Every y Due originales, y el nombre del chip si la firma no es ATmega328P.
- Guía como pestaña, con diagrama de conexiones del Sensor Shield V5, placas compatibles, gestos con dorso o palma, minuto a minuto revisado, formulario opcional y solución de problemas aparte.
- Advertencias reescritas sin anécdotas: fenómeno, riesgo y arreglo.

Segunda vuelta del mismo día, con comentarios de Hugo:

- Diagramas de conexiones y del brazo rehechos. Se generan con `herramientas/diagramas.py`, que los inserta en `index.html` entre los comentarios `<!-- diagrama:... -->`. Para cambiarlos se edita el script, no el HTML.
- El diseño de fábrica queda a la vista; solo el de cada equipo se oculta.
- Bajo el video va la barra de cámara; el consejo de la Mechita pasó a la columna derecha.
- Modo teléfono: en un teléfono o tablet la página sirve para probar la detección y leer Cómo funciona y la guía. Se ocultan el brazo, el panel del profesor y la pantalla completa, y un aviso explica que el brazo se maneja desde un computador. Probado con emulación de iPhone en Chrome, no en un iPhone real.
- PAUSA en pantalla solo con dos manos de verdad.

Tercera vuelta, después de que Hugo vio los diagramas en negro y el consejo de la Mechita desarmado:

- Causa comprobada con `pruebas/actualizacion.mjs`: el service worker servía primero lo guardado y GitHub Pages deja reusar cada archivo 10 minutos, así que tras publicar quedaba HTML nuevo con CSS viejo. Sin estilos, un SVG pinta todo en negro.
- Arreglo en tres partes: `sw.js` pide primero a internet; `herramientas/versionar.py` pone un código de contenido en la dirección de cada CSS y JavaScript; la página pide revisar si hay service worker nuevo al cargar y cada 30 minutos.
- Error propio encontrado en el camino: el service worker nuevo esperaba la recarga de la página dentro de su activación, y la recarga esperaba a la activación. La página quedaba congelada. Corregido y documentado en `sw.js`.
- Defensas adicionales: los diagramas llevan sus colores dentro del SVG y el texto de la Mechita para teléfono viene oculto desde el HTML.
- Quien abrió la página antes de este arreglo tiene el service worker viejo: necesita una recarga forzada una sola vez, Cmd+Shift+R o Ctrl+Shift+R.

**Prueba con el brazo real: hecha el 27 de octubre por Hugo, en Mac y en Windows.** Todo funcionó salvo «Preparar la placa», que fallaba con «respondió algo inesperado». Causa encontrada con un registro byte a byte en su Chrome: las órdenes de sincronizar repetidas se acumulaban en el buffer del chip mientras optiboot parpadeaba el LED, y un byte suelto desarmaba la orden siguiente. El simulador guardaba dos bytes en vez de los tres del chip real y por eso no lo mostraba. Corregido en `js/programador.js` y en `pruebas/placa_simulada.js`; con el Uno real cargó y verificó tres veces seguidas, unos 3 segundos cada vez, y la placa saludó con el programa nuevo. Después Hugo encontró una segunda falla, intermitente: «La placa no respondió como un Arduino Uno o Nano». Medido en su Uno: lo que se manda 50 ms después del pulso de reinicio se pierde en el chip USB de la placa (0 de 6), y a 300 ms llega siempre (6 de 6). Las cargas que funcionaban eran reintentos que caían por suerte en el momento justo. `reiniciar()` ahora espera 300 ms; el simulador imita la pérdida medida. Con el Uno real: 8 de 8 cargas seguidas, unos 3 segundos cada una.

Falta probar la carga con un Nano clon de bootloader viejo, que solo se probó simulado.

**Nota anterior, del corte por límite de uso.** Publicado el commit 770196a con el arreglo de versiones; las 35 pruebas de Node y los 14 escenarios del navegador pasan, y la transición desde la versión anterior funciona en las pruebas locales, incluida la secuencia recarga forzada y luego navegación normal. En el Chrome real de Hugo, después de una recarga forzada la página se ve completa y consistente, pero el service worker nuevo quedó en estado «esperando» sin tomar el control. La hipótesis no verificada es otra pestaña de Hugo con la página abierta bajo el service worker viejo. Próximo paso: pedirle a Hugo que cierre todas las pestañas de la página, abrirla de nuevo y revisar el estado; si sigue esperando, agregar a sw.js un mensaje 'activar' que llame skipWaiting y que app.js lo envíe cuando vea registration.waiting.

**Mechita oficial desde el 27 de octubre.** Hugo entregó las ilustraciones del departamento, en Descargas › OneDrive_1_27-10-2026, y la presentación «IMEC presentación charlas admitidos». En la página van «Mechita y Séneca 5» en la portada de Cómo funciona, «Mechita saludando» en la pantalla de carga, «Mechita overol» en el consejo de la Actividad, y la cabeza recortada de esta última en el ícono y el pie.

**Estilo alineado con la presentación institucional:** Poppins en toda la página, azul rey `#0840CA` en bloques planos, fondo gris `#F4F4F4`, el amarillo `#FFFC00` de la Mechita y los números grandes en azul. Klavika, la tipografía institucional que también usa la presentación, no es libre y no se incluyó.

## Decisiones tomadas sin aprobación de Hugo

Están para que las revise. Ninguna cambia lo que se aprobó en el plan.

- Repositorio en `~/Git/brazo-gestos`, nombre `brazo-gestos`, público.
- avr8js en lugar de simavr, porque simavr no está en Homebrew. avr8js no trae la instrucción SPM ni el reset por DTR; los dos se emularon en `pruebas/placa_simulada.js`.
- Se reinstaló Rosetta en el Mac con `softwareupdate --install-rosetta`. El compilador de Arduino es para Intel y macOS 27 venía sin Rosetta, así que tampoco funcionaba `SUBIR AL ARDUINO.command`.
- Trato de usted en los textos de la página y la guía.
- Botón «Ver el diseño cargado» que lo muestra 6 segundos y lo vuelve a ocultar solo, y campo opcional con el nombre del equipo.
- Tipografía Poppins, la que usa la presentación institucional del departamento.
- Los extremos se nombran por lo que hacen, como `base_izq` o `altura_arriba`, y no como mínimo y máximo. Un servo montado al revés se arregla intercambiando los dos números.
- Las velocidades y pasos de los servos no se configuran desde la página. Quedaron fijos con los valores medidos el 9 de agosto.
- Desde la página, «#mover» puede llevar cualquier servo de 0 a 180, la garra incluida, con una advertencia fija sobre el 8 de agosto. Las teclas 7 y 8 siguen sin pasar del cierre.
- Mientras la pestaña Brazo está abierta, los gestos no mueven el brazo.
- El registro de diseños usados se guarda en el navegador y se descarga como `mapeos_usados.txt`.
- La página pregunta por la identidad de la placa con `#ver`, que no tiene ninguna letra de movimiento. Con `#info`, el programa de agosto habría leído la `i` como girar y la `o` como abrir la garra. Lo detectó una prueba.
- Mientras se sostiene un giro, el latido repite la letra del giro en vez del punto. Si la página se atrasa más de 400 ms, el watchdog detiene la base, y así retoma sola en cuanto la página responde. Lo detectó una prueba con la detección corriendo.

## Límites conocidos

- MediaPipe en el navegador necesita WebGL siempre, aun calculando con el procesador. Si el navegador tiene apagada la aceleración gráfica, la página lo dice y explica cómo activarla, pero la detección no corre.
- Solo placas con ATmega328P, es decir Uno y Nano.
- Safari y Firefox muestran la detección pero no pueden conectarse con el Arduino.
- Tras publicar un cambio, el profesor ve la versión nueva en la segunda carga, por cómo funciona `sw.js`. Si se cambia MediaPipe o el modelo, hay que cambiar el nombre `CAJA` en `sw.js`.
- Con WebGL por software la detección corre a unos 11 cuadros por segundo. En un portátil con tarjeta gráfica debería ir a la velocidad de la cámara, pero no se ha medido en uno real.

## Fuera de esta versión

La versión Python del taller sigue en `~/Desktop/Taller computer vision - IMEC` sin cambios. Su `venv/` está roto desde que la carpeta pasó de «vison» a «vision», porque guarda la ruta vieja. No se tocó.
