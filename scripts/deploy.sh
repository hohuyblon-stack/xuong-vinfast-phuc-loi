#!/usr/bin/env bash
# deploy.sh — End-to-end Supabase migration + Render deploy
# Usage: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... bash scripts/deploy.sh
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
step() { echo -e "\n${CYAN}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
die()  { echo -e "${RED}✗ $1${NC}"; exit 1; }

cd "$(dirname "$0")/.."

# ── Step 0: check required env vars ──────────────────────────────────────────
step "Checking required env vars"

[[ -z "${SUPABASE_URL:-}"         ]] && die "SUPABASE_URL is not set"
[[ -z "${SUPABASE_SERVICE_KEY:-}" ]] && die "SUPABASE_SERVICE_KEY is not set"
[[ -z "${TELEGRAM_BOT_TOKEN:-}"   ]] && die "TELEGRAM_BOT_TOKEN is not set"
[[ -z "${GOOGLE_SHEET_ID:-}"      ]] && die "GOOGLE_SHEET_ID is not set"
[[ -z "${GOOGLE_CREDENTIALS_JSON:-}" ]] && die "GOOGLE_CREDENTIALS_JSON is not set"
ok "All required env vars present"

# ── Step 1: run tests ─────────────────────────────────────────────────────────
step "Running test suite"
node --test 'test/**/*.test.js' && ok "All tests pass" || die "Tests failed — aborting"

# ── Step 2: migrate existing Sheets data → Supabase ──────────────────────────
step "Migrating Google Sheets data → Supabase"
node scripts/migrate-sheets-to-supabase.js
ok "Migration complete"

# ── Step 3: diagnose phantom RA records (report only) ────────────────────────
step "Diagnosing phantom RA records"
node scripts/diagnose-phantom-ra.js || warn "Diagnostic check failed — inspect manually"

# ── Step 4: commit and push ───────────────────────────────────────────────────
step "Committing and pushing (triggers Render auto-deploy)"

git add -A
git commit -m "feat: migrate from Google Sheets to Supabase as source of truth

- Add Supabase (PostgreSQL) as transactional database
- Eliminate VAO/RA race condition via SELECT FOR UPDATE in process_vehicle RPC
- Keep Google Sheets as async read-only mirror (sheets-sync.js)
- Remove in-process Promise mutex — DB serializes at row level
- O(1) idempotency check via UNIQUE index on message_key
- Add migration and diagnostic scripts
- 61 tests passing"

git push origin HEAD
ok "Pushed — Render auto-deploys from GitHub"

echo ""
echo -e "${GREEN}All done!${NC}"
echo "  Watch deploy:  https://dashboard.render.com"
echo ""
echo "  After the new version is live, flag old phantom records:"
echo "    node scripts/diagnose-phantom-ra.js --fix"
