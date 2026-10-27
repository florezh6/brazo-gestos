"""Pone en index.html un codigo de version, sacado del contenido, en la
direccion de cada archivo CSS y JavaScript: css/estilo.css?v=3f9a2c.

Por que: el navegador puede devolver un archivo de su memoria sin
preguntar, aun con service worker. Si el contenido cambia, cambia la
direccion, y ya no puede devolver la copia vieja. Sin esto, despues de
publicar un cambio la pagina podia quedar con HTML nuevo y CSS viejo.

Los modulos que se importan entre si (js/*.js y MediaPipe) se versionan
con un import map, que traduce cada direccion a su version.

Correr antes de cada commit: python3 herramientas/versionar.py
La prueba pruebas/versiones.test.js falla si se olvida.
"""
import hashlib, json, pathlib, re

RAIZ = pathlib.Path(__file__).resolve().parent.parent
MODULOS = sorted(p.relative_to(RAIZ).as_posix() for p in (RAIZ / 'js').glob('*.js'))
MODULOS.append('vendor/mediapipe/vision_bundle.mjs')


def codigo(ruta):
    return hashlib.sha256((RAIZ / ruta).read_bytes()).hexdigest()[:10]


def versionar():
    html = (RAIZ / 'index.html').read_text(encoding='utf-8')
    html, n = re.subn(r'href="css/estilo\.css(\?v=[0-9a-f]*)?"', f'href="css/estilo.css?v={codigo("css/estilo.css")}"', html)
    assert n == 1, 'no encontre la hoja de estilos en index.html'
    html, n = re.subn(r'src="js/app\.js(\?v=[0-9a-f]*)?"', f'src="js/app.js?v={codigo("js/app.js")}"', html)
    assert n == 1, 'no encontre js/app.js en index.html'
    mapa = {'imports': {f'./{m}': f'./{m}?v={codigo(m)}' for m in MODULOS if m != 'js/app.js'}}
    bloque = '<script type="importmap">\n' + json.dumps(mapa, indent=2) + '\n  </script>'
    patron = re.compile(r'<!-- mapa-modulos -->.*?<!-- /mapa-modulos -->', re.S)
    assert patron.search(html), 'falta el marcador <!-- mapa-modulos --> en index.html'
    html = patron.sub(lambda m: '<!-- mapa-modulos -->\n  ' + bloque + '\n  <!-- /mapa-modulos -->', html)
    (RAIZ / 'index.html').write_text(html, encoding='utf-8')
    return html


if __name__ == '__main__':
    versionar()
    print('versiones puestas en index.html')
