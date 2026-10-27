// Camara y modelo de la mano.
//
// El modelo es el mismo hand_landmarker.task de la version Python, con
// las mismas opciones. MediaPipe va copiado dentro de la pagina
// (carpeta vendor/) en una version fija: si se cargara de internet, una
// actualizacion ajena podria cambiar la deteccion sin aviso.

import { FilesetResolver, HandLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

const RUTA_WASM = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
const RUTA_MODELO = new URL('../modelo/hand_landmarker.task', import.meta.url).href;

const OPCIONES = {
  runningMode: 'VIDEO',
  numHands: 2,                       // la segunda mano es la PAUSA
  minHandDetectionConfidence: 0.7,
  minTrackingConfidence: 0.5,
};

// Crea el detector. Intenta con la tarjeta grafica, que es mas rapida,
// y si el computador no la deja usar, con el procesador.
export async function crearDetector() {
  const archivos = await FilesetResolver.forVisionTasks(RUTA_WASM);
  try {
    const d = await HandLandmarker.createFromOptions(archivos, {
      ...OPCIONES,
      baseOptions: { modelAssetPath: RUTA_MODELO, delegate: 'GPU' },
    });
    return { detector: d, motor: 'la tarjeta gráfica' };
  } catch (e) {
    const d = await HandLandmarker.createFromOptions(archivos, {
      ...OPCIONES,
      baseOptions: { modelAssetPath: RUTA_MODELO, delegate: 'CPU' },
    });
    return { detector: d, motor: 'el procesador' };
  }
}

export function hayWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) {
    return false;
  }
}

export function sistemaOperativo() {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac';
  return 'otro';
}

// Traduce el error del navegador a lo que el profesor tiene que hacer.
export function mensajeErrorCamara(error) {
  const so = sistemaOperativo();
  switch (error && error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      if (so === 'mac') {
        return 'El navegador no tiene permiso para usar la cámara. Haga clic en el ícono de la cámara a la derecha de la barra de direcciones y elija «Permitir». Si ya estaba permitido, abra Ajustes del Sistema › Privacidad y seguridad › Cámara, active el navegador y vuelva a abrirlo.';
      }
      if (so === 'windows') {
        return 'El navegador no tiene permiso para usar la cámara. Haga clic en el ícono de la cámara a la derecha de la barra de direcciones y elija «Permitir». Si ya estaba permitido, abra Configuración › Privacidad y seguridad › Cámara y active «Permitir que las aplicaciones de escritorio accedan a la cámara».';
      }
      return 'El navegador no tiene permiso para usar la cámara. Permítalo desde el ícono de la cámara en la barra de direcciones.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No se encontró ninguna cámara. Conecte una cámara web o revise que la del portátil no esté desactivada.';
    case 'NotReadableError':
    case 'AbortError':
      return 'La cámara está ocupada por otro programa. Cierre Zoom, Teams, Meet u otra pestaña que la esté usando, y vuelva a intentar.';
    default:
      return 'No se pudo abrir la cámara (' + ((error && error.message) || error) + ').';
  }
}

// Lista de camaras con su nombre. Los nombres solo aparecen despues de
// dar permiso a la primera.
export async function listarCamaras() {
  const dispositivos = await navigator.mediaDevices.enumerateDevices();
  return dispositivos
    .filter((d) => d.kind === 'videoinput')
    .map((d, k) => ({ id: d.deviceId, nombre: d.label || `Cámara ${k + 1}` }));
}

export async function abrirCamara(video, idCamara) {
  if (video.srcObject) {
    for (const pista of video.srcObject.getTracks()) pista.stop();
    video.srcObject = null;
  }
  const flujo = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      deviceId: idCamara ? { exact: idCamara } : undefined,
      // En un telefono, la camara de adelante: la mano se ve en la pantalla.
      facingMode: idCamara ? undefined : 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  video.srcObject = flujo;
  await video.play();
  const pista = flujo.getVideoTracks()[0];
  return pista.getSettings().deviceId || idCamara || '';
}

// Llama a "alCuadro" una vez por cada cuadro nuevo de la camara.
export function cadaCuadro(video, alCuadro) {
  let activo = true;
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const siguiente = () => {
      if (!activo) return;
      video.requestVideoFrameCallback((ahora) => {
        alCuadro(ahora);
        siguiente();
      });
    };
    siguiente();
  } else {
    let ultimoTiempo = -1;
    const vuelta = (ahora) => {
      if (!activo) return;
      if (video.currentTime !== ultimoTiempo) {
        ultimoTiempo = video.currentTime;
        alCuadro(ahora);
      }
      requestAnimationFrame(vuelta);
    };
    requestAnimationFrame(vuelta);
  }
  return () => { activo = false; };
}
