"""Genera manos sinteticas y el conteo que da la funcion contar_dedos
ORIGINAL de tecnico/deteccion_dedos.py, extraida del archivo sin
importar cv2 ni mediapipe. La prueba paridad.test.js compara la
version JavaScript contra estos resultados.

Uso: python3 pruebas/generar_paridad.py <ruta a deteccion_dedos.py>
"""
import ast, json, random, sys
from types import SimpleNamespace

fuente = open(sys.argv[1], encoding="utf-8").read()
arbol = ast.parse(fuente)
queremos = {"MARGEN_PULGAR", "MUNECA", "PUNTAS", "NUDILLOS", "PULGAR_PUNTA",
            "PULGAR_NUDILLO", "BASE_MENIQUE", "NUDILLO_MEDIO", "_distancia", "contar_dedos"}
nodos = []
for n in arbol.body:
    if isinstance(n, ast.Assign) and any(getattr(t, "id", None) in queremos for t in n.targets):
        nodos.append(n)
    if isinstance(n, ast.FunctionDef) and n.name in queremos:
        nodos.append(n)
espacio = {}
exec(compile(ast.Module(body=nodos, type_ignores=[]), "deteccion_dedos.py", "exec"), espacio)
contar = espacio["contar_dedos"]

random.seed(13)
# Una mano "base" abierta, en coordenadas normalizadas de MediaPipe.
base = [(0.50, 0.85), (0.42, 0.78), (0.36, 0.70), (0.31, 0.63), (0.27, 0.57),
        (0.43, 0.55), (0.42, 0.45), (0.42, 0.38), (0.42, 0.32),
        (0.50, 0.53), (0.50, 0.42), (0.50, 0.34), (0.50, 0.27),
        (0.57, 0.55), (0.58, 0.45), (0.58, 0.38), (0.58, 0.32),
        (0.63, 0.59), (0.65, 0.51), (0.66, 0.46), (0.67, 0.41)]
casos = []
for k in range(12000):
    if k % 2 == 0:
        # Puntos al azar: prueba la aritmetica pura.
        puntos = [(random.random(), random.random()) for _ in range(21)]
    else:
        # La mano base con dedos doblados al azar y ruido: cae cerca de
        # los umbrales, que es donde una traduccion mal hecha se nota.
        ruido = random.uniform(0.0, 0.06)
        puntos = []
        doblar = {d: random.random() < 0.5 for d in range(5)}
        muneca = base[0]
        for i, (x, y) in enumerate(base):
            dedo = 0 if 1 <= i <= 4 else (i - 1) // 4 if i else None
            if i and doblar.get(dedo) and i % 4 in (0, 3):
                x = muneca[0] + (x - muneca[0]) * random.uniform(0.3, 0.9)
                y = muneca[1] + (y - muneca[1]) * random.uniform(0.3, 0.9)
            puntos.append((x + random.gauss(0, ruido), y + random.gauss(0, ruido)))
    puntos = [(round(x, 5), round(y, 5)) for x, y in puntos]
    objetos = [SimpleNamespace(x=x, y=y, z=0.0) for x, y in puntos]
    casos.append({"puntos": [[x, y] for x, y in puntos], "dedos": contar(objetos)})

json.dump({"margen": espacio["MARGEN_PULGAR"], "casos": casos}, open("pruebas/datos/paridad.json", "w"), separators=(",", ":"))
conteo = [0] * 6
for c in casos:
    conteo[c["dedos"]] += 1
print("casos por conteo 0..5:", conteo)
