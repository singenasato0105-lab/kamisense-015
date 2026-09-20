#!/usr/bin/env bash
# 神センス0.15 デプロイスクリプト
# 使い方: ./deploy.sh "コミットメッセージ"
#   1) git commit & push（SSHデプロイキー使用）
#   2) .render_deploy_hook があれば curl で Render 手動デプロイをトリガー
#      （無い場合は Render の Auto-Deploy が push を拾う想定）
set -euo pipefail
cd "$(dirname "$0")"

MSG="${1:-deploy: $(date '+%Y-%m-%d %H:%M')}"

if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "$MSG"
  echo "committed: $MSG"
else
  echo "no changes to commit（push のみ実行）"
fi

GIT_SSH_COMMAND="ssh -i $HOME/.ssh/kamisense_deploy -o IdentitiesOnly=yes" git push origin main
echo "pushed to GitHub."

HOOK_FILE=".render_deploy_hook"
if [ -f "$HOOK_FILE" ]; then
  HOOK="$(tr -d '[:space:]' < "$HOOK_FILE")"
  if [ -n "$HOOK" ]; then
    echo "triggering Render deploy hook..."
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HOOK")
    echo "deploy hook HTTP $code"
  fi
else
  echo "deploy hook 未設定（.render_deploy_hook なし）。Render Auto-Deploy に委ねます。"
fi
