#!/usr/bin/env bash
# ============================================================
#  会場BGM/ファンファーレ 抽出スクリプト（神センス0.15チャレンジ）
#  YouTube等の音源から、必要な区間を切り出して bgm/<会場>/<cue>.mp3 を作る。
#
#  ※実行は権利保有者（イベント主催側）が行ってください。
#    ファンファーレ・場内BGMは各競走場・ボートレース振興会等の権利物です。
#
#  必要ツール: python3 -m yt_dlp（導入済）, ffmpeg
#  使い方:
#    1) 下の JOBS に「会場|cue|URL|開始|長さ」を記入（開始=hh:mm:ss、長さ=秒）
#    2) このフォルダで:  bash fetch_bgm.sh
#    3) 出力先（投影/screen がこの名前で鳴らします）:
#         parade（会場別）… bgm/<会場>/parade.mp3
#         共通cue        … bgm/common/<cue>.mp3   （fanfare / result / close / race）
#
#  メモ:
#   ・ファンファーレは全国共通（会場別ではない）→ cue=fanfare で1本入れれば3会場共通
#   ・走行音(race)は共通のエンジン音。入れなければ内蔵の合成音が鳴ります
#   ・場内BGM(parade)だけが会場ごとに違う＝ここを各会場の公式ライブ映像から
#   ・parade は venue=naruto|kojima|marugame を指定。共通cueは venue=common を指定
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"                      # bgm/ ディレクトリ
FFMPEG="${FFMPEG:-$(command -v ffmpeg || echo /Users/symba/bin/ffmpeg)}"
YTDLP=(python3 -m yt_dlp)

# ---- ここを埋める（# を外して開始・長さを指定）----
# 形式:  "会場|cue|URL|開始(hh:mm:ss)|長さ(秒)"
#   会場 = naruto | kojima | marugame
#   cue  = parade | close | fanfare | race | result
JOBS=(
  # 例）共通cue（venue=common）— ファンファーレ/結果/締切/走行音。1本ずつでOK
  # "common|fanfare|https://www.youtube.com/watch?v=uX7hi8aKiMI|00:00:00|8"
  # "common|result|<URL>|00:00:00|10"
  # "common|close|<URL>|00:00:00|4"
  # "common|race|<URL>|00:00:00|20"

  # 例）会場BGM（周回展示中に流れるご当地BGM）— 各会場公式ライブから約60秒
  # "naruto|parade|https://www.youtube.com/watch?v=L4p9pl1eEW4|00:03:00|60"
  # "kojima|parade|<児島のライブURL>|00:03:00|60"
  # "marugame|parade|<丸亀のライブURL>|00:03:00|60"
)

if [ ${#JOBS[@]} -eq 0 ]; then
  echo "JOBS が空です。スクリプト内の JOBS に『会場|cue|URL|開始|長さ』を記入して再実行してください。"
  echo "（# を外して、開始時刻と長さを実際の位置に合わせるだけ）"
  exit 0
fi

tmpdir="$(mktemp -d)"; trap 'rm -rf "$tmpdir"' EXIT
for job in "${JOBS[@]}"; do
  IFS='|' read -r venue cue url start dur <<< "$job"
  [ -z "${venue:-}" ] && continue
  mkdir -p "./$venue"
  out="./$venue/$cue.mp3"
  echo "▶ $venue/$cue  ← $url  [$start +${dur}s]"
  src="$tmpdir/${venue}_${cue}.m4a"
  # 音声だけ取得（最良の音声フォーマット）
  "${YTDLP[@]}" -q -f bestaudio -x --audio-format m4a -o "$src" "$url"
  # 指定区間を切り出し＋ラウドネス正規化 → mp3
  "$FFMPEG" -y -loglevel error -ss "$start" -t "$dur" -i "$src" \
    -af "loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.15,afade=t=out:st=$(python3 -c "print(max(0,$dur-0.3))"):d=0.3" \
    -codec:a libmp3lame -q:a 3 "$out"
  echo "   ✅ $out"
done
echo "完了。bgm/<会場>/ に mp3 が生成されました。投影(/screen)を再読込すると反映されます。"
