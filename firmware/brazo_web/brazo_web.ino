/*
  Brazo robotico teleoperado por gestos - Taller IMEC, VERSION WEB

  Placa: Arduino Uno o Nano (los dos usan el ATmega328P)
  Brazo: EEZYbotARM (thingiverse 1015238)

  Este programa lo carga la propia pagina web con el boton "Preparar la
  placa". Parte de tecnico/brazo_arduino/brazo_arduino.ino (el del
  taller del 13 de agosto) y se mueve EXACTAMENTE igual. Lo unico nuevo
  es que los pines y los limites ya no estan escritos en el codigo:
  viven en la EEPROM de la placa y se cambian desde la pagina, sin
  recompilar. Asi un ensamble distinto no obliga a instalar nada.

  IMPORTANTE - ALIMENTACION:
  Los servos NO se alimentan del Arduino. Van a una fuente externa de
  5-6V y al menos 3-5A. El GND de esa fuente DEBE ir unido al GND del
  Arduino, o nada funciona. Si se alimentan del Arduino, la placa se
  reinicia sola apenas se mueven.

  ORDENES DE MOVIMIENTO (una letra, igual que la version Python):
      i = girar izquierda      d = girar derecha
      s = brazo ARRIBA         b = brazo ABAJO   (dos estados, no continuo)
      o = abrir garra          c = cerrar garra
      p = PAUSA, detiene todo movimiento (la garra se queda como este)
      . = latido, "sigo vivo", no cambia nada

  La base gira SOLO mientras se sostiene el gesto de girar. Cualquier
  otra orden (s, b, o, c, p) la detiene.

  ORDENES DE CONFIGURACION (una linea que empieza con #, y Enter):
      #info  o  #ver        responde "IMEC-BRAZO v1"
                            (#ver es la que usa la pagina: no tiene
                            ninguna letra de movimiento, asi que un
                            programa que no entienda el # la ignora)
      #config               imprime todos los valores, uno por linea
      #set clave valor      cambia un valor (ver CLAVES mas abajo)
      #mover servo angulo   lleva un servo a un angulo, para calibrar
                            (servo = base, altura, alcance o garra)
      #guardar              guarda la configuracion en la placa
      #fabrica              vuelve a los valores de fabrica y los guarda

  Responde siempre una linea que empieza con "ok" o con "error". Las
  lineas que empiezan con # nunca se confunden con las letras de
  movimiento: mientras llega una linea, sus letras no mueven nada.

  MODO CALIBRACION (igual que antes, desde cualquier monitor serie):
      1 / 2 = mueve la base    -/+ un poquito
      3 / 4 = mueve la altura  -/+
      5 / 6 = mueve el alcance -/+
      7 / 8 = mueve la garra   -/+
      ?     = imprime los angulos actuales

  Velocidad del puerto: 115200.
*/

#include <Servo.h>
#include <EEPROM.h>

// ---------------------------------------------------------------
//  CONFIGURACION: PINES Y LIMITES
//
//  Los valores de fabrica son los MEDIDOS en el brazo del Uno el 9 de
//  agosto (ver tecnico/02-montaje-y-calibracion.md en la carpeta del
//  taller). Un brazo distinto se ajusta desde la pagina, en la
//  pestana "Brazo", y queda guardado en la placa.
//
//  Los extremos se nombran por lo que HACEN y no por si son el numero
//  mayor o el menor: "base_izq" es el angulo al que llega girando a la
//  izquierda, "altura_arriba" el del brazo arriba. Asi, si en otro
//  ensamble un servo queda montado al reves, basta con intercambiar
//  los dos numeros. En el brazo original izquierda es el angulo mayor
//  (145) y arriba tambien (80).
// ---------------------------------------------------------------
struct Configuracion {
  uint16_t magico;     // marca de que la EEPROM tiene algo nuestro
  uint8_t  version;
  uint8_t  pinBase, pinAltura, pinAlcance, pinGarra;
  uint8_t  baseIzq, baseDer, baseReposo;
  uint8_t  alturaArriba, alturaAbajo, alturaReposo;
  // El alcance queda FIJO: el reto se diseno con los puntos A y B a la
  // misma distancia de la base, asi que este servo no se mueve durante
  // la actividad. Se ajusta una sola vez en el montaje.
  uint8_t  alcance;
  // Garra tipo canasta: en el brazo original 90 es el CIERRE COMPLETO,
  // un extremo del recorrido y no el centro. Durante la actividad la
  // garra nunca sale del tramo entre cerrada y abierta.
  uint8_t  garraCerrada, garraAbierta;
  uint8_t  suma;       // suma de verificacion de todo lo anterior
};

const uint16_t MAGICO = 0x494D;   // "IM", de IMEC
const uint8_t  VERSION_CONFIG = 1;

const Configuracion DE_FABRICA = {
  MAGICO, VERSION_CONFIG,
  9, 10, 11, 3,      // pines: base, altura, alcance, garra
  145, 25, 90,       // base: izquierda, derecha, reposo
  80, 45, 62,        // altura: arriba, abajo, reposo
  125,               // alcance fijo
  90, 130,           // garra: cerrada, abierta
  0
};

Configuracion cfg;

// ---------------------------------------------------------------
//  VELOCIDAD: EL TAMANO DEL PASO IMPORTA MAS QUE LA RAPIDEZ
//
//  Estos numeros NO se configuran desde la pagina: se midieron con el
//  brazo armado el 9 de agosto y cada uno resolvio un problema real
//  (ver el programa original para la historia completa).
//
//  Un servo aplica fuerza en proporcion a que tan lejos esta de donde
//  se le mando. Con pasos chicos el error es minimo, la fuerza tambien,
//  y no vence la friccion de arranque. Regla: si le falta fuerza, subir
//  los grados por paso; si va lento, bajar los milisegundos.
//      grados por segundo = GRADOS_POR_PASO * 1000 / MS_POR_PASO
// ---------------------------------------------------------------
const unsigned long MS_POR_PASO = 100;
const int GRADOS_POR_PASO = 3;               // base: 30 grados/s

// Cerrar la garra va con paso propio: con 3 grados se trababa.
const int GARRA_CIERRE_GRADOS_POR_PASO = 8;

// Subir va de un solo golpe (fuerza maxima, el brazo sube vacio).
// Bajar va de a poco porque lleva el objeto y un desplome lo tumba.
// No bajar de 7: con pasos chicos se queda pegado a mitad de camino.
const int ALTURA_BAJADA_GRADOS_POR_PASO = 7;

// ---------------------------------------------------------------
//  SEGURIDAD: watchdog
//
//  La pagina manda un latido cada 100 ms; si pasan mas de 400 ms sin
//  recibir NADA, el brazo se detiene solo. Cubre que la mano salga del
//  encuadre, que se cierre la pestana o que alguien tropiece con el
//  cable USB. La garra NO se abre al detenerse: si esta sosteniendo
//  el objeto, lo sigue sosteniendo.
// ---------------------------------------------------------------
const unsigned long TIEMPO_SIN_ORDENES = 400;

// ---------------------------------------------------------------
//  ESTADO
// ---------------------------------------------------------------
Servo servoBase, servoAltura, servoAlcance, servoGarra;

int anguloBase, anguloAltura, anguloAlcance, anguloGarra;

// La base es lo unico que se mueve de forma continua: -1, 0 o +1.
// +1 es "hacia base_izq", -1 "hacia base_der".
int dirBase = 0;

// Altura y garra van por objetivo, no por direccion.
int objetivoAltura;
int objetivoGarra;

unsigned long ultimaOrden = 0;
unsigned long ultimoPaso  = 0;
bool detenidoPorWatchdog = false;

// Linea de configuracion a medio llegar. Mientras se este llenando,
// las letras que llegan son parte de la linea y NO mueven el brazo.
const int LARGO_LINEA = 40;
char linea[LARGO_LINEA + 1];
int largoLinea = 0;
bool leyendoLinea = false;

// ---------------------------------------------------------------
//  Declaracion de las funciones.
//
//  El IDE de Arduino normalmente las genera solo, pero se le atraviesa
//  con funciones que reciben referencias, y el error que suelta en ese
//  caso es de los que no se entienden. Declararlas aqui lo evita.
// ---------------------------------------------------------------
void leerOrdenes();
void ordenDeMovimiento(char orden);
void ordenDeConfiguracion(char *texto);
void revisarWatchdog();
void moverServos();
void calibrar(int &angulo, int delta, int minimo, int maximo);
void imprimirAngulos();
void imprimirConfiguracion();
uint8_t calcularSuma(const Configuracion &c);
bool cargarConfiguracion();
void guardarConfiguracion();
void conectarServos();
void ponerEnReposo();
bool pinValido(int pin);
int acercar(int actual, int objetivo, int paso);
int entre(int valor, int extremoA, int extremoB);

// ---------------------------------------------------------------
void setup() {
  Serial.begin(115200);

  bool habiaGuardada = cargarConfiguracion();
  ponerEnReposo();
  conectarServos();

  ultimaOrden = millis();
  ultimoPaso  = millis();

  Serial.println(F("Brazo listo."));
  Serial.println(F("IMEC-BRAZO v1"));
  if (habiaGuardada) {
    Serial.println(F("Configuracion: la guardada en la placa."));
  } else {
    Serial.println(F("Configuracion: de fabrica."));
  }
}

// ---------------------------------------------------------------
void loop() {
  leerOrdenes();
  revisarWatchdog();
  moverServos();
}

// ---------------------------------------------------------------
//  CONFIGURACION EN LA EEPROM
// ---------------------------------------------------------------
uint8_t calcularSuma(const Configuracion &c) {
  const uint8_t *bytes = (const uint8_t *)&c;
  uint8_t suma = 0;
  for (unsigned int k = 0; k < sizeof(Configuracion) - 1; k++) {
    suma = suma * 31 + bytes[k];
  }
  return suma;
}

// Devuelve true si habia una configuracion valida guardada. Si no la
// hay (placa nueva, o EEPROM con datos de otro programa), se queda con
// la de fabrica: nunca arranca con pines o limites de basura.
bool cargarConfiguracion() {
  Configuracion leida;
  EEPROM.get(0, leida);
  if (leida.magico == MAGICO && leida.version == VERSION_CONFIG
      && leida.suma == calcularSuma(leida)) {
    cfg = leida;
    return true;
  }
  cfg = DE_FABRICA;
  return false;
}

void guardarConfiguracion() {
  cfg.magico = MAGICO;
  cfg.version = VERSION_CONFIG;
  cfg.suma = calcularSuma(cfg);
  // put() solo reescribe los bytes que cambiaron: no gasta la EEPROM.
  EEPROM.put(0, cfg);
}

// Los pines 0 y 1 son los del cable USB: usarlos para un servo corta la
// comunicacion con la pagina. Del 2 al 13 y de A0 (14) a A5 (19) sirven.
bool pinValido(int pin) {
  return pin >= 2 && pin <= 19;
}

void conectarServos() {
  servoBase.attach(cfg.pinBase);
  servoAltura.attach(cfg.pinAltura);
  servoAlcance.attach(cfg.pinAlcance);
  servoGarra.attach(cfg.pinGarra);
  servoBase.write(anguloBase);
  servoAltura.write(anguloAltura);
  servoAlcance.write(anguloAlcance);
  servoGarra.write(anguloGarra);
}

void ponerEnReposo() {
  // El reposo se recorta a su propio rango, por si quedo afuera al
  // cambiar los extremos: el 9 de agosto un reposo fuera de rango casi
  // manda la altura contra el tope en el arranque.
  anguloBase    = entre(cfg.baseReposo, cfg.baseIzq, cfg.baseDer);
  anguloAltura  = entre(cfg.alturaReposo, cfg.alturaArriba, cfg.alturaAbajo);
  anguloAlcance = cfg.alcance;
  // Arranca ABIERTA a proposito: es el extremo del recorrido que NO
  // aprieta nada, asi que si la placa se reinicia sola en pleno taller
  // el servo no queda forzando.
  anguloGarra   = cfg.garraAbierta;
  objetivoAltura = anguloAltura;
  objetivoGarra  = anguloGarra;
  dirBase = 0;
}

// ---------------------------------------------------------------
void leerOrdenes() {
  while (Serial.available() > 0) {
    char c = Serial.read();

    // Cualquier byte, incluso un salto de linea, prueba que el otro
    // lado sigue vivo.
    ultimaOrden = millis();
    if (detenidoPorWatchdog) {
      detenidoPorWatchdog = false;
      Serial.println(F("Conexion restablecida."));
    }

    if (leyendoLinea) {
      if (c == '\n' || c == '\r') {
        linea[largoLinea] = '\0';
        leyendoLinea = false;
        ordenDeConfiguracion(linea);
      } else if (largoLinea < LARGO_LINEA) {
        linea[largoLinea++] = c;
      } else {
        // Linea demasiado larga: se descarta entera.
        leyendoLinea = false;
        Serial.println(F("error linea demasiado larga"));
      }
      continue;
    }

    if (c == '#') {
      leyendoLinea = true;
      largoLinea = 0;
      continue;
    }

    // Ignora saltos de linea y espacios: asi funciona igual desde un
    // monitor serie (que manda Enter) que desde la pagina.
    if (c == '\n' || c == '\r' || c == ' ') continue;

    ordenDeMovimiento(c);
  }
}

void ordenDeMovimiento(char orden) {
  // CAMBIAR DE GESTO DETIENE EL GIRO  (10-ago)
  //
  // 'i' y 'd' no mandan al brazo a una posicion sino que le prenden
  // una direccion, y esa direccion se queda prendida hasta que alguien
  // la apague. Por eso cualquier orden de movimiento que no sea girar
  // la apaga primero: LA BASE GIRA SOLO MIENTRAS SE SOSTIENE EL GESTO
  // DE GIRAR. Cualquier otro gesto la detiene.
  switch (orden) {
    case 'i': dirBase = +1; break;
    case 'd': dirBase = -1; break;
    // Arriba y abajo van al extremo, sin posiciones intermedias.
    case 's': dirBase = 0; objetivoAltura = cfg.alturaArriba; break;
    case 'b': dirBase = 0; objetivoAltura = cfg.alturaAbajo;  break;

    case 'o': dirBase = 0; objetivoGarra = cfg.garraAbierta; break;
    case 'c': dirBase = 0; objetivoGarra = cfg.garraCerrada; break;

    // Pausa: detiene la base, que es lo unico que se mueve solo. La
    // altura y la garra se quedan donde esten.
    case 'p': dirBase = 0; break;

    case '.': break;   // latido

    // ---- calibracion por teclas, como en el programa original ----
    case '1': calibrar(anguloBase, -5, 0, 180); break;
    case '2': calibrar(anguloBase, +5, 0, 180); break;
    case '3': calibrar(anguloAltura, -5, 0, 180); break;
    case '4': calibrar(anguloAltura, +5, 0, 180); break;
    case '5': calibrar(anguloAlcance, -5, 0, 180); break;
    case '6': calibrar(anguloAlcance, +5, 0, 180); break;
    // La garra SI lleva tope en las teclas: nunca pasa de "cerrada"
    // hacia el lado del cierre. Por ese lado lo unico que hay es el
    // servo empujando la canasta cerrada contra su tope (8 de agosto).
    // Para buscar un cierre nuevo en otro ensamble esta #mover.
    case '7':
    case '8': {
      int delta = (orden == '8') ? +5 : -5;
      if (cfg.garraAbierta >= cfg.garraCerrada) {
        calibrar(anguloGarra, delta, cfg.garraCerrada, 180);
      } else {
        calibrar(anguloGarra, delta, 0, cfg.garraCerrada);
      }
      break;
    }

    case '?': imprimirAngulos(); break;

    default: break;   // cualquier otra cosa se ignora
  }
}

// ---------------------------------------------------------------
//  ORDENES DE CONFIGURACION
// ---------------------------------------------------------------

// Una clave de #set y el byte de la configuracion que le corresponde.
struct Clave {
  const char *nombre;
  uint8_t Configuracion::*campo;
  bool esPin;
};

const Clave CLAVES[] = {
  {"pin_base",      &Configuracion::pinBase,      true},
  {"pin_altura",    &Configuracion::pinAltura,    true},
  {"pin_alcance",   &Configuracion::pinAlcance,   true},
  {"pin_garra",     &Configuracion::pinGarra,     true},
  {"base_izq",      &Configuracion::baseIzq,      false},
  {"base_der",      &Configuracion::baseDer,      false},
  {"base_reposo",   &Configuracion::baseReposo,   false},
  {"altura_arriba", &Configuracion::alturaArriba, false},
  {"altura_abajo",  &Configuracion::alturaAbajo,  false},
  {"altura_reposo", &Configuracion::alturaReposo, false},
  {"alcance",       &Configuracion::alcance,      false},
  {"garra_cerrada", &Configuracion::garraCerrada, false},
  {"garra_abierta", &Configuracion::garraAbierta, false},
};
const int NUM_CLAVES = sizeof(CLAVES) / sizeof(CLAVES[0]);

void ordenDeConfiguracion(char *texto) {
  // Toda orden de configuracion deja el brazo quieto primero.
  dirBase = 0;

  char *orden = strtok(texto, " ");
  char *arg1  = strtok(NULL, " ");
  char *arg2  = strtok(NULL, " ");

  if (orden == NULL) {
    Serial.println(F("error linea vacia"));
    return;
  }

  if (strcmp(orden, "info") == 0 || strcmp(orden, "ver") == 0) {
    Serial.println(F("IMEC-BRAZO v1"));
    return;
  }

  if (strcmp(orden, "config") == 0) {
    imprimirConfiguracion();
    return;
  }

  if (strcmp(orden, "guardar") == 0) {
    guardarConfiguracion();
    Serial.println(F("ok guardado"));
    return;
  }

  if (strcmp(orden, "fabrica") == 0) {
    servoBase.detach(); servoAltura.detach();
    servoAlcance.detach(); servoGarra.detach();
    cfg = DE_FABRICA;
    guardarConfiguracion();
    ponerEnReposo();
    conectarServos();
    Serial.println(F("ok fabrica"));
    return;
  }

  if (strcmp(orden, "mover") == 0) {
    if (arg1 == NULL || arg2 == NULL) {
      Serial.println(F("error uso: #mover servo angulo"));
      return;
    }
    int angulo = atoi(arg2);
    if (angulo < 0 || angulo > 180) {
      Serial.println(F("error el angulo va de 0 a 180"));
      return;
    }
    // Se mueve de una vez y se fija como objetivo, para que la logica
    // de altura y garra no lo devuelva a donde estaba.
    if (strcmp(arg1, "base") == 0)         anguloBase = angulo;
    else if (strcmp(arg1, "altura") == 0)  { anguloAltura = angulo; objetivoAltura = angulo; }
    else if (strcmp(arg1, "alcance") == 0) anguloAlcance = angulo;
    else if (strcmp(arg1, "garra") == 0)   { anguloGarra = angulo; objetivoGarra = angulo; }
    else {
      Serial.println(F("error servo desconocido"));
      return;
    }
    servoBase.write(anguloBase);
    servoAltura.write(anguloAltura);
    servoAlcance.write(anguloAlcance);
    servoGarra.write(anguloGarra);
    Serial.print(F("ok "));
    imprimirAngulos();
    return;
  }

  if (strcmp(orden, "set") == 0) {
    if (arg1 == NULL || arg2 == NULL) {
      Serial.println(F("error uso: #set clave valor"));
      return;
    }
    const Clave *clave = NULL;
    for (int k = 0; k < NUM_CLAVES; k++) {
      if (strcmp(arg1, CLAVES[k].nombre) == 0) clave = &CLAVES[k];
    }
    if (clave == NULL) {
      Serial.println(F("error clave desconocida"));
      return;
    }
    int valor = atoi(arg2);

    if (clave->esPin) {
      if (!pinValido(valor)) {
        Serial.println(F("error pin no valido: use 2 a 13 o A0 a A5 (14 a 19)"));
        return;
      }
      // Dos servos en el mismo pin se pelean: se rechaza.
      for (int k = 0; k < NUM_CLAVES; k++) {
        if (CLAVES[k].esPin && &CLAVES[k] != clave
            && cfg.*(CLAVES[k].campo) == valor) {
          Serial.print(F("error el pin ya lo usa "));
          Serial.println(CLAVES[k].nombre);
          return;
        }
      }
      // Soltar el pin viejo y tomar el nuevo, sin reiniciar la placa.
      servoBase.detach(); servoAltura.detach();
      servoAlcance.detach(); servoGarra.detach();
      cfg.*(clave->campo) = valor;
      conectarServos();
    } else {
      if (valor < 0 || valor > 180) {
        Serial.println(F("error el angulo va de 0 a 180"));
        return;
      }
      cfg.*(clave->campo) = valor;
      // El alcance es fijo: se aplica de inmediato.
      if (clave->campo == &Configuracion::alcance) {
        anguloAlcance = valor;
        servoAlcance.write(anguloAlcance);
      }
    }
    Serial.print(F("ok "));
    Serial.print(clave->nombre);
    Serial.print('=');
    Serial.println(valor);
    return;
  }

  Serial.println(F("error orden desconocida"));
}

void imprimirConfiguracion() {
  for (int k = 0; k < NUM_CLAVES; k++) {
    Serial.print(F("cfg "));
    Serial.print(CLAVES[k].nombre);
    Serial.print('=');
    Serial.println(cfg.*(CLAVES[k].campo));
  }
  Serial.println(F("cfg fin"));
}

// En calibracion se ignoran los limites de la configuracion
// (justamente los estamos buscando), pero nunca se sale de 0-180.
void calibrar(int &angulo, int delta, int minimo, int maximo) {
  angulo = constrain(angulo + delta, minimo, maximo);
  dirBase = 0;
  // Que altura y garra no peleen contra el ajuste manual.
  objetivoAltura = anguloAltura;
  objetivoGarra  = anguloGarra;
  servoBase.write(anguloBase);
  servoAltura.write(anguloAltura);
  servoAlcance.write(anguloAlcance);
  servoGarra.write(anguloGarra);
  imprimirAngulos();
}

void imprimirAngulos() {
  Serial.print(F("base="));    Serial.print(anguloBase);
  Serial.print(F("  altura=")); Serial.print(anguloAltura);
  Serial.print(F("  alcance="));Serial.print(anguloAlcance);
  Serial.print(F("  garra="));  Serial.println(anguloGarra);
}

// ---------------------------------------------------------------
void revisarWatchdog() {
  if (millis() - ultimaOrden > TIEMPO_SIN_ORDENES) {
    if (!detenidoPorWatchdog) {
      detenidoPorWatchdog = true;
      Serial.println(F("Sin senal: brazo detenido por seguridad."));
    }
    dirBase = 0;
    // La garra y la altura se quedan donde esten. Si la senal se
    // pierde en mitad de una BAJADA, el brazo termina de bajar (medio
    // segundo) en vez de quedarse colgado con el objeto en el aire.
  }
}

// ---------------------------------------------------------------
//  Utilidades para los extremos con nombre.
// ---------------------------------------------------------------

// Recorta un valor al tramo entre dos extremos, sin importar cual de
// los dos es el mayor.
int entre(int valor, int extremoA, int extremoB) {
  return constrain(valor, min(extremoA, extremoB), max(extremoA, extremoB));
}

// Da un paso de tamano "paso" desde actual hacia objetivo, sin pasarse.
int acercar(int actual, int objetivo, int paso) {
  if (actual < objetivo) return min(actual + paso, objetivo);
  if (actual > objetivo) return max(actual - paso, objetivo);
  return actual;
}

// ---------------------------------------------------------------
void moverServos() {
  unsigned long ahora = millis();

  // ALTURA AL SUBIR: de un solo golpe al extremo pedido. Ir directo es
  // justamente lo que le da la fuerza. Va antes del reloj de pasos,
  // para que salga en el acto.
  if (objetivoAltura == cfg.alturaArriba && anguloAltura != objetivoAltura) {
    anguloAltura = objetivoAltura;
    servoAltura.write(anguloAltura);
  }

  if (ahora - ultimoPaso < MS_POR_PASO) return;
  ultimoPaso = ahora;

  // ALTURA AL BAJAR: de a poco, porque aqui lleva el objeto.
  if (anguloAltura != objetivoAltura) {
    anguloAltura = acercar(anguloAltura, objetivoAltura,
                           ALTURA_BAJADA_GRADOS_POR_PASO);
    servoAltura.write(anguloAltura);
  }

  if (dirBase != 0) {
    int destino = (dirBase > 0) ? cfg.baseIzq : cfg.baseDer;
    anguloBase = acercar(entre(anguloBase, cfg.baseIzq, cfg.baseDer),
                         destino, GRADOS_POR_PASO);
  }

  // GARRA, asimetrica a proposito:
  //   ABRIR va de un golpe: el golpe da fuerza maxima y destraba los
  //   engranajes cuando se pegan.
  //   CERRAR va de a poco, con su propio paso de 8 grados: un cierre
  //   de golpe tumba el objeto, y con 3 grados se trababa.
  if (objetivoGarra == cfg.garraAbierta) {
    anguloGarra = objetivoGarra;
  } else if (anguloGarra != objetivoGarra) {
    anguloGarra = acercar(anguloGarra, objetivoGarra,
                          GARRA_CIERRE_GRADOS_POR_PASO);
  }

  // La altura no se escribe aqui: ya se escribio arriba.
  servoBase.write(anguloBase);
  servoAlcance.write(anguloAlcance);
  servoGarra.write(anguloGarra);
}
