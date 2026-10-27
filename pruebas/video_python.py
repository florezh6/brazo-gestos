"""Lado Python de la comparacion de punta a punta con un video real.

Procesa los cuadros de pruebas/datos/video/ (JPG numerados, los arma
pruebas/video_preparar.sh) igual que tecnico/deteccion_dedos.py:
voltea en espejo, detecta en modo VIDEO con las mismas opciones y
cuenta con la funcion contar_dedos ORIGINAL, extraida del archivo sin
modificarla.

Uso: <python con mediapipe 1.0.0> pruebas/video_python.py <deteccion_dedos.py> <hand_landmarker.task>
Escribe pruebas/datos/video/python.json
"""
import ast, glob, json, sys, os
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

fuente = open(sys.argv[1], encoding="utf-8").read()
queremos = {"MARGEN_PULGAR", "MUNECA", "PUNTAS", "NUDILLOS", "PULGAR_PUNTA",
            "PULGAR_NUDILLO", "BASE_MENIQUE", "NUDILLO_MEDIO", "_distancia", "contar_dedos"}
nodos = [n for n in ast.parse(fuente).body
         if (isinstance(n, ast.Assign) and any(getattr(t, "id", None) in queremos for t in n.targets))
         or (isinstance(n, ast.FunctionDef) and n.name in queremos)]
espacio = {}
exec(compile(ast.Module(body=nodos, type_ignores=[]), "deteccion_dedos.py", "exec"), espacio)
contar = espacio["contar_dedos"]

opciones = vision.HandLandmarkerOptions(
    base_options=mp_python.BaseOptions(model_asset_path=sys.argv[2]),
    running_mode=vision.RunningMode.VIDEO,
    num_hands=2,
    min_hand_detection_confidence=0.7,
    min_tracking_confidence=0.5,
)
detector = vision.HandLandmarker.create_from_options(opciones)

carpeta = os.path.join(os.path.dirname(__file__), "datos", "video")
archivos = sorted(glob.glob(os.path.join(carpeta, "*.jpg")))
lecturas = []
for i, archivo in enumerate(archivos):
    cuadro = cv2.flip(cv2.imread(archivo), 1)   # efecto espejo, como el taller
    imagen = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(cuadro, cv2.COLOR_BGR2RGB))
    manos = detector.detect_for_video(imagen, i * 100).hand_landmarks
    if len(manos) >= 2:
        lecturas.append("PAUSA")
    elif len(manos) == 1:
        lecturas.append(contar(manos[0]))
    else:
        lecturas.append(None)

json.dump(lecturas, open(os.path.join(carpeta, "python.json"), "w"))
print(len(lecturas), "cuadros procesados")
