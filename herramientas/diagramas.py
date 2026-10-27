"""Genera los dos diagramas SVG de la pagina y los inserta en index.html
entre los comentarios <!-- diagrama:NOMBRE --> y <!-- /diagrama:NOMBRE -->.

Uso: python3 herramientas/diagramas.py
"""
import re, pathlib

RAIZ = pathlib.Path(__file__).resolve().parent.parent


def cableado(d, clase, desplazamientos=(-3.5, 0, 3.5), colores=('#7a4a24', '#d6402b', '#f08a1c')):
    """Un cable de servo: tres hilos paralelos (marron, rojo, naranja)."""
    out = [f'<path d="{d}" class="d-funda"/>']
    for dx, color in zip(desplazamientos, colores):
        out.append(f'<path d="{d}" transform="translate({dx} {dx})" stroke="{color}" class="d-hilo"/>')
    return '\n'.join(out)


def conexiones():
    W, H = 920, 560
    s = []
    s.append(f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Tres circuitos: el USB lleva datos y la alimentación del Arduino; la fuente alimenta solo los motores por la bornera del shield; cada servo recibe su señal por la columna de su pin. El puente SEL va retirado.">')
    s.append('''<defs>
  <marker id="d-flecha" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" class="d-punta"/></marker>
</defs>''')

    # --- computador ---
    s.append('''<g class="d-portatil">
  <rect x="34" y="70" width="150" height="96" rx="8" class="d-pantalla"/>
  <rect x="44" y="80" width="130" height="76" rx="3" class="d-vidrio"/>
  <path d="M22 172 L196 172 L184 186 L34 186 Z" class="d-teclado"/>
  <text x="109" y="124" class="d-t" text-anchor="middle">Chrome o Edge</text>
</g>''')

    # --- placa: Arduino Uno con Sensor Shield V5, vista de arriba ---
    bx, by, bw, bh = 300, 70, 360, 270
    s.append(f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="12" class="d-placa"/>')
    s.append(f'<rect x="{bx-26}" y="{by+22}" width="40" height="46" rx="4" class="d-metal"/>')          # USB-B
    s.append(f'<rect x="{bx-18}" y="{by+190}" width="34" height="40" rx="5" class="d-jack"/>')          # jack DC del Arduino
    s.append(f'<text x="{bx+bw/2+40}" y="{by+bh-16}" class="d-t claro" text-anchor="middle">Arduino Uno + Sensor Shield V5</text>')

    # columnas de pines D2..D13, tres pines cada una
    cols = list(range(2, 14))
    x0, paso, y_s = 400, 21, by + 44
    filas = [('S', y_s), ('V', y_s + 21), ('G', y_s + 42)]
    usados = {3: 'garra', 9: 'base', 10: 'altura', 11: 'alcance'}
    s.append(f'<text x="{x0-14}" y="{y_s+76}" class="d-t claro chico" text-anchor="middle">D</text>')
    for letra, y in filas:
        s.append(f'<text x="{x0-14}" y="{y+13}" class="d-t claro chico" text-anchor="middle">{letra}</text>')
    for k, pin in enumerate(cols):
        x = x0 + k * paso
        s.append(f'<text x="{x+8}" y="{y_s+76}" class="d-t claro chico" text-anchor="middle">{pin}</text>')
        for _, y in filas:
            clase = 'd-pin usado' if pin in usados else 'd-pin'
            s.append(f'<rect x="{x}" y="{y}" width="16" height="16" rx="2" class="{clase}"/>')

    # bornera y puente SEL
    s.append(f'<rect x="{bx+40}" y="{by+176}" width="74" height="34" rx="4" class="d-bornera"/>')
    s.append(f'<circle cx="{bx+58}" cy="{by+193}" r="8" class="d-tornillo"/><circle cx="{bx+96}" cy="{by+193}" r="8" class="d-tornillo"/>')
    s.append(f'<text x="{bx+44}" y="{by+236}" class="d-signo" text-anchor="middle">+</text><text x="{bx+110}" y="{by+236}" class="d-signo" text-anchor="middle">−</text>')
    s.append(f'<text x="{bx+77}" y="{by+168}" class="d-t claro chico" text-anchor="middle">bornera</text>')
    sx, sy = bx + 168, by + 180
    s.append(f'<rect x="{sx}" y="{sy}" width="16" height="16" rx="2" class="d-pin"/><rect x="{sx+20}" y="{sy}" width="16" height="16" rx="2" class="d-pin"/>')
    s.append(f'<path d="M{sx-8} {sy-8} L{sx+44} {sy+24} M{sx+44} {sy-8} L{sx-8} {sy+24}" class="d-tachado"/>')
    s.append(f'<text x="{sx+18}" y="{sy+44}" class="d-t claro chico" text-anchor="middle">SEL sin puente</text>')

    # --- USB ---
    s.append(f'<path d="M184 120 C230 120 240 115 {bx-26} 115" class="d-cable-usb"/>')
    s.append(f'<text x="236" y="104" class="d-t" text-anchor="middle">USB</text>')
    s.append(f'<text x="236" y="146" class="d-t chico" text-anchor="middle">datos y 5 V</text>')
    s.append(f'<text x="236" y="162" class="d-t chico" text-anchor="middle">para el Arduino</text>')

    # --- fuente ---
    s.append('''<g class="d-fuente">
  <rect x="40" y="400" width="130" height="92" rx="14" class="d-adaptador"/>
  <rect x="22" y="424" width="20" height="9" rx="2" class="d-metal"/><rect x="22" y="458" width="20" height="9" rx="2" class="d-metal"/>
  <text x="105" y="440" class="d-t claro" text-anchor="middle">Fuente</text>
  <text x="105" y="460" class="d-t claro chico" text-anchor="middle">5 a 6 V · 3 A o más</text>
</g>''')
    s.append('<path d="M170 446 C210 446 200 470 236 470" class="d-cable-dc"/>')
    s.append('<rect x="236" y="456" width="56" height="30" rx="4" class="d-adaptador-bornera"/>')
    s.append('<text x="264" y="510" class="d-t chico" text-anchor="middle">plug a bornera</text>')
    s.append(f'<path d="M292 464 L{bx+58} 464 L{bx+58} {by+201}" class="d-cable-pos"/>')
    s.append(f'<path d="M292 478 L{bx+96} 478 L{bx+96} {by+201}" class="d-cable-neg"/>')
    s.append(f'<text x="{bx+112}" y="432" class="d-t">energía de los motores</text>')
    s.append(f'<text x="{bx+112}" y="448" class="d-t chico">no pasa por el Arduino</text>')

    # --- servos a la derecha ---
    serv_y = {3: 74, 9: 186, 10: 298, 11: 410}
    alt_h = {3: 26, 9: 34, 10: 42, 11: 50}     # alturas de los tramos horizontales
    caida = {3: 732, 9: 722, 10: 712, 11: 702}  # columnas de bajada, anidadas sin cruces
    for pin, nombre in usados.items():
        k = cols.index(pin)
        xc = x0 + k * paso + 8
        y_srv = serv_y[pin] + 30
        d = f'M{xc} {y_s} L{xc} {alt_h[pin]} L{caida[pin]} {alt_h[pin]} L{caida[pin]} {y_srv} L770 {y_srv}'
        s.append(cableado(d, 'servo'))
        # cuerpo del servo
        y = serv_y[pin]
        s.append(f'<rect x="770" y="{y}" width="120" height="60" rx="6" class="d-servo"/>')
        s.append(f'<rect x="760" y="{y+22}" width="140" height="16" rx="3" class="d-servo-alas"/>')
        s.append(f'<circle cx="864" cy="{y+30}" r="14" class="d-cuerno"/>')
        s.append(f'<text x="814" y="{y+35}" class="d-t claro" text-anchor="middle">{nombre}</text>')
        s.append(f'<text x="814" y="{y+80}" class="d-t chico" text-anchor="middle">pin {pin}</text>')
    s.append('<text x="716" y="18" class="d-t chico" text-anchor="middle">señal de cada servo</text>')

    # recuadro: orden de los hilos
    s.append('''<g transform="translate(440 470)">
  <rect x="0" y="0" width="290" height="70" rx="8" class="d-recuadro"/>
  <text x="14" y="22" class="d-t chico">Conector del servo</text>
  <rect x="14" y="34" width="20" height="20" rx="2" fill="#7a4a24"/><text x="40" y="49" class="d-t chico">G marrón</text>
  <rect x="112" y="34" width="20" height="20" rx="2" fill="#d6402b"/><text x="138" y="49" class="d-t chico">V rojo</text>
  <rect x="190" y="34" width="20" height="20" rx="2" fill="#f08a1c"/><text x="216" y="49" class="d-t chico">S naranja</text>
</g>''')
    s.append('</svg>')
    return '\n'.join(s)


def brazo():
    W, H = 640, 430
    s = [f'<svg viewBox="0 0 {W} {H}" data-dibujo="brazo" aria-hidden="true">']
    s.append('''<defs>
  <marker id="b-flecha" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" class="b-punta"/></marker>
</defs>''')
    # base: caja, tornamesa
    s.append('<path d="M110 360 L110 386 A150 32 0 0 0 410 386 L410 360" class="b-base-lado"/>')
    s.append('<ellipse cx="260" cy="360" rx="150" ry="32" class="b-base"/>')
    s.append('<ellipse cx="260" cy="346" rx="96" ry="20" class="b-tornamesa"/>')
    # flechas de giro sobre el frente de la base
    s.append('<path d="M206 399 A150 32 0 0 1 114 370" class="b-mov" marker-end="url(#b-flecha)"/>')
    s.append('<path d="M314 399 A150 32 0 0 0 406 370" class="b-mov" marker-end="url(#b-flecha)"/>')
    # torre con sus dos servos
    s.append('<path d="M215 346 L225 250 L295 250 L305 346 Z" class="b-pieza"/>')
    s.append('<rect x="196" y="268" width="34" height="58" rx="5" class="b-servo"/>')
    s.append('<rect x="290" y="268" width="34" height="58" rx="5" class="b-servo"/>')
    # brazo principal y antebrazo (barras con contorno)
    for d in ('M260 258 L330 116', 'M330 116 L505 158'):
        s.append(f'<path d="{d}" class="b-barra-borde"/><path d="{d}" class="b-barra"/>')
    # varillas del paralelogramo
    s.append('<path d="M282 276 L350 136" class="b-varilla"/>')
    s.append('<path d="M350 136 L512 176" class="b-varilla"/>')
    s.append('<path d="M330 116 L350 136 L340 96 Z" class="b-pieza"/>')
    # garra tipo canasta y su servo
    s.append('<rect x="494" y="128" width="30" height="24" rx="4" class="b-servo"/>')
    s.append('<path d="M500 166 C486 196 492 222 514 232" class="b-garra"/>')
    s.append('<path d="M520 166 C546 192 544 220 522 234" class="b-garra"/>')
    for cx, cy, r in ((260, 258, 12), (330, 116, 11), (505, 158, 9), (282, 276, 6), (350, 136, 6)):
        s.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" class="b-eje"/>')
    # movimiento de la altura: el antebrazo sube y baja
    s.append('<path d="M440 112 L440 66" class="b-mov" marker-end="url(#b-flecha)"/>')
    s.append('<path d="M440 182 L440 228" class="b-mov" marker-end="url(#b-flecha)"/>')
    # garra: una guia del dedo de la garra a sus dos botones
    s.append('<path d="M530 238 L560 266" class="b-guia"/>')
    s.append('</svg>')
    return '\n'.join(s)


# Los colores van tambien como atributos dentro del SVG, para que el
# dibujo salga bien aunque la hoja de estilos no cargue o sea de otra
# version. Las reglas de css/estilo.css tienen prioridad sobre estos
# atributos, asi que alli se pueden seguir ajustando.
LETRA = 'font-family="Poppins, system-ui, sans-serif"'
ESTILOS = {
    'd-portatil': '', 'd-fuente': '',
    'd-t': f'{LETRA} font-size="12.5" font-weight="600" fill="#1b2c41"',
    'd-t chico': f'{LETRA} font-size="11" font-weight="600" fill="#1b2c41"',
    'd-t claro': f'{LETRA} font-size="12.5" font-weight="600" fill="#ffffff"',
    'd-t claro chico': f'{LETRA} font-size="11" font-weight="600" fill="#ffffff"',
    'd-signo': f'{LETRA} font-size="22" font-weight="700" fill="#ffffff"',
    'd-placa': 'fill="#0f6e8c" stroke="#111" stroke-width="3"',
    'd-metal': 'fill="#c7cfd8" stroke="#5d6b7a" stroke-width="2"',
    'd-jack': 'fill="#222" stroke="#111" stroke-width="2"',
    'd-pin': 'fill="#e9eef4" stroke="#0b3c4d" stroke-width="1.5"',
    'd-pin usado': 'fill="#ffe500" stroke="#111" stroke-width="1.5"',
    'd-bornera': 'fill="#2fae5b" stroke="#111" stroke-width="2"',
    'd-tornillo': 'fill="#c7cfd8" stroke="#39434f" stroke-width="2"',
    'd-tachado': 'stroke="#ff5a45" stroke-width="4" stroke-linecap="round" fill="none"',
    'd-pantalla': 'fill="#1b2c41"',
    'd-vidrio': 'fill="#d9e6f6"',
    'd-teclado': 'fill="#9fb0c4" stroke="#1b2c41" stroke-width="2"',
    'd-adaptador': 'fill="#2b3a4f" stroke="#111" stroke-width="2.5"',
    'd-adaptador-bornera': 'fill="#2fae5b" stroke="#111" stroke-width="2"',
    'd-cable-usb': 'stroke="#6b7c90" stroke-width="7" fill="none" stroke-linecap="round"',
    'd-cable-dc': 'stroke="#222" stroke-width="6" fill="none" stroke-linecap="round"',
    'd-cable-pos': 'stroke="#d6402b" stroke-width="4.5" fill="none" stroke-linejoin="round"',
    'd-cable-neg': 'stroke="#111" stroke-width="4.5" fill="none" stroke-linejoin="round"',
    'd-funda': 'stroke="#000" stroke-opacity="0.18" stroke-width="14" fill="none" stroke-linejoin="round"',
    'd-hilo': 'stroke-width="3.2" fill="none" stroke-linejoin="round"',
    'd-servo': 'fill="#2b3a4f" stroke="#111" stroke-width="2.5"',
    'd-servo-alas': 'fill="#3b4c63" stroke="#111" stroke-width="2"',
    'd-cuerno': 'fill="#f6f9fd" stroke="#111" stroke-width="2.5"',
    'd-recuadro': 'fill="#ffffff" stroke="#cfd8e3" stroke-width="2"',
    'd-punta': 'fill="#1b2c41"',
    'b-base': 'fill="#e4eefc" stroke="#1b2c41" stroke-width="3"',
    'b-base-lado': 'fill="#c9d8ec" stroke="#1b2c41" stroke-width="3"',
    'b-tornamesa': 'fill="#f6f9fd" stroke="#1b2c41" stroke-width="2.5"',
    'b-pieza': 'fill="#f6f9fd" stroke="#1b2c41" stroke-width="3" stroke-linejoin="round"',
    'b-servo': 'fill="#2b3a4f" stroke="#111" stroke-width="2.5"',
    'b-barra-borde': 'stroke="#1b2c41" stroke-width="24" stroke-linecap="round" fill="none"',
    'b-barra': 'stroke="#f6f9fd" stroke-width="17" stroke-linecap="round" fill="none"',
    'b-varilla': 'stroke="#1b2c41" stroke-width="5" stroke-linecap="round" fill="none"',
    'b-garra': 'stroke="#111" stroke-width="8" stroke-linecap="round" fill="none"',
    'b-eje': 'fill="#ffe500" stroke="#111" stroke-width="3"',
    'b-mov': 'stroke="#1f5fc8" stroke-width="5" fill="none" stroke-linecap="round"',
    'b-punta': 'fill="#1f5fc8"',
    'b-guia': 'stroke="#52637a" stroke-width="2.5" stroke-dasharray="5 5" fill="none"',
}


def con_atributos(svg):
    def poner(m):
        clase = m.group(1)
        if clase not in ESTILOS:
            raise SystemExit('Falta el estilo de la clase ' + clase)
        return f'class="{clase}" {ESTILOS[clase]}'.rstrip()
    return re.sub(r'class="([^"]+)"', poner, svg)


def insertar(nombre, svg):
    svg = con_atributos(svg)
    p = RAIZ / 'index.html'
    html = p.read_text(encoding='utf-8')
    patron = re.compile(rf'(<!-- diagrama:{nombre} -->)(.*?)(<!-- /diagrama:{nombre} -->)', re.S)
    assert patron.search(html), nombre
    html = patron.sub(lambda m: m.group(1) + '\n' + svg + '\n' + m.group(3), html)
    p.write_text(html, encoding='utf-8')


if __name__ == '__main__':
    insertar('conexiones', conexiones())
    insertar('brazo', brazo())
    print('diagramas insertados')
