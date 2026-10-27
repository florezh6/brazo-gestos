// Deteccion de gestos por conteo de dedos.
//
// Traduccion linea por linea de contar_dedos y Estabilizador de
// tecnico/deteccion_dedos.py (taller del 13 de agosto). Los numeros son
// los mismos y NO se cambian aqui sin volver a medir: el 98.8 % de
// acierto se midio con esta regla y estos valores.

// Cuantos cuadros de video seguidos debe repetirse un gesto antes de
// darlo por bueno. Subelo si ves parpadeo; bajalo si se siente lento.
export const CUADROS_PARA_CONFIRMAR = 5;

// Que tan exigente es la regla del pulgar, medido como fraccion del
// tamano de la mano.
//   - SUBELO  si cuenta dedos de mas en el 2 o el 3.
//   - BAJALO  si en la mano abierta no le cuenta el pulgar (marca 4).
//
// Valor fijado el 2026-08-06 con datos reales (calibrar_pulgar.py,
// ~1600 muestras): los gestos 1, 2, 3 y 4 dejan el pulgar por debajo
// de +0.064 casi siempre, y la mano abierta lo pone en +0.170. El
// umbral va en medio de esos dos grupos.
export const MARGEN_PULGAR = 0.11;

// PAUSA: mostrar LAS DOS MANOS detiene todo, sin importar que gesto
// hagan. Es una regla de seguridad fija, no la configuran los equipos.
export const PAUSA = 'PAUSA';

// Numeros de los puntos que MediaPipe pone en la mano (son 21 en total).
const MUNECA = 0;
const PUNTAS = { indice: 8, medio: 12, anular: 16, menique: 20 };
const NUDILLOS = { indice: 6, medio: 10, anular: 14, menique: 18 };
const PULGAR_PUNTA = 4;
const PULGAR_NUDILLO = 3;
const BASE_MENIQUE = 17;
const NUDILLO_MEDIO = 9;      // se usa para medir el tamano de la mano

// Las uniones entre los 21 puntos, para dibujar el esqueleto de la mano.
export const UNIONES_MANO = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

function distancia(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// Cuenta cuantos dedos estan estirados (devuelve un numero de 0 a 5).
//
// Regla para los 4 dedos largos: si la punta del dedo esta MAS LEJOS
// de la muneca que su propio nudillo, el dedo esta estirado. Cuando se
// dobla, la punta se recoge hacia la palma y queda mas cerca. Funciona
// aunque la mano este inclinada o de lado.
//
// Solo usa distancias, asi que da lo mismo si la imagen esta en espejo.
export function contarDedos(puntos) {
  const muneca = puntos[MUNECA];
  let dedos = 0;

  for (const dedo of Object.keys(PUNTAS)) {
    const punta = puntos[PUNTAS[dedo]];
    const nudillo = puntos[NUDILLOS[dedo]];
    if (distancia(muneca, punta) > distancia(muneca, nudillo)) {
      dedos += 1;
    }
  }

  // El pulgar necesita su propia regla porque se mueve hacia el lado,
  // no hacia arriba: al doblarse cruza la palma y se acerca a la base
  // del menique. Ademas se le exige un margen, medido como fraccion del
  // tamano de la mano, para que el "2" con indice y medio no se lea
  // como 3 cuando el pulgar no queda del todo recogido.
  const baseMenique = puntos[BASE_MENIQUE];
  const tamanoMano = distancia(puntos[MUNECA], puntos[NUDILLO_MEDIO]);
  const pulgarEstirado =
    distancia(puntos[PULGAR_PUNTA], baseMenique) >
    distancia(puntos[PULGAR_NUDILLO], baseMenique) + MARGEN_PULGAR * tamanoMano;
  if (pulgarEstirado) dedos += 1;

  return dedos;
}

// Convierte lo que ve MediaPipe en una lectura: PAUSA con dos manos,
// el conteo con una, null sin mano.
export function leerManos(manos) {
  if (manos.length >= 2) return PAUSA;
  if (manos.length === 1) return contarDedos(manos[0]);
  return null;
}

// Confirma un gesto solo cuando se repite varios cuadros seguidos.
// Sin esto el brazo temblaria: la deteccion cambia de valor por
// milesimas de segundo cada vez que la mano se mueve un poco.
export class Estabilizador {
  constructor(cuadrosRequeridos = CUADROS_PARA_CONFIRMAR) {
    this.cuadrosRequeridos = cuadrosRequeridos;
    this.candidato = null;
    this.repeticiones = 0;
    this.confirmado = null;
  }

  // Devuelve true solo en el instante en que se confirma un gesto nuevo.
  actualizar(valor) {
    if (valor === this.candidato) {
      this.repeticiones += 1;
    } else {
      this.candidato = valor;
      this.repeticiones = 1;
    }

    if (this.repeticiones >= this.cuadrosRequeridos && valor !== this.confirmado) {
      this.confirmado = valor;
      return true;
    }
    return false;
  }

  // Borra la memoria del gesto, dejando el sistema como en PAUSA. Se
  // usa al cambiar el mapeo: el operador puede estar sosteniendo el
  // mismo gesto de antes, pero ahora significa otra cosa, asi que hay
  // que volver a confirmarlo desde cero para que el comando nuevo si
  // se envie.
  reiniciar() {
    this.candidato = null;
    this.repeticiones = 0;
    this.confirmado = PAUSA;
  }
}
