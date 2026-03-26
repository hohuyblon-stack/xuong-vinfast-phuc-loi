#!/usr/bin/env bash
# ============================================================
# Setup OpenClaw Risk Manager — Xưởng VinFast Phúc Lợi
# ============================================================
# Chạy 1 lần: bash scripts/setup-openclaw.sh
# Yêu cầu: Node 22+, .env file với TELEGRAM_BOT_TOKEN, SUPABASE_URL, etc.
# ============================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE="$HOME/.openclaw/workspace"
CONFIG_FILE="$HOME/.openclaw/openclaw.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1" >&2; exit 1; }

# -----------------------------------------------------------
# 0. Load .env
# -----------------------------------------------------------
if [ -f "$REPO_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_DIR/.env"
  set +a
  log "Loaded .env"
else
  err ".env file not found at $REPO_DIR/.env — copy from .env.template first"
fi

# Validate required vars
[ -z "${TELEGRAM_BOT_TOKEN:-}" ]   && err "TELEGRAM_BOT_TOKEN not set in .env"
[ -z "${SUPABASE_URL:-}" ]         && err "SUPABASE_URL not set in .env"
[ -z "${SUPABASE_SERVICE_KEY:-}" ] && err "SUPABASE_SERVICE_KEY not set in .env"
[ -z "${MANAGER_CHAT_IDS:-}" ]     && warn "MANAGER_CHAT_IDS not set — bot won't know who to alert"

# -----------------------------------------------------------
# 1. Xóa folder openclaw/ cũ (cron job tự viết)
# -----------------------------------------------------------
if [ -d "$REPO_DIR/openclaw" ]; then
  rm -rf "$REPO_DIR/openclaw"
  log "Đã xóa folder openclaw/ cũ (cron job tự viết)"
fi

# -----------------------------------------------------------
# 2. Cài OpenClaw
# -----------------------------------------------------------
if command -v openclaw &>/dev/null; then
  log "OpenClaw đã cài ($(openclaw --version 2>/dev/null || echo 'unknown'))"
else
  echo "Đang cài OpenClaw..."
  npm install -g openclaw@latest
  log "Cài OpenClaw thành công"
fi

# -----------------------------------------------------------
# 3. Tạo workspace directory
# -----------------------------------------------------------
mkdir -p "$WORKSPACE"
mkdir -p "$WORKSPACE/memory"
log "Workspace: $WORKSPACE"

# -----------------------------------------------------------
# 4. SOUL.md — Agent identity & system prompt
# -----------------------------------------------------------
cat > "$WORKSPACE/SOUL.md" << 'SOUL_EOF'
# Risk Manager — Xưởng VinFast Phúc Lợi

Mày là kỹ sư trực (on-call engineer) cho hệ thống tracking xe vào/ra xưởng VinFast Phúc Lợi (55 Phúc Lợi, Long Biên, Hà Nội).

Mày TỰ XỬ LÝ mọi vấn đề kỹ thuật. Chỉ escalate cho Huy khi cần ra quyết định kinh doanh hoặc khi mày đã thử fix 2 lần mà không được.

## Hệ thống mày đang trực

```
Telegram Bot → Express.js (Render.com) → Google Vision OCR → Supabase PostgreSQL
                                                            → Google Sheets (mirror)
```

- Server: Node.js + Express, deploy trên Render.com
- DB: Supabase PostgreSQL — 3 bảng: `vehicles`, `events`, `reviews`
- OCR: Google Cloud Vision API (free tier 1,000 req/tháng)
- Sheets: async mirror, KHÔNG critical — Supabase là source of truth
- Source code: nằm trong repo, mày có quyền đọc và sửa

## Mày tự xử lý (KHÔNG hỏi ai)

**Server/Deploy:**
- Build fail → đọc error, fix code, commit, redeploy
- Server crash → check logs, tìm root cause, fix, deploy lại
- Render spin-down (free tier) → expected, không phải bug
- Env var thiếu → check `.env.template`, so sánh với Render config

**Database:**
- Query chậm → analyze, thêm index nếu cần
- Orphan records (xe IN > 7 ngày) → chạy diagnose script, clean up stale data
- Duplicate events → tìm root cause, fix code, deduplicate
- Supabase paused (free tier 7 ngày inactive) → unpause

**OCR:**
- Confidence drop → check ảnh gần nhất trong `reviews` table, xác định: ảnh mờ hay API lỗi
- API errors tăng → check quota, check Google Cloud logs
- Biển số format lạ → update regex trong `utils.js` nếu cần

**Code:**
- Test fail → fix, không skip
- Logic sai trong `matcher.js` (false VAO/RA) → trace flow, fix, thêm test case
- Security issue → fix ngay

**Google Sheets:**
- Sync fail → check credentials, quota, fix `sheets-sync.js`
- Data mismatch → trigger re-sync

## Escalate cho Huy (cần quyết định)

- **Chi tiền:** upgrade Render, enable Google billing, upgrade Supabase
- **Thay đổi business logic:** MIN_WORKSHOP_MINUTES, alert thresholds, thêm/bớt feature
- **Data khách hàng thật:** xóa/sửa vehicle records không phải orphan
- **Deploy lần đầu:** chưa từng deploy → Huy confirm trước
- **Schema change không revert được:** drop column, migration lớn
- **Fix 2 lần vẫn fail:** dừng, báo Huy

Format khi escalate:
```
🔔 CẦN QUYẾT ĐỊNH
Vấn đề: [ngắn gọn]
Đã thử: [liệt kê]
Đề xuất: [2-3 options]
Cần Huy: [chọn gì]
```

## Nguyên tắc

- Fix trước, báo sau. Biết fix → fix luôn, commit, rồi nói đã fix.
- Không over-engineer. Fix đúng bug, không refactor lung tung.
- `npm test` trước mọi commit.
- Giờ xưởng: 7:00-18:00. Event gap ngoài giờ = bình thường.
- Sheets lag = low priority. Supabase mới là quan trọng.
- Không xóa data production trừ khi chắc chắn stale và đã verify.
SOUL_EOF
log "Tạo SOUL.md"

# -----------------------------------------------------------
# 5. HEARTBEAT.md — Periodic monitoring checklist
# -----------------------------------------------------------
cat > "$WORKSPACE/HEARTBEAT.md" << 'HEARTBEAT_EOF'
# Heartbeat — Xưởng VinFast Phúc Lợi

Khi heartbeat chạy, kiểm tra theo thứ tự:

1. **Server** — GET `/health` endpoint, verify response OK
2. **Database** — test Supabase connection, đếm vehicles đang IN, đếm pending reviews
3. **OCR** — success rate 24h gần nhất từ `reviews` table
4. **Data anomalies** — orphan vehicles (IN > 7 ngày), phantom RA events, event gaps trong giờ làm việc (7:00-18:00)

Nếu tất cả OK → trả về HEARTBEAT_OK
Nếu có vấn đề → mô tả ngắn gọn vấn đề và mức độ (INFO/WARNING/CRITICAL)
HEARTBEAT_EOF
log "Tạo HEARTBEAT.md"

# -----------------------------------------------------------
# 6. TOOLS.md — Credentials & access config
# -----------------------------------------------------------
# Lấy server URL từ env
SERVER_URL="${OPENCLAW_SERVER_URL:-${TELEGRAM_WEBHOOK_URL:-http://localhost:3000}}"

cat > "$WORKSPACE/TOOLS.md" << TOOLS_EOF
# Tools — Xưởng VinFast Phúc Lợi

## Health Check
- Endpoint: \`${SERVER_URL}/health\`
- Method: GET
- Expected: HTTP 200 with JSON \`{"status":"ok"}\`

## Supabase (READ-ONLY)
- URL: \`${SUPABASE_URL}\`
- Service Key: \`${SUPABASE_SERVICE_KEY}\`
- Chỉ dùng SELECT queries. KHÔNG INSERT/UPDATE/DELETE trừ khi cleanup orphan records.
- Tables: \`vehicles\`, \`events\`, \`reviews\`

## Source Code
- Repo path: \`${REPO_DIR}\`
- Mày có quyền đọc toàn bộ source code trong repo
- Khi cần fix code: đọc file → sửa → chạy \`npm test\` → commit

## Telegram Alert
- Bot Token: đã config trong Gateway
- Manager Chat IDs: ${MANAGER_CHAT_IDS:-"(chưa set)"}

## Key Files
- \`src/index.js\` — Express server entry
- \`src/matcher.js\` — Vehicle IN/OUT matching logic
- \`src/utils.js\` — License plate regex, helpers
- \`src/sheets-sync.js\` — Google Sheets mirror
- \`.env.template\` — All environment variables documented
TOOLS_EOF
log "Tạo TOOLS.md"

# -----------------------------------------------------------
# 7. openclaw.json — Gateway config with Telegram
# -----------------------------------------------------------
# Parse MANAGER_CHAT_IDS into JSON array
IFS=',' read -ra CHAT_IDS_ARR <<< "${MANAGER_CHAT_IDS:-}"
ALLOW_FROM_JSON="["
first=true
for id in "${CHAT_IDS_ARR[@]+"${CHAT_IDS_ARR[@]}"}"; do
  id="$(echo "$id" | xargs)"  # trim
  [ -z "$id" ] && continue
  if [ "$first" = true ]; then
    ALLOW_FROM_JSON+="\"$id\""
    first=false
  else
    ALLOW_FROM_JSON+=",\"$id\""
  fi
done
ALLOW_FROM_JSON+="]"

# Only write config if it doesn't exist (don't overwrite user customizations)
if [ ! -f "$CONFIG_FILE" ]; then
  mkdir -p "$(dirname "$CONFIG_FILE")"
  cat > "$CONFIG_FILE" << CONFIG_EOF
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "${TELEGRAM_BOT_TOKEN}",
      "dmPolicy": "allowlist",
      "allowFrom": ${ALLOW_FROM_JSON},
      "groups": {
        "*": {
          "requireMention": true
        }
      }
    }
  },
  "agents": {
    "defaults": {
      "workspace": "${WORKSPACE}",
      "heartbeat": {
        "every": "30m",
        "isolatedSession": true,
        "lightContext": true,
        "activeHours": {
          "start": "06:00",
          "end": "22:00",
          "tz": "Asia/Ho_Chi_Minh"
        }
      }
    }
  },
  "cron": {
    "enabled": true,
    "sessionRetention": "24h"
  }
}
CONFIG_EOF
  log "Tạo openclaw.json"
else
  warn "openclaw.json đã tồn tại — không ghi đè. Kiểm tra config thủ công."
fi

# -----------------------------------------------------------
# 8. Tạo Cron Jobs
# -----------------------------------------------------------
echo ""
echo "Đang tạo cron jobs..."

# Helper: tạo cron job nếu chưa tồn tại
add_cron() {
  local name="$1"
  local cron_expr="$2"
  local message="$3"

  # Check if job already exists
  if openclaw cron list 2>/dev/null | grep -q "$name"; then
    warn "Cron '$name' đã tồn tại — skip"
    return
  fi

  openclaw cron add \
    --name "$name" \
    --cron "$cron_expr" \
    --tz "Asia/Ho_Chi_Minh" \
    --session isolated \
    --message "$message" \
    --announce \
    --channel telegram

  log "Cron: $name ($cron_expr)"
}

# Server health check — mỗi 5 phút
add_cron "server-check" "*/5 * * * *" \
  "Kiểm tra server: GET /health endpoint. Nếu fail, check Render logs và báo cáo. Nếu OK, trả HEARTBEAT_OK."

# Database check — mỗi 15 phút
add_cron "db-check" "*/15 * * * *" \
  "Kiểm tra Supabase: test connection, đếm vehicles đang IN, đếm pending reviews. Báo cáo nếu có anomaly."

# OCR check — mỗi giờ
add_cron "ocr-check" "0 * * * *" \
  "Kiểm tra OCR: tính success rate 24h từ reviews table. Nếu dưới 80%, báo WARNING với chi tiết."

# Data anomalies — mỗi 4 giờ
add_cron "data-anomalies" "0 */4 * * *" \
  "Kiểm tra data anomalies: orphan vehicles (IN > 7 ngày), phantom RA events, event gaps trong giờ làm việc 7:00-18:00. Báo cáo chi tiết nếu có."

# Daily report — 20:00 hàng ngày
add_cron "daily-report" "0 20 * * *" \
  "Tạo báo cáo ngày: tổng xe vào/ra, xe đang trong xưởng, OCR stats, issues phát hiện hôm nay. Gửi qua Telegram."

# -----------------------------------------------------------
# 9. Done
# -----------------------------------------------------------
echo ""
echo "=========================================="
echo -e "${GREEN} OpenClaw Risk Manager — Setup Done!${NC}"
echo "=========================================="
echo ""
echo "Workspace:  $WORKSPACE"
echo "Config:     $CONFIG_FILE"
echo ""
echo "Next steps:"
echo "  1. Chạy:  openclaw gateway --verbose"
echo "  2. Test:  openclaw doctor"
echo "  3. Cron:  openclaw cron list"
echo "  4. Logs:  openclaw cron runs --id <jobId>"
echo ""
echo "Để chạy daemon (background):"
echo "  openclaw onboard --install-daemon"
echo ""
