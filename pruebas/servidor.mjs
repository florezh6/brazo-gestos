// Servidor local minimo para probar la pagina: node pruebas/servidor.mjs
// Sirve la raiz del repositorio en http://localhost:8765/
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PUERTO = Number(process.env.PUERTO || 8765);
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
  '.hex': 'text/plain; charset=utf-8', '.task': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
};

createServer((pedido, respuesta) => {
  let ruta = decodeURIComponent(new URL(pedido.url, 'http://x').pathname);
  if (ruta.endsWith('/')) ruta += 'index.html';
  const archivo = normalize(join(RAIZ, ruta));
  if (!archivo.startsWith(RAIZ)) { respuesta.writeHead(403).end(); return; }
  let info;
  try { info = statSync(archivo); } catch (e) { respuesta.writeHead(404).end('no existe'); return; }
  respuesta.writeHead(200, {
    'Content-Type': TIPOS[extname(archivo)] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-store',
  });
  createReadStream(archivo).on('error', () => respuesta.destroy()).pipe(respuesta);
}).listen(PUERTO, '127.0.0.1', () => console.log('Sirviendo en http://localhost:' + PUERTO + '/'));
