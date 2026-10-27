#!/bin/bash
# Convierte un video en cuadros JPG numerados, 10 por segundo, para la
# comparacion de punta a punta. Uso: pruebas/video_preparar.sh video.mov
set -e
DESTINO="$(dirname "$0")/datos/video"
rm -rf "$DESTINO" && mkdir -p "$DESTINO"
ffmpeg -loglevel error -i "$1" -vf "fps=10,scale='min(1280,iw)':-2" -q:v 2 "$DESTINO/%04d.jpg"
ls "$DESTINO" | wc -l
