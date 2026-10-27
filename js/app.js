// Arranque de la pagina: une camara, deteccion, mapeo y brazo.

import { crearDetector, abrirCamara, listarCamaras, cadaCuadro, mensajeErrorCamara, hayWebGL } from './camara.js';
import { leerManos, Estabilizador, PAUSA, UNIONES_MANO } from './deteccion.js';
import {
  GESTOS, MAPEO_DE_FABRICA, COMANDO_A_LETRA, LETRA_PAUSA, validarLetras, letrasDe,
  nombreCorto, registrarMapeo, leerRegistro, registroComoTexto,
} from './mapeo.js';
import { Brazo, ESTADOS } from './brazo.js';
import {
  SERVOS, POSICIONES, PINES, nombrePin, traducirError,
} from './protocolo.js';

const $ = (id) => document.getElementById(id);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------
//  ESTADO
// ---------------------------------------------------------------------
const estado = {
  // La pagina arranca SIEMPRE con el mapeo de fabrica, igual que la
  // version Python.
  mapeo: { ...MAPEO_DE_FABRICA },
  pestana: 'actividad',
  mapeoAbierto: false,
  lectura: null,
  ordenesPermitidas: false,
  sinGuardar: new Set(),
  cuadros: 0,          // cuadros procesados, para revisar que la deteccion corre
};

const brazo = new Brazo();
const estabilizador = new Estabilizador();

// ---------------------------------------------------------------------
//  AVISOS
// ---------------------------------------------------------------------
function aviso(id, texto, { grave = false, boton = null } = {}) {
  let caja = document.querySelector(`.aviso[data-id="${id}"]`);
  if (!caja) {
    caja = document.createElement('div');
    caja.className = 'aviso';
    caja.dataset.id = id;
    $('avisos').append(caja);
  }
  caja.classList.toggle('grave', grave);
  caja.replaceChildren();
  const p = document.createElement('p');
  p.textContent = texto;
  caja.append(p);
  if (boton) {
    const b = document.createElement('button');
    b.className = 'boton';
    b.textContent = boton.texto;
    b.addEventListener('click', boton.alHacerClic);
    caja.append(b);
  }
}

function quitarAviso(id) {
  const caja = document.querySelector(`.aviso[data-id="${id}"]`);
  if (caja) caja.remove();
}

// ---------------------------------------------------------------------
//  PESTANAS
// ---------------------------------------------------------------------
function irA(pestana) {
  // En el telefono no hay pestana Brazo.
  if (pestana === 'brazo' && document.body.classList.contains('modo-telefono')) pestana = 'actividad';
  estado.pestana = pestana;
  for (const b of document.querySelectorAll('button.pestana')) {
    if (b.dataset.pestana === pestana) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  for (const id of ['actividad', 'como', 'brazo', 'guia']) $(id).hidden = pestana !== id;
  if (location.hash.slice(1) !== pestana && !location.hash.startsWith('#g-')) {
    history.replaceState(null, '', '#' + pestana);
  }
  revisarPermiso();
}

// La pestana tambien se puede abrir desde la direccion, por ejemplo
// index.html#guia, y los enlaces del indice de la guia (#g-...) abren
// la guia si no estaba a la vista.
function pestanaDesdeDireccion() {
  const h = location.hash.slice(1);
  if (h.startsWith('g-')) {
    if (estado.pestana !== 'guia') irA('guia');
    const destino = document.getElementById(h);
    if (destino) destino.scrollIntoView();
  } else if (['actividad', 'como', 'brazo', 'guia'].includes(h)) {
    irA(h);
  }
}
window.addEventListener('hashchange', pestanaDesdeDireccion);

for (const b of document.querySelectorAll('button.pestana')) {
  b.addEventListener('click', () => irA(b.dataset.pestana));
}

// Los gestos solo mueven el brazo si se esta en la pestana Actividad,
// no se esta cargando un diseno y la pagina esta a la vista. Cuando
// deja de cumplirse, el brazo se detiene en el acto; cuando vuelve a
// cumplirse, el gesto que se este haciendo se confirma de nuevo.
function revisarPermiso() {
  const antes = estado.ordenesPermitidas;
  const ahora = brazo.conectado
    && estado.pestana === 'actividad'
    && !estado.mapeoAbierto
    && document.visibilityState === 'visible';
  estado.ordenesPermitidas = ahora;
  if (antes && !ahora) brazo.enviar(LETRA_PAUSA);
  if (!antes && ahora) estabilizador.reiniciar();
  $('quieto').hidden = !estado.mapeoAbierto;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') brazo.suspender();
  else brazo.reanudar();
  revisarPermiso();
});

window.addEventListener('pagehide', () => brazo.enviar(LETRA_PAUSA));

// ---------------------------------------------------------------------
//  CARGAR EL DISENO DE UN EQUIPO
//
//  Seis casillas, del gesto 0 al 5. Mientras una casilla tiene el foco,
//  el brazo se queda quieto: no se puede configurar y operar a la vez.
//
//  Apenas se aplica, el diseno se OCULTA. La pantalla se proyecta, y
//  parte del reto es que cada equipo recuerde su propio diseno. El
//  profesor puede revisarlo unos segundos con "Ver el diseno cargado".
// ---------------------------------------------------------------------
const casillas = GESTOS.map((g) => {
  const etiqueta = document.createElement('label');
  etiqueta.className = 'casilla';
  const entrada = document.createElement('input');
  entrada.maxLength = 1;
  entrada.setAttribute('aria-label', `Letra del gesto ${g}`);
  entrada.dataset.gesto = g;
  const pie = document.createElement('span');
  pie.textContent = `${g} ${g === 1 ? 'dedo' : 'dedos'}`;
  etiqueta.append(entrada, pie);
  $('casillas').append(etiqueta);
  return entrada;
});

function llenarCasillas(letras) {
  casillas.forEach((c, k) => { c.value = letras[k] || ''; c.classList.remove('mal'); });
}

function avisoMapeo(texto, bien = false) {
  $('aviso-mapeo').textContent = texto;
  $('aviso-mapeo').classList.toggle('bien', bien);
}

let relojMostrar = null;

function esDeFabrica(mapeo) {
  return GESTOS.every((g) => mapeo[g] === MAPEO_DE_FABRICA[g]);
}

function ocultarDiseno(oculto) {
  clearTimeout(relojMostrar);
  $('casillas').classList.toggle('oculto', oculto);
  $('boton-mostrar').textContent = oculto ? 'Ver el diseño cargado' : 'Ocultar el diseño';
}

function abrirMapeo(vaciar) {
  if (vaciar) llenarCasillas([]);
  ocultarDiseno(false);
  avisoMapeo('');
  casillas[0].focus();
}

function cerrarMapeo() {
  estado.escribiendo = false;
  for (const c of casillas) c.blur();
}

// El diseno de fabrica queda a la vista: no es de ningun equipo y es la
// referencia del profesor. El de un equipo se oculta.
function aplicarMapeo(mapeo, mensaje, oculto = true) {
  estado.mapeo = { ...mapeo };
  registrarMapeo(estado.mapeo, $('nombre-equipo').value.trim());
  llenarCasillas(letrasDe(estado.mapeo));
  ocultarDiseno(oculto);
  // El operador puede estar sosteniendo el mismo gesto de antes, pero
  // ahora significa otra cosa: hay que confirmarlo desde cero.
  estabilizador.reiniciar();
  avisoMapeo(mensaje, true);
}

const formMapeo = $('form-mapeo');
formMapeo.addEventListener('focusin', () => {
  estado.mapeoAbierto = true;
  revisarPermiso();
});
formMapeo.addEventListener('focusout', (e) => {
  if (formMapeo.contains(e.relatedTarget)) return;
  // Si se sale a mitad de un diseno sin aplicarlo, vuelven las letras
  // del diseno vigente, ocultas o no segun corresponda.
  if (estado.escribiendo) {
    estado.escribiendo = false;
    llenarCasillas(letrasDe(estado.mapeo));
    ocultarDiseno(!esDeFabrica(estado.mapeo));
  }
  estado.mapeoAbierto = false;
  revisarPermiso();
});

casillas.forEach((c, k) => {
  // Tocar una casilla oculta empieza un diseno nuevo desde cero, para
  // que no se vea el anterior.
  c.addEventListener('focus', () => {
    if ($('casillas').classList.contains('oculto') || esDeFabrica(estado.mapeo) && !estado.escribiendo) {
      estado.escribiendo = true;
      abrirMapeo(true);
    }
  });
  c.addEventListener('input', () => {
    c.value = c.value.toLowerCase();
    c.classList.remove('mal');
    if (c.value && k < casillas.length - 1) casillas[k + 1].focus();
    if (c.value) {
      const r = validarLetras(casillas.map((x) => x.value));
      avisoMapeo(r.aviso && !r.aviso.startsWith('Faltan') ? r.aviso : '');
      if (r.fila !== undefined && !r.aviso.startsWith('Faltan')) casillas[r.fila].classList.add('mal');
    }
  });
  c.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !c.value && k > 0) {
      casillas[k - 1].focus();
      casillas[k - 1].value = '';
      e.preventDefault();
    }
    if (e.key === 'ArrowLeft' && k > 0) casillas[k - 1].focus();
    if (e.key === 'ArrowRight' && k < casillas.length - 1) casillas[k + 1].focus();
    if (e.key === 'Escape') {
      // Cancelar: queda el diseno que estaba.
      llenarCasillas(letrasDe(estado.mapeo));
      ocultarDiseno(!esDeFabrica(estado.mapeo));
      avisoMapeo('Carga cancelada. Sigue el diseño anterior.');
      cerrarMapeo();
      e.stopPropagation();
    }
  });
});

formMapeo.addEventListener('submit', (e) => {
  e.preventDefault();
  const r = validarLetras(casillas.map((x) => x.value));
  if (r.aviso) {
    avisoMapeo(r.aviso);
    if (r.fila !== undefined && r.fila >= 0) {
      casillas[r.fila].classList.add('mal');
      casillas[r.fila].focus();
    }
    return;
  }
  const equipo = $('nombre-equipo').value.trim();
  aplicarMapeo(r.mapeo, equipo ? `Diseño de ${equipo} cargado y oculto.` : 'Diseño cargado y oculto.');
  cerrarMapeo();
});

$('boton-mostrar').addEventListener('click', () => {
  const oculto = $('casillas').classList.contains('oculto');
  ocultarDiseno(!oculto);
  // Se vuelve a ocultar solo, por si el profesor olvida hacerlo con la
  // pantalla proyectada.
  if (oculto) relojMostrar = setTimeout(() => ocultarDiseno(true), 6000);
});

function volverAFabrica() {
  $('nombre-equipo').value = '';
  aplicarMapeo(MAPEO_DE_FABRICA, 'De vuelta al diseño de fábrica.', false);
  cerrarMapeo();
}
$('boton-fabrica').addEventListener('click', volverAFabrica);

// Atajos de la version Python: M, F y Esc. Solo cuando no se esta
// escribiendo en un campo, para que la "f" o la "m" de una casilla no
// disparen nada.
document.addEventListener('keydown', (e) => {
  const enCampo = e.target.closest && e.target.closest('input, select, textarea');
  if (enCampo || e.metaKey || e.ctrlKey || e.altKey) return;
  if (estado.pestana !== 'actividad') return;
  if (e.key === 'm' || e.key === 'M') { e.preventDefault(); abrirMapeo(true); }
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); volverAFabrica(); }
});

$('boton-registro').addEventListener('click', () => {
  const registro = leerRegistro();
  if (!registro.length) {
    avisoMapeo('Todavía no se ha cargado ningún diseño en este navegador.');
    return;
  }
  const blob = new Blob([registroComoTexto(registro)], { type: 'text/plain;charset=utf-8' });
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(blob);
  enlace.download = 'mapeos_usados.txt';
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
});

// ---------------------------------------------------------------------
//  CAMARA Y DETECCION
// ---------------------------------------------------------------------
const video = $('video');
const lienzo = $('lienzo');
const ctx = lienzo.getContext('2d');
let detector = null;
let ultimoTiempo = -1;
let fallaDeteccion = false;

// Se detecta sobre el cuadro YA VOLTEADO en espejo, como hace la
// version Python (cv2.flip antes de detectar). No da lo mismo: el modelo
// de la mano no responde igual a una imagen y a su reflejo, y el umbral
// del pulgar y el 98.8 % de acierto se midieron con la imagen en espejo.
// Con un video real, detectar sin espejo hacia que un 3 se leyera como
// 4 durante casi un segundo (comparacion del 27 de octubre).
function detectar() {
  // MediaPipe exige tiempos en milisegundos siempre crecientes.
  const tiempo = Math.max(Math.round(performance.now()), ultimoTiempo + 1);
  ultimoTiempo = tiempo;
  return detector.detectForVideo(lienzo, tiempo).landmarks || [];
}

function dibujarMano(puntos, ancho, alto) {
  const escala = ancho / 640;
  // Los puntos ya vienen en las coordenadas de la imagen en espejo.
  const px = puntos.map((p) => [p.x * ancho, p.y * alto]);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2 * escala;
  ctx.beginPath();
  for (const [a, b] of UNIONES_MANO) {
    ctx.moveTo(px[a][0], px[a][1]);
    ctx.lineTo(px[b][0], px[b][1]);
  }
  ctx.stroke();
  ctx.fillStyle = '#ff8c1a';
  for (const [x, y] of px) {
    ctx.beginPath();
    ctx.arc(x, y, 6 * escala, 0, Math.PI * 2);
    ctx.fill();
  }
}

function procesarCuadro() {
  const ancho = video.videoWidth;
  const alto = video.videoHeight;
  if (!ancho || !alto) return;
  if (lienzo.width !== ancho || lienzo.height !== alto) {
    lienzo.width = ancho;
    lienzo.height = alto;
  }

  // Efecto espejo: se siente natural, como mirarse.
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -ancho, 0, ancho, alto);
  ctx.restore();

  let manos = [];
  if (detector && !fallaDeteccion) {
    try {
      manos = detectar();
    } catch (e) {
      fallaDeteccion = true;
      aviso('deteccion', 'La detección de la mano falló y hay que recargar la página. Detalle técnico, ' + e.message + '.', { grave: true });
    }
  }
  for (const puntos of manos) dibujarMano(puntos, ancho, alto);

  const lectura = leerManos(manos);
  estado.lectura = lectura;
  if (detector && !fallaDeteccion) estado.cuadros++;

  if (estabilizador.actualizar(lectura) && estado.ordenesPermitidas) {
    if (lectura === PAUSA || lectura === null) {
      // Dos manos = PAUSA. Sin mano = PAUSA tambien: el watchdog lo
      // detendria igual a los 400 ms, pero asi se detiene de una vez.
      brazo.enviar(LETRA_PAUSA);
    } else {
      brazo.enviar(COMANDO_A_LETRA[estado.mapeo[lectura]]);
    }
  }

  pintarLectura();
}

function pintarLectura() {
  $('crudo').textContent = 'detectando ' + (estado.lectura === null ? '–'
    : estado.lectura === PAUSA ? 'dos manos' : estado.lectura);
  const confirmado = estabilizador.confirmado;
  const caja = $('lectura');
  // La PAUSA interna que deja el estabilizador al reiniciarse no se
  // muestra: solo la de dos manos de verdad.
  if (confirmado === null || (confirmado === PAUSA && estabilizador.candidato !== PAUSA)) {
    caja.hidden = true;
  } else if (confirmado === PAUSA) {
    caja.hidden = false;
    caja.classList.add('pausa');
    $('lectura-numero').textContent = 'PAUSA';
  } else {
    caja.hidden = false;
    caja.classList.remove('pausa');
    // Solo el numero: el nombre de la orden delataria el diseno.
    $('lectura-numero').textContent = confirmado;
  }
}

let pararBucle = null;

async function iniciarCamara(idCamara) {
  $('cargando').hidden = false;
  $('cargando-texto').textContent = 'Abriendo la cámara…';
  try {
    let id;
    try {
      id = await abrirCamara(video, idCamara);
    } catch (e) {
      // La camara recordada de otra vez puede no estar conectada hoy.
      if (!idCamara || (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError')) throw e;
      id = await abrirCamara(video, '');
    }
    quitarAviso('camara');
    try { localStorage.setItem('imec-camara', id); } catch (e) { /* nada */ }
    await llenarSelectorCamaras(id);
    if (pararBucle) pararBucle();
    pararBucle = cadaCuadro(video, procesarCuadro);
    $('cargando').hidden = !!detector;
    if (!detector) $('cargando-texto').textContent = 'Cargando el modelo de la mano…';
  } catch (e) {
    $('cargando-texto').textContent = 'Sin cámara.';
    aviso('camara', mensajeErrorCamara(e), {
      grave: true,
      boton: { texto: 'Intentar de nuevo', alHacerClic: () => iniciarCamara() },
    });
  }
}

async function llenarSelectorCamaras(idActual) {
  const camaras = await listarCamaras();
  const selector = $('selector-camara');
  selector.replaceChildren();
  for (const c of camaras) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.nombre;
    o.selected = c.id === idActual;
    selector.append(o);
  }
}

$('selector-camara').addEventListener('change', (e) => iniciarCamara(e.target.value));
if (navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    llenarSelectorCamaras($('selector-camara').value).catch(() => {});
  });
}

// En iPhone el navegador no deja poner en pantalla completa una parte de
// la pagina: el boton no se muestra.
if (!document.fullscreenEnabled) $('boton-pantalla').hidden = true;

$('boton-pantalla').addEventListener('click', () => {
  const escenario = $('escenario');
  if (document.fullscreenElement) document.exitFullscreen();
  else if (escenario.requestFullscreen) escenario.requestFullscreen().catch(() => {});
});

async function iniciarDeteccion() {
  // MediaPipe en el navegador necesita WebGL siempre, aun calculando con
  // el procesador: sube cada cuadro de la camara como una textura. Si el
  // navegador tiene apagada la aceleracion grafica, no hay WebGL.
  if (!hayWebGL()) {
    $('cargando-texto').textContent = 'La detección de la mano no puede arrancar en este navegador.';
    const ajustes = /Edg\//.test(navigator.userAgent) ? 'edge://settings/system' : 'chrome://settings/system';
    aviso('modelo', `El navegador tiene apagada la aceleración gráfica, y sin ella la detección de la mano no funciona. Escriba ${ajustes} en la barra de direcciones, active «Usar aceleración de gráficos cuando esté disponible», reinicie el navegador y vuelva a abrir esta página.`, { grave: true });
    return;
  }
  try {
    const r = await crearDetector();
    detector = r.detector;
    $('motor').textContent = 'La detección corre en ' + r.motor + '.';
    if (video.srcObject) $('cargando').hidden = true;
  } catch (e) {
    $('cargando-texto').textContent = 'No se pudo cargar el modelo de la mano.';
    aviso('modelo', 'No se pudo cargar el modelo de la mano (' + e.message + '). Revise la conexión a internet y recargue la página.', { grave: true });
  }
}

// ---------------------------------------------------------------------
//  BRAZO: ESTADO Y CONEXION
// ---------------------------------------------------------------------
function pintarEstadoBrazo() {
  const e = brazo.estado;
  $('estado-brazo').dataset.estado = e;
  $('estado-texto').textContent = ESTADOS[e];
  const conectado = brazo.conectado;
  for (const id of ['boton-conectar', 'boton-conectar-2']) {
    $(id).textContent = conectado ? 'Cambiar de placa' : 'Conectar brazo';
    $(id).disabled = e === 'conectando' || e === 'programando' || e === 'sin-soporte';
  }
  $('boton-desconectar').disabled = !brazo.puerto;
  $('boton-preparar').disabled = e === 'programando' || e === 'conectando' || e === 'sin-soporte';
  $('bloque-preparar').classList.toggle('destacado', e === 'sin-programa' || e === 'programa-antiguo');

  const detalles = {
    'listo': `Conectado por ${brazo.detalle}. La placa tiene el programa del taller.`,
    'programa-antiguo': `Conectado por ${brazo.detalle}. La placa tiene el programa del taller de agosto: los gestos funcionan, pero para ver o cambiar pines hay que prepararla con el programa nuevo.`,
    'sin-programa': `La placa respondió por ${brazo.detalle}, pero no tiene el programa del taller. Use «Preparar la placa».`,
    'ocupado': 'No se pudo abrir el puerto. Cierre el Arduino IDE, el Monitor Serie o cualquier otro programa que esté usando la placa, y vuelva a conectar.',
    'otra-pestana': 'Esta página está abierta en otra pestaña o ventana y esa tiene el brazo. Ciérrela y vuelva a conectar aquí.',
    'perdido': 'Se perdió la conexión. Revise el cable USB; al volver a enchufarlo se reconecta solo.',
    'desconectado': 'Conecte el Arduino por USB y presione «Conectar brazo».',
    'conectando': 'Conectando. La placa se reinicia al conectar; tarda unos segundos.',
    'programando': 'Cargando el programa en la placa. No desconecte el cable.',
    'sin-soporte': 'Este navegador no puede hablar con el Arduino. Abra la página en Google Chrome o Microsoft Edge.',
    'no-compatible': `La placa conectada es un ${brazo.detalle}. Esta actividad necesita una placa con ATmega328P, como el Arduino Uno R3 o el Nano, originales o clones.`,
  };
  $('conexion-detalle').textContent = detalles[e] || '';

  if (e === 'sin-programa') {
    aviso('brazo', 'La placa conectada no tiene el programa del taller.', {
      grave: true,
      boton: { texto: 'Ir a preparar la placa', alHacerClic: () => { irA('brazo'); $('bloque-preparar').scrollIntoView({ behavior: 'smooth' }); } },
    });
  } else if (e === 'perdido') {
    aviso('brazo', 'Se perdió la conexión con el brazo. La detección sigue funcionando; al volver a enchufar el cable se reconecta solo.', { grave: true });
  } else if (e === 'ocupado' || e === 'otra-pestana' || e === 'no-compatible') {
    aviso('brazo', detalles[e], { grave: true });
  } else {
    quitarAviso('brazo');
  }
  pintarConfiguracion();
  revisarPermiso();
}

brazo.addEventListener('estado', pintarEstadoBrazo);
// Al conectar se lee la configuracion de la placa: lo que hay es lo
// guardado. Despues de un cambio se relee sin olvidar lo pendiente.
brazo.addEventListener('config', () => { estado.sinGuardar.clear(); pintarConfiguracion(); });
brazo.addEventListener('config-actualizada', pintarConfiguracion);

async function conectar(todos) {
  await brazo.elegir(todos);
}
$('boton-conectar').addEventListener('click', () => conectar(false));
$('boton-conectar-2').addEventListener('click', () => conectar(false));
$('boton-todos').addEventListener('click', () => conectar(true));
$('boton-desconectar').addEventListener('click', () => brazo.desconectar());

$('boton-preparar').addEventListener('click', async () => {
  const fases = {
    buscando: 'Buscando el bootloader de la placa…',
    escribiendo: 'Escribiendo el programa',
    verificando: 'Comprobando lo escrito',
    listo: 'Listo. Reconectando…',
  };
  $('progreso').hidden = false;
  $('barra-progreso').value = 0;
  try {
    if (!brazo.puerto && !brazo.ultimoPuerto) {
      const ok = await brazo.elegir(false);
      if (!ok && brazo.estado !== 'sin-programa' && brazo.estado !== 'programa-antiguo') {
        $('texto-progreso').textContent = 'Primero hay que elegir la placa.';
        return;
      }
    }
    const respuesta = await fetch('firmware/brazo_web.hex');
    if (!respuesta.ok) throw new Error('No se pudo descargar el programa del taller.');
    const hex = await respuesta.text();
    await brazo.preparar(hex, ({ fase, hecho, total }) => {
      $('barra-progreso').value = fase === 'buscando' ? 0
        : fase === 'escribiendo' ? (hecho / total) * 0.7
          : fase === 'verificando' ? 0.7 + (hecho / total) * 0.3 : 1;
      $('texto-progreso').textContent = fases[fase] + (fase === 'escribiendo' || fase === 'verificando' ? ` (${hecho} de ${total})` : '');
    });
    $('texto-progreso').textContent = brazo.estado === 'listo'
      ? 'Programa cargado y funcionando.'
      : 'El programa se cargó, pero la placa no respondió después. Desconecte y vuelva a conectar el cable.';
  } catch (e) {
    $('barra-progreso').value = 0;
    $('texto-progreso').textContent = e.message;
  }
});

// ---------------------------------------------------------------------
//  CONTROL MANUAL
// ---------------------------------------------------------------------
for (const b of document.querySelectorAll('#manual [data-letra]')) {
  const letra = b.dataset.letra;
  if (letra === 'i' || letra === 'd') {
    // El giro dura mientras se mantenga presionado, igual que el gesto.
    b.addEventListener('pointerdown', (e) => {
      b.setPointerCapture(e.pointerId);
      b.classList.add('activo');
      brazo.enviar(letra);
    });
    for (const fin of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      b.addEventListener(fin, () => {
        if (!b.classList.contains('activo')) return;
        b.classList.remove('activo');
        brazo.enviar(LETRA_PAUSA);
      });
    }
    b.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) brazo.enviar(letra); } });
    b.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') brazo.enviar(LETRA_PAUSA); });
  } else {
    b.addEventListener('click', () => brazo.enviar(letra));
  }
}

// ---------------------------------------------------------------------
//  PINES Y POSICIONES
// ---------------------------------------------------------------------
const NOMBRE_SERVO = Object.fromEntries(SERVOS.map((s) => [s.id, s.nombre.toLowerCase()]));

function avisoConfig(id, texto, bien = false) {
  $(id).textContent = texto;
  $(id).classList.toggle('bien', bien);
}

function pintarConfiguracion() {
  const configurable = brazo.configurable;
  const c = brazo.config;

  // Pines
  const pines = $('pines');
  pines.replaceChildren();
  if (!configurable) {
    const p = document.createElement('p');
    p.className = 'detalle';
    p.textContent = brazo.estado === 'programa-antiguo'
      ? 'La placa tiene el programa de agosto, que no permite cambiar los pines. Prepárela con el programa nuevo.'
      : 'Conecte una placa con el programa del taller para ver y cambiar los pines.';
    pines.append(p);
  }
  for (const s of configurable ? SERVOS : []) {
    const fila = document.createElement('div');
    fila.className = 'pin';
    const etiqueta = document.createElement('label');
    etiqueta.textContent = s.nombre;
    etiqueta.htmlFor = 'pin-' + s.id;
    const selector = document.createElement('select');
    selector.id = 'pin-' + s.id;
    selector.disabled = !configurable;
    if (!configurable || c[s.pin] === undefined) {
      // Sin datos de la placa no se muestra un pin que parezca real.
      const vacio = document.createElement('option');
      vacio.textContent = 'sin datos';
      vacio.selected = true;
      selector.append(vacio);
    }
    for (const p of PINES) {
      const o = document.createElement('option');
      o.value = p.valor;
      o.textContent = p.nombre;
      o.selected = c[s.pin] === p.valor;
      selector.append(o);
    }
    selector.addEventListener('change', () => cambiarPin(s, Number(selector.value)));
    const mover = document.createElement('button');
    mover.className = 'boton';
    mover.textContent = 'Mover un poco';
    mover.disabled = !configurable;
    mover.addEventListener('click', () => sacudir(s.id));
    fila.append(etiqueta, selector, mover);
    pines.append(fila);
  }

  // Posiciones
  const contenedor = $('posiciones');
  contenedor.replaceChildren();
  if (!configurable) {
    const p = document.createElement('p');
    p.className = 'detalle';
    p.textContent = brazo.estado === 'programa-antiguo'
      ? 'La placa tiene el programa de agosto, que no deja cambiar esto. Prepárela con el programa nuevo.'
      : 'Conecte una placa con el programa del taller para ver y cambiar los límites.';
    contenedor.append(p);
  } else {
    for (const s of SERVOS) {
      const grupo = document.createElement('div');
      grupo.className = 'grupo-servo';
      const h = document.createElement('h3');
      h.textContent = s.nombre;
      const pinTexto = document.createElement('small');
      pinTexto.textContent = 'pin ' + nombrePin(c[s.pin]);
      h.append(pinTexto);
      grupo.append(h);
      for (const pos of POSICIONES.filter((x) => x.servo === s.id)) {
        grupo.append(filaPosicion(pos, c[pos.clave]));
      }
      contenedor.append(grupo);
    }
  }

  $('boton-guardar').disabled = !configurable || estado.sinGuardar.size === 0;
  $('boton-config-fabrica').disabled = !configurable;
  $('sin-guardar').hidden = estado.sinGuardar.size === 0;
}

function filaPosicion(pos, valor) {
  const fila = document.createElement('div');
  fila.className = 'posicion';
  const nombre = document.createElement('label');
  nombre.textContent = pos.nombre;
  nombre.htmlFor = 'pos-' + pos.clave;
  const menos = document.createElement('button');
  menos.className = 'boton';
  menos.textContent = '−5°';
  menos.setAttribute('aria-label', `${pos.nombre}: restar 5 grados`);
  const entrada = document.createElement('input');
  entrada.id = 'pos-' + pos.clave;
  entrada.type = 'number';
  entrada.min = 0;
  entrada.max = 180;
  entrada.value = valor;
  entrada.classList.toggle('cambiado', estado.sinGuardar.has(pos.clave));
  const mas = document.createElement('button');
  mas.className = 'boton';
  mas.textContent = '+5°';
  mas.setAttribute('aria-label', `${pos.nombre}: sumar 5 grados`);
  const ir = document.createElement('button');
  ir.className = 'boton ir';
  ir.textContent = 'Ir ahí';

  const fijar = (nuevo) => {
    nuevo = Math.max(0, Math.min(180, Math.round(nuevo)));
    entrada.value = nuevo;
    cambiarPosicion(pos, nuevo, entrada);
  };
  menos.addEventListener('click', () => fijar(Number(entrada.value) - 5));
  mas.addEventListener('click', () => fijar(Number(entrada.value) + 5));
  entrada.addEventListener('change', () => fijar(Number(entrada.value)));
  ir.addEventListener('click', () => brazo.orden(`mover ${pos.servo} ${entrada.value}`).catch(() => {}));
  fila.append(nombre, menos, entrada, mas, ir);
  return fila;
}

async function cambiarPosicion(pos, valor, entrada) {
  try {
    const r = await brazo.orden(`set ${pos.clave} ${valor}`);
    if (r.tipo === 'error') {
      avisoConfig('aviso-posiciones', traducirError(r.texto));
      return;
    }
    brazo.config[pos.clave] = valor;
    estado.sinGuardar.add(pos.clave);
    entrada.classList.add('cambiado');
    await brazo.orden(`mover ${pos.servo} ${valor}`);
    avisoConfig('aviso-posiciones', `${pos.nombre} de ${NOMBRE_SERVO[pos.servo]}: ${valor}°.`, true);
  } catch (e) {
    avisoConfig('aviso-posiciones', e.message);
  }
  $('boton-guardar').disabled = estado.sinGuardar.size === 0;
  $('sin-guardar').hidden = estado.sinGuardar.size === 0;
}

// Cambiar un pin. Si el pin elegido ya lo usa otro servo, los dos se
// intercambian, pasando por un pin libre: la placa nunca deja dos
// servos en el mismo pin, ni siquiera por un instante.
async function cambiarPin(servo, pinNuevo) {
  const c = brazo.config;
  const pinViejo = c[servo.pin];
  const otro = SERVOS.find((s) => s !== servo && c[s.pin] === pinNuevo);
  try {
    if (otro) {
      const usados = new Set(SERVOS.map((s) => c[s.pin]));
      const libre = PINES.find((p) => !usados.has(p.valor)).valor;
      await ordenOError(`set ${otro.pin} ${libre}`);
      await ordenOError(`set ${servo.pin} ${pinNuevo}`);
      await ordenOError(`set ${otro.pin} ${pinViejo}`);
      avisoConfig('aviso-pines', `Intercambiados: ${servo.nombre.toLowerCase()} al ${nombrePin(pinNuevo)} y ${otro.nombre.toLowerCase()} al ${nombrePin(pinViejo)}.`, true);
      estado.sinGuardar.add(otro.pin);
    } else {
      await ordenOError(`set ${servo.pin} ${pinNuevo}`);
      avisoConfig('aviso-pines', `${servo.nombre} ahora en el ${nombrePin(pinNuevo)}.`, true);
    }
    estado.sinGuardar.add(servo.pin);
  } catch (e) {
    avisoConfig('aviso-pines', e.message);
  }
  await brazo.leerConfiguracionSinBorrar();
}

async function ordenOError(texto) {
  const r = await brazo.orden(texto);
  if (r.tipo === 'error') throw new Error(traducirError(r.texto));
  return r;
}

// "Mover un poco": sacude el servo unos grados y lo devuelve.
async function sacudir(servo) {
  try {
    brazo.angulos = null;
    brazo.enviar('?');
    for (let k = 0; k < 20 && !brazo.angulos; k++) await esperar(25);
    if (!brazo.angulos) throw new Error('La placa no dijo dónde está el servo.');
    const actual = brazo.angulos[servo];
    let paso = actual > 165 ? -12 : 12;
    if (servo === 'garra') {
      // Hacia el lado de "abierta", nunca hacia el cierre.
      paso = brazo.config.garra_abierta >= brazo.config.garra_cerrada ? 12 : -12;
    }
    const destino = Math.max(0, Math.min(180, actual + paso));
    for (let vez = 0; vez < 2; vez++) {
      await brazo.orden(`mover ${servo} ${destino}`);
      await esperar(350);
      await brazo.orden(`mover ${servo} ${actual}`);
      await esperar(350);
    }
    avisoConfig('aviso-pines', `Se movió el servo de ${NOMBRE_SERVO[servo]}. Si se movió otro, los cables están cambiados y hay que elegir el pin correcto en la lista.`, true);
  } catch (e) {
    avisoConfig('aviso-pines', e.message);
  }
}

$('boton-guardar').addEventListener('click', async () => {
  try {
    await ordenOError('guardar');
    estado.sinGuardar.clear();
    avisoConfig('aviso-posiciones', 'Guardado en la placa. Se conserva aunque se desconecte.', true);
  } catch (e) {
    avisoConfig('aviso-posiciones', e.message);
  }
  pintarConfiguracion();
});

// Volver a fabrica pide un segundo clic, sin ventanas emergentes.
let confirmarFabrica = null;
$('boton-config-fabrica').addEventListener('click', async () => {
  const boton = $('boton-config-fabrica');
  if (!confirmarFabrica) {
    boton.textContent = 'Presione otra vez para confirmar';
    confirmarFabrica = setTimeout(() => {
      boton.textContent = 'Volver a la configuración de fábrica';
      confirmarFabrica = null;
    }, 4000);
    return;
  }
  clearTimeout(confirmarFabrica);
  confirmarFabrica = null;
  boton.textContent = 'Volver a la configuración de fábrica';
  try {
    await ordenOError('fabrica');
    await brazo.leerConfiguracion();
    avisoConfig('aviso-posiciones', 'La placa volvió a la configuración de fábrica.', true);
  } catch (e) {
    avisoConfig('aviso-posiciones', e.message);
  }
});

// ---------------------------------------------------------------------
//  CONSOLA
// ---------------------------------------------------------------------
const consola = $('consola');
const MAX_LINEAS = 400;
brazo.addEventListener('consola', (e) => {
  const { sentido, texto } = e.detail;
  const linea = document.createElement('span');
  linea.className = sentido;
  linea.textContent = (sentido === 'pagina' ? '→ ' : sentido === 'placa' ? '← ' : '') + texto + '\n';
  const alFinal = consola.scrollTop + consola.clientHeight >= consola.scrollHeight - 20;
  consola.append(linea);
  while (consola.childNodes.length > MAX_LINEAS) consola.firstChild.remove();
  if (alFinal) consola.scrollTop = consola.scrollHeight;
});

$('form-consola').addEventListener('submit', async (e) => {
  e.preventDefault();
  const entrada = $('entrada-consola');
  const texto = entrada.value.trim();
  if (!texto) return;
  entrada.value = '';
  if (!brazo.puerto) {
    consola.append(Object.assign(document.createElement('span'), { className: 'sistema', textContent: 'No hay placa conectada.\n' }));
    return;
  }
  if (texto.startsWith('#')) {
    brazo.orden(texto.slice(1)).then(() => brazo.leerConfiguracionSinBorrar()).catch((err) => {
      consola.append(Object.assign(document.createElement('span'), { className: 'sistema', textContent: err.message + '\n' }));
    });
  } else {
    for (const letra of texto) brazo.enviar(letra);
  }
});

// ---------------------------------------------------------------------
//  ARRANQUE
// ---------------------------------------------------------------------
llenarCasillas(letrasDe(estado.mapeo));
ocultarDiseno(false);
pintarEstadoBrazo();

// En un telefono o una tablet la pagina sirve para explorar: probar la
// deteccion de la mano y leer como funciona. El brazo se maneja desde un
// computador, porque un iPhone no puede hablar con un Arduino por USB y
// en Android depende del modelo. Se ocultan los controles del brazo y
// del profesor en vez de mostrar errores.
const esTelefono = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
if (esTelefono) {
  document.body.classList.add('modo-telefono');
  aviso('telefono', 'Desde el teléfono se puede probar la detección de la mano y leer cómo funciona. Para mover el brazo, abra esta página en un computador con Chrome o Edge.');
} else if (!('serial' in navigator)) {
  aviso('navegador', 'Este navegador no puede conectarse con el Arduino. La detección de la mano funciona igual, pero para mover el brazo abra esta página en Google Chrome o Microsoft Edge.', { grave: true });
}

pestanaDesdeDireccion();
$('boton-imprimir').addEventListener('click', () => window.print());

iniciarDeteccion();
let idGuardado = '';
try { idGuardado = localStorage.getItem('imec-camara') || ''; } catch (e) { /* nada */ }
iniciarCamara(idGuardado).catch(() => {});
if (!esTelefono) brazo.reconectar().catch(() => {});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Para depurar desde la consola del navegador.
window.taller = { brazo, estado, estabilizador };
