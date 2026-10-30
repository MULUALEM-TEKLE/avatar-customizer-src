#!/usr/bin/env bash
# Frames -> launch-v2.mp4 (16:9, 2.39:1 letterbox) and launch-v2-9x16.mp4 (centre crop, no bars), 60 fps, with the track or silence.
#   scripts/launch-video/assemble.sh [frames dir] [out dir] [name] [letterbox from frame]
# v3: assemble.sh _/launch/v3/frames _/launch/v3 character-customizer-v3 697 (the entrance before bar 6 keeps the full frame)
set -euo pipefail
FRAMES="${1:-_/launch/v2/frames}"
OUT="${2:-_/launch/v2}"
NAME="${3:-launch-v2}"
LB_FROM="${4:-0}"
FPS=60
BARS=138 # (1080 - 1920 / 2.39) / 2
N=$(ls "$FRAMES"/frame-*.png | wc -l | tr -d ' ')
DUR=$(echo "scale=4; $N / $FPS" | bc)

if [ -f "$OUT/track.wav" ]; then
	AUDIO=(-i "$OUT/track.wav")
	echo "audio: $OUT/track.wav"
else
	AUDIO=(-f lavfi -t "$DUR" -i anullsrc=r=48000:cl=stereo)
	echo "audio: silence ($DUR s); re-run when $OUT/track.wav lands"
fi

GRADE="noise=alls=5:allf=t+u,vignette=PI/5"
LETTERBOX="drawbox=x=0:y=0:w=iw:h=$BARS:color=black:t=fill:enable='gte(n,$LB_FROM)',drawbox=x=0:y=ih-$BARS:w=iw:h=$BARS:color=black:t=fill:enable='gte(n,$LB_FROM)'"
ENC=(-c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -r $FPS -c:a aac -b:a 256k -movflags +faststart -shortest)
AF="loudnorm=I=-14:TP=-1:LRA=11,aresample=48000"

ffmpeg -v error -y -framerate $FPS -i "$FRAMES/frame-%06d.png" "${AUDIO[@]}" \
	-filter_complex "[0:v]$GRADE,$LETTERBOX[v];[1:a]$AF[a]" -map "[v]" -map "[a]" "${ENC[@]}" "$OUT/$NAME.mp4"
ffmpeg -v error -y -framerate $FPS -i "$FRAMES/frame-%06d.png" "${AUDIO[@]}" \
	-filter_complex "[0:v]crop=ih*9/16:ih,scale=1080:1920:flags=lanczos,$GRADE[v];[1:a]$AF[a]" -map "[v]" -map "[a]" "${ENC[@]}" "$OUT/$NAME-9x16.mp4"

for f in "$OUT/$NAME.mp4" "$OUT/$NAME-9x16.mp4"; do
	echo "$f: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f") s, $(ffprobe -v error -select_streams v -show_entries stream=width,height,r_frame_rate,nb_frames -of csv=p=0 "$f")"
done
