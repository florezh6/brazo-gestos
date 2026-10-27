// Tabla gesto -> comando.
//
// Esta tabla es LO UNICO que cambian los estudiantes en la actividad.
// La logica de deteccion no se toca nunca. Entre turnos se carga la
// tabla que diseno cada equipo escribiendo las seis letras de su
// formulario, en el orden de los gestos 0, 1, 2, 3, 4, 5, que es el
// mismo orden de las filas del formulario en papel.

export const GESTOS = [0, 1, 2, 3, 4, 5];

// El "cableado" fijo hacia el Arduino. No lo tocan los estudiantes.
export const COMANDO_A_LETRA = {
  'CERRAR GARRA': 'c',
  'ABRIR GARRA': 'o',
  'GIRAR IZQUIERDA': 'i',
  'GIRAR DERECHA': 'd',
  'SUBIR': 's',
  'BAJAR': 'b',
};

export const LETRA_A_COMANDO = Object.fromEntries(
  Object.entries(COMANDO_A_LETRA).map(([comando, letra]) => [letra, comando]));

// El mapeo de fabrica. Se vuelve a el con un boton si el diseno de un
// equipo deja el brazo imposible de manejar en pleno turno.
export const MAPEO_DE_FABRICA = {
  0: 'CERRAR GARRA',       // puno
  1: 'GIRAR IZQUIERDA',
  2: 'GIRAR DERECHA',
  3: 'SUBIR',
  4: 'BAJAR',
  5: 'ABRIR GARRA',        // mano abierta
};

export const LETRA_PAUSA = 'p';
export const LETRA_LATIDO = '.';

// Revisa las seis letras de un formulario. Devuelve { mapeo } si estan
// bien, o { aviso } con el problema. Es la misma validacion de la
// version Python: cada comando una sola vez, y las seis completas.
export function validarLetras(letras) {
  const limpias = letras.map((l) => (l || '').trim().toLowerCase());
  for (let k = 0; k < limpias.length; k++) {
    const l = limpias[k];
    if (l === '') continue;
    if (!(l in LETRA_A_COMANDO)) {
      return { aviso: `«${l}» no es un comando. Las letras son c, o, i, d, s, b.`, fila: k };
    }
    const antes = limpias.indexOf(l);
    if (antes !== k) {
      return {
        aviso: `La letra «${l}», ${nombreCorto(LETRA_A_COMANDO[l])}, está repetida en los gestos ${antes} y ${k}.`,
        fila: k,
      };
    }
  }
  const llenas = limpias.filter((l) => l !== '').length;
  if (llenas < GESTOS.length) {
    return { aviso: `Faltan letras: van ${llenas} de 6.`, fila: limpias.indexOf('') };
  }
  const mapeo = {};
  GESTOS.forEach((g, k) => { mapeo[g] = LETRA_A_COMANDO[limpias[k]]; });
  return { mapeo };
}

export function letrasDe(mapeo) {
  return GESTOS.map((g) => COMANDO_A_LETRA[mapeo[g]]);
}

export function nombreCorto(comando) {
  return {
    'CERRAR GARRA': 'cerrar garra',
    'ABRIR GARRA': 'abrir garra',
    'GIRAR IZQUIERDA': 'girar a la izquierda',
    'GIRAR DERECHA': 'girar a la derecha',
    'SUBIR': 'subir',
    'BAJAR': 'bajar',
  }[comando];
}

// ---------------------------------------------------------------------
//  REGISTRO DE MAPEOS
//
//  Sirve para el cierre de la sesion: comparar los disenos que
//  funcionaron con los que no. La version Python lo escribia en
//  mapeos_usados.txt; una pagina no puede escribir en el disco, asi que
//  se guarda en el navegador y se descarga como texto con un boton.
// ---------------------------------------------------------------------
const CLAVE_REGISTRO = 'imec-mapeos-usados';

export function leerRegistro(almacen = globalThis.localStorage) {
  try {
    return JSON.parse(almacen.getItem(CLAVE_REGISTRO) || '[]');
  } catch (e) {
    return [];
  }
}

export function registrarMapeo(mapeo, almacen = globalThis.localStorage, fecha = new Date()) {
  // Que no se pueda escribir el registro NO puede tumbar el taller.
  try {
    const registro = leerRegistro(almacen);
    registro.push({ fecha: fecha.toISOString(), mapeo });
    almacen.setItem(CLAVE_REGISTRO, JSON.stringify(registro));
  } catch (e) { /* navegador en modo privado, por ejemplo */ }
}

export function borrarRegistro(almacen = globalThis.localStorage) {
  try { almacen.removeItem(CLAVE_REGISTRO); } catch (e) { /* nada */ }
}

// El mismo formato del mapeos_usados.txt de la version Python.
export function registroComoTexto(registro) {
  return registro.map(({ fecha, mapeo }) => {
    const d = new Date(fecha);
    const dos = (n) => String(n).padStart(2, '0');
    const cuando = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ` +
      `${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
    const filas = GESTOS.map((g) => `   ${g} -> ${mapeo[g]}`).join('\n');
    return `${cuando}\n${filas}\n`;
  }).join('\n');
}
