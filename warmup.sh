#!/bin/bash
# 神センス0.15 当日ウォームアップ：Render無料枠のスリープを起こし、開始まで温めておく。
# 使い方: bash warmup.sh            … 1回だけ起こす（初回は50秒ほどかかる）
#         bash warmup.sh keep       … 開始まで10分ごとに叩き続けて起きたままにする（Ctrl+Cで停止）
URL="https://kamisense-015.onrender.com/healthz"
ping_once(){ printf "%s  " "$(date +%H:%M:%S)"; curl -s -m 60 "$URL" || echo "（無応答）"; echo; }
echo "▶ ウォームアップ開始: $URL"
ping_once
if [ "$1" = "keep" ]; then
  echo "▶ keepモード：10分ごとに起こし続けます（Ctrl+Cで停止）"
  while true; do sleep 600; ping_once; done
fi
