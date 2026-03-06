#!/usr/bin/env bash
# deploy.sh - Tao PR va deploy len Render
# Usage: RENDER_API_KEY=xxx RENDER_SERVICE_ID=srv-xxx ./scripts/deploy.sh

set -euo pipefail

BRANCH="claude/vehicle-tracking-zalo-ocr-3ERhn"
BASE="main"
RENDER_API_KEY="${RENDER_API_KEY:?Thieu RENDER_API_KEY}"
RENDER_SERVICE_ID="${RENDER_SERVICE_ID:?Thieu RENDER_SERVICE_ID}"

echo "==> Tao Pull Request..."
PR_URL=$(gh pr create \
  --base "$BASE" \
  --head "$BRANCH" \
  --title "feat: integrate Excel accounting report with 4-category ton kho management" \
  --body "## Thay doi chinh

- Ke toan gui file Excel (.xlsx) tu Cyber len Telegram bot
- Bot tu dong phan tich va tao bao cao tong hop

### 4 nhom phan loai
- **[NGAY]** Xe vao hom nay + len lenh hom nay (chuyen doi trong ngay)
- **[TRE]**  Xe vao ngay truoc + hom nay moi len lenh (ton kho da xu ly)
- **[CHO]**  Xe vao hom nay + chua len lenh (dang cho tiep nhan)
- **[TON]**  Xe vao ngay truoc + van chua len lenh (ton kho lau)

Moi nhom con phan theo trang thai thanh toan: da ra/con xuong x da TT/chua TT." \
  2>&1)

echo "PR: $PR_URL"

echo ""
echo "==> Merge PR vao main..."
gh pr merge --squash --auto "$PR_URL" 2>/dev/null || \
  gh pr merge --squash "$PR_URL"

echo ""
echo "==> Trigger deploy tren Render..."
DEPLOY_RESPONSE=$(curl -sf -X POST \
  "https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys" \
  -H "Authorization: Bearer ${RENDER_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"clearCache": false}')

DEPLOY_ID=$(echo "$DEPLOY_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['deploy']['id'])" 2>/dev/null || echo "unknown")
echo "Deploy ID: $DEPLOY_ID"

echo ""
echo "==> Kiem tra trang thai deploy (doi toi da 5 phut)..."
for i in $(seq 1 30); do
  STATUS=$(curl -sf \
    "https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys/${DEPLOY_ID}" \
    -H "Authorization: Bearer ${RENDER_API_KEY}" | \
    python3 -c "import sys,json; print(json.load(sys.stdin)['deploy']['status'])" 2>/dev/null || echo "unknown")

  echo "  [$i/30] Status: $STATUS"

  if [[ "$STATUS" == "live" ]]; then
    echo ""
    echo "Deploy thanh cong!"
    exit 0
  elif [[ "$STATUS" == "deactivated" || "$STATUS" == "build_failed" ]]; then
    echo ""
    echo "Deploy that bai (status: $STATUS). Kiem tra Render dashboard."
    exit 1
  fi

  sleep 10
done

echo "Timeout sau 5 phut. Kiem tra Render dashboard de xem trang thai."
