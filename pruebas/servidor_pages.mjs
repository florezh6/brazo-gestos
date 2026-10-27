// Servidor que imita a GitHub Pages para probar las actualizaciones:
// manda Cache-Control: max-age=600 y ETag, responde 304, y permite
// cambiar en vivo la carpeta que sirve (una version publicada por otra)
// con GET /__version?dir=<ruta>.
//
// Uso: node pruebas/servidor_pages.mjs <carpeta-inicial>   (puerto 8766)
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join, normalize } from 'node:path';

let raiz = process.argv[2];
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.hex': 'application/octet-stream', '.task': 'application/octet-stream',
};

createServer((pedido, respuesta) => {
  const url = new URL(pedido.url, 'http://x');
  if (url.pathname === '/__version') {
    raiz = url.searchParams.get('dir');
    respuesta.writeHead(200).end('ok ' + raiz);
    return;
  }
  let ruta = decodeURIComponent(url.pathname);
  if (ruta.endsWith('/')) ruta += 'index.html';
  const archivo = normalize(join(raiz, ruta));
  try { statSync(archivo); } catch (e) { respuesta.writeHead(404).end(); return; }
  const datos = readFileSync(archivo);
  const etag = '"' + createHash('md5').update(datos).digest('hex') + '"';
  const cabeceras = { 'Cache-Control': 'max-age=600', ETag: etag, 'Content-Type': TIPOS[extname(archivo)] || 'application/octet-stream' };
  if (pedido.headers['if-none-match'] === etag) { respuesta.writeHead(304, cabeceras).end(); return; }
  respuesta.writeHead(200, { ...cabeceras, 'Content-Length': datos.length }).end(datos);
}).listen(8766, '127.0.0.1', () => console.log('Pages simulado en http://localhost:8766/'));
