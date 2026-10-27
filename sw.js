// Guarda la pagina en el navegador para que funcione sin internet
// despues de la primera visita. Un colegio puede tener la red caida o
// bloqueada justo el dia de la actividad.
//
// - MediaPipe y el modelo (carpetas vendor/ y modelo/) no cambian: se
//   sirven desde lo guardado y solo se descargan una vez.
// - Todo lo demas se sirve desde lo guardado y, en paralelo, se pide la
//   version nueva a internet para la proxima vez.

// Si se cambia MediaPipe o el modelo, hay que cambiar este nombre: lo
// guardado de vendor/ y modelo/ no se vuelve a pedir nunca.
const CAJA = 'brazo-gestos-v1';

const BASICOS = [
  './',
  'index.html',
  'guia.html',
  'formulario.html',
  'css/estilo.css',
  'js/app.js',
  'js/brazo.js',
  'js/camara.js',
  'js/deteccion.js',
  'js/mapeo.js',
  'js/programador.js',
  'js/protocolo.js',
  'firmware/brazo_web.hex',
  'fuentes/archivo-latin-wght-normal.woff2',
  'fuentes/archivo-latin-ext-wght-normal.woff2',
  'icono.svg',
  'vendor/mediapipe/vision_bundle.mjs',
  // MediaPipe pide estos dos antes de que este archivo tome control de
  // la pagina en la primera visita: si no se guardan aqui, no quedan
  // guardados nunca. Chrome y Edge usan la version SIMD; la otra,
  // nosimd, solo se guarda si algun navegador la llega a pedir.
  'vendor/mediapipe/wasm/vision_wasm_internal.js',
  'vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  'modelo/hand_landmarker.task',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CAJA).then((caja) => caja.addAll(BASICOS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n !== CAJA).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  if (url.origin !== location.origin) return;

  const fijo = url.pathname.includes('/vendor/') || url.pathname.includes('/modelo/');

  evento.respondWith((async () => {
    const caja = await caches.open(CAJA);
    const guardado = await caja.match(pedido, { ignoreSearch: true });

    const deInternet = fetch(pedido).then((respuesta) => {
      if (respuesta.ok) caja.put(pedido, respuesta.clone());
      return respuesta;
    });

    if (guardado) {
      if (!fijo) evento.waitUntil(deInternet.catch(() => {}));
      return guardado;
    }
    return deInternet;
  })());
});
