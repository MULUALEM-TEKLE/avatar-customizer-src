#!/usr/bin/env bash
# Frames -> launch.mp4 (16:9) and launch-9x16.mp4 (centre crop), with the track or silence.
#   scripts/launch-video/assemble.sh [frames dir] [out dir]
set -euo pipefail
FRAMES="${1:-_/launch/frames}"
OUT="${2:-_/launch}"
FPS=30
N=$(ls "$FRAMES"/frame-*.png | wc -l | tr -d ' ')
DUR=$(echo "scale=4; $N / $FPS" | bc)

if [ -f "$OUT/track.wav" ]; then
	AUDIO=(-i "$OUT/track.wav")
	echo "audio: $OUT/track.wav"
else
	AUDIO=(-f lavfi -t "$DUR" -i anullsrc=r=48000:cl=stereo)
	echo "audio: silence ($DUR s); re-run when $OUT/track.wav lands"
fi

GRADE="noise=alls=6:allf=t+u,vignette=PI/5,format=yuv420p"
ENC=(-c:v libx264 -preset slow -crf 18 -r $FPS -c:a aac -b:a 256k -movflags +faststart -shortest)
AF="loudnorm=I=-14:TP=-1:LRA=11,aresample=48000"

ffmpeg -v error -y -framerate $FPS -i "$FRAMES/frame-%06d.png" "${AUDIO[@]}" \
	-filter_complex "[0:v]$GRADE[v];[1:a]$AF[a]" -map "[v]" -map "[a]" "${ENC[@]}" "$OUT/launch.mp4"
ffmpeg -v error -y -framerate $FPS -i "$FRAMES/frame-%06d.png" "${AUDIO[@]}" \
	-filter_complex "[0:v]crop=ih*9/16:ih,scale=1080:1920:flags=lanczos,$GRADE[v];[1:a]$AF[a]" -map "[v]" -map "[a]" "${ENC[@]}" "$OUT/launch-9x16.mp4"

for f in "$OUT/launch.mp4" "$OUT/launch-9x16.mp4"; do
	echo "$f: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f") s, $(ffprobe -v error -select_streams v -show_entries stream=width,height,nb_frames -of csv=p=0 "$f")"
done
