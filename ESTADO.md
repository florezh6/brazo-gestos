# Estado del desarrollo

Última actualización: 27 de octubre de 2026. Sesión cerrada por Hugo antes de las pruebas en Windows.

Plan aprobado: `~/.claude/plans/s-vamos-con-la-rippling-lampson.md`.

## Hecho y verificado

La página está publicada en https://florezh6.github.io/brazo-gestos/ desde el commit `538d1a0`. Incluye la actividad, la pestaña Brazo, la guía y el formulario.

| Parte | Cómo se verificó | Resultado |
|---|---|---|
| Programa de la placa `brazo_web.ino` | 14 pruebas con el `.hex` real en avr8js | Todas pasan |
| Programador desde el navegador | Contra optiboot real del Uno y el bootloader viejo del Nano, en avr8js | Escribe, verifica y el programa arranca en los dos |
| Conexión `brazo.js` | 7 pruebas contra la placa simulada | Todas pasan, tres vueltas seguidas |
| Regla de conteo | Comparada con `contar_dedos` del Python original en 12 000 manos sintéticas | Idéntica. Con margen 0,10 difieren 230, así que la prueba sí detecta cambios |
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

1. **Prueba en Windows por Parsec.** Hugo ya dio acceso a Parsec en la sesión del 27 de octubre, pero no se alcanzó a abrir. En Edge, sobre la URL publicada, revisar que la página cargue, que la cámara del portátil funcione, que «Conectar brazo» abra la ventana de puertos y que recargue sin internet. El Mac también está unido al Windows por un cable USB-C.
2. **Prueba con el brazo real**, unos 15 minutos, la hace Hugo:
   1. Conectar el Uno, «Preparar la placa» y ver «Brazo conectado». Es lo único que no se pudo simular: el reinicio de la placa por la línea DTR del USB.
   2. «Mover un poco» en cada servo y confirmar que los pines de fábrica coinciden.
   3. Los seis gestos con el brazo moviéndose, la pausa con dos manos y sacar la mano del encuadre.
   4. Desenchufar el USB con la base girando. Debe detenerse en menos de medio segundo.
   5. Repetir el paso 1 en el Windows.
3. **Paridad de punta a punta con un video real.** Falta un video de unos 30 s de una mano haciendo 0 a 5 con el dorso hacia la cámara. No se encontró uno libre en bancos de video, así que hay que pedírselo a Hugo. Con él, comparar cuadro a cuadro MediaPipe de Python contra la página. Criterio acordado: al menos 95 % de cuadros con el mismo conteo.
4. **Aprobación de textos por Hugo.** La guía `guia.html` y los mensajes de la página están redactados con su marco de redacción, pero él no los ha leído. Mostrárselos antes de darlos por terminados.

## Decisiones tomadas sin aprobación de Hugo

Están para que las revise. Ninguna cambia lo que se aprobó en el plan.

- Repositorio en `~/Git/brazo-gestos`, nombre `brazo-gestos`, público.
- avr8js en lugar de simavr, porque simavr no está en Homebrew. avr8js no trae la instrucción SPM ni el reset por DTR; los dos se emularon en `pruebas/placa_simulada.js`.
- Se reinstaló Rosetta en el Mac con `softwareupdate --install-rosetta`. El compilador de Arduino es para Intel y macOS 27 venía sin Rosetta, así que tampoco funcionaba `SUBIR AL ARDUINO.command`.
- Trato de usted en los textos de la página y la guía.
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
