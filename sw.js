// Guarda la pagina en el navegador para que funcione sin internet
// despues de la primera visita. Un colegio puede tener la red caida o
// bloqueada justo el dia de la actividad.
//
// Dos cajas separadas:
//
// - FIJOS: MediaPipe y el modelo (carpetas vendor/ y modelo/). No
//   cambian entre versiones, pesan unos 20 MB y se sirven siempre desde
//   lo guardado. Solo se cambia el nombre de esta caja si se cambia
//   MediaPipe o el modelo.
//
// - PAGINA: todo lo demas. Se pide SIEMPRE primero a internet,
//   revalidando con el servidor (cache: 'no-cache'), y lo guardado se usa
//   solo si no hay conexion o si la red tarda mas de 4 segundos.
//
// La version anterior servia primero lo guardado y actualizaba por
// detras. Con GitHub Pages, que deja al navegador reusar cada archivo
// hasta 10 minutos, eso mezclaba versiones despues de publicar un cambio:
// HTML nuevo con CSS viejo. pruebas/actualizacion.mjs reproduce ese caso.

const PAGINA = 'brazo-gestos-pagina-v3';
const FIJOS = 'brazo-gestos-fijos-v1';
const MS_ESPERA_RED = 4000;

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
  'fuentes/barlow-latin-400-normal.woff2',
  'fuentes/barlow-latin-600-normal.woff2',
  'fuentes/barlow-latin-700-normal.woff2',
  'fuentes/barlow-semi-condensed-latin-700-normal.woff2',
  'fuentes/barlow-semi-condensed-latin-800-italic.woff2',
  'marca/uniandes.svg',
  'marca/departamento-imec.svg',
  'marca/mechita.svg',
  'marca/mechita-cara.svg',
];

const BASICOS_FIJOS = [
  'vendor/mediapipe/vision_bundle.mjs',
  // MediaPipe pide estos dos antes de que este archivo tome control de
  // la pagina en la primera visita: si no se guardan aqui, no quedan
  // guardados nunca. Chrome y Edge usan la version SIMD; la otra,
  // nosimd, solo se guarda si algun navegador la llega a pedir.
  'vendor/mediapipe/wasm/vision_wasm_internal.js',
  'vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  'modelo/hand_landmarker.task',
];

const esFijo = (url) => url.pathname.includes('/vendor/') || url.pathname.includes('/modelo/');

// Guarda una lista de archivos saltandose la cache del navegador, para
// no guardar una copia vieja que el navegador todavia tenga.
//
// Con soloSiFalta (MediaPipe y el modelo), primero busca el archivo en
// cualquier caja guardada antes, incluso de una version anterior de este
// archivo. Asi una actualizacion no vuelve a bajar 20 MB, y la nueva
// version toma el control en un par de segundos en vez de un minuto.
async function guardar(nombreCaja, rutas, soloSiFalta) {
  const caja = await caches.open(nombreCaja);
  await Promise.all(rutas.map(async (ruta) => {
    if (soloSiFalta) {
      if (await caja.match(ruta)) return;
      const anterior = await caches.match(ruta, { ignoreSearch: true });
      if (anterior) {
        await caja.put(ruta, anterior);
        return;
      }
    }
    const respuesta = await fetch(ruta, { cache: 'reload' });
    if (!respuesta.ok) throw new Error('No se pudo guardar ' + ruta);
    await caja.put(ruta, respuesta);
  }));
}

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    Promise.all([guardar(PAGINA, BASICOS, false), guardar(FIJOS, BASICOS_FIJOS, true)])
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  const preparar = (async () => {
    const viejas = (await caches.keys()).filter((n) => n !== PAGINA && n !== FIJOS);
    await Promise.all(viejas.map((n) => caches.delete(n)));
    await self.clients.claim();
    return viejas.length > 0;
  })();
  evento.waitUntil(preparar);
  // Si habia una version anterior, las pestanas abiertas se cargaron con
  // ella: se recargan una vez para quedar enteras con la nueva. OJO: la
  // recarga se pide DESPUES de terminar la activacion y sin esperarla.
  // Si se esperara dentro de waitUntil, la recarga quedaria en fila
  // esperando a que este archivo termine de activarse, y este esperando
  // a la recarga: la pagina se congela.
  preparar.then(async (habiaAnterior) => {
    if (!habiaAnterior) return;
    const ventanas = await self.clients.matchAll({ type: 'window' });
    for (const v of ventanas) v.navigate(v.url).catch(() => {});
  });
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  if (url.origin !== location.origin) return;

  if (esFijo(url)) {
    evento.respondWith((async () => {
      const caja = await caches.open(FIJOS);
      const guardado = await caja.match(pedido, { ignoreSearch: true });
      if (guardado) return guardado;
      const respuesta = await fetch(pedido);
      if (respuesta.ok) caja.put(pedido, respuesta.clone());
      return respuesta;
    })());
    return;
  }

  evento.respondWith((async () => {
    const caja = await caches.open(PAGINA);
    // La pagina principal se guarda bajo './' aunque se pida con #guia
    // o como index.html.
    const clave = url.pathname.endsWith('/') ? new URL('./', self.registration.scope).href : url.href.split('#')[0];
    const deInternet = fetch(url.href.split('#')[0], { cache: 'no-cache', credentials: 'same-origin' })
      .then((respuesta) => {
        if (respuesta.ok) caja.put(clave, respuesta.clone());
        return respuesta;
      });
    deInternet.catch(() => {});   // si falla despues del limite, que no quede un error suelto
    const limite = new Promise((resolver) => setTimeout(() => resolver(null), MS_ESPERA_RED));
    try {
      const primera = await Promise.race([deInternet, limite]);
      if (primera) return primera;
    } catch (e) {
      // Sin conexion: se usa lo guardado.
    }
    const guardado = await caja.match(clave, { ignoreSearch: true });
    if (guardado) return guardado;
    return deInternet;
  })());
});
