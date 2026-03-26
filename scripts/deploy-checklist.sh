#!/bin/bash
#
# ═══════════════════════════════════════════════════════════════════════════════
# Xuong VinFast Phuc Loi Bot — Pre-Deployment Checklist
# ═══════════════════════════════════════════════════════════════════════════════
#
# PURPOSE:
# Validates all environment variables and external services are configured
# correctly before deployment. Helps catch configuration issues early.
#
# USAGE:
#   ./scripts/deploy-checklist.sh          (check local .env)
#   ./scripts/deploy-checklist.sh prod     (check production setup)
#
# EXIT CODES:
#   0 = All checks passed, ready to deploy
#   1 = One or more checks failed, see errors above
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# ─────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────────────────

print_header() {
  echo -e "\n${BLUE}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"
}

check_pass() {
  echo -e "${GREEN}✓${NC} $1"
  ((PASSED++))
}

check_fail() {
  echo -e "${RED}✗${NC} $1"
  ((FAILED++))
}

check_warn() {
  echo -e "${YELLOW}⚠${NC} $1"
  ((WARNINGS++))
}

check_env_var() {
  local var_name=$1
  local var_value="${!var_name:-}"

  if [ -z "$var_value" ]; then
    check_fail "Missing environment variable: \$${var_name}"
    return 1
  else
    check_pass "Environment variable: \$${var_name} is set"
    return 0
  fi
}

check_env_var_format_json() {
  local var_name=$1
  local var_value="${!var_name:-}"

  if [ -z "$var_value" ]; then
    check_fail "Missing JSON variable: \$${var_name}"
    return 1
  fi

  # Try to parse JSON
  if echo "$var_value" | jq . > /dev/null 2>&1; then
    check_pass "JSON format valid: \$${var_name}"
    return 0
  else
    check_fail "Invalid JSON format: \$${var_name}"
    return 1
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Load Environment Variables
# ─────────────────────────────────────────────────────────────────────────────

print_header "LOADING ENVIRONMENT VARIABLES"

# Check if .env exists
if [ -f .env ]; then
  echo "Loading from: .env"
  set -a
  source .env
  set +a
  check_pass "Loaded .env file"
elif [ -f .env.local ]; then
  echo "Loading from: .env.local"
  set -a
  source .env.local
  set +a
  check_pass "Loaded .env.local file"
else
  check_fail "No .env or .env.local file found"
  echo ""
  echo "Create .env by copying .env.template:"
  echo "  cp .env.template .env"
  echo "Then fill in your credentials."
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 1: Required Environment Variables
# ─────────────────────────────────────────────────────────────────────────────

print_header "CHECK 1: REQUIRED ENVIRONMENT VARIABLES"

MISSING_VARS=0

# Server config
check_env_var "PORT" || ((MISSING_VARS++))
check_env_var "NODE_ENV" || ((MISSING_VARS++))

# Telegram
check_env_var "TELEGRAM_BOT_TOKEN" || ((MISSING_VARS++))

# Supabase (new requirement)
check_env_var "SUPABASE_URL" || ((MISSING_VARS++))
check_env_var "SUPABASE_SERVICE_KEY" || ((MISSING_VARS++))

# Google Sheets
check_env_var "GOOGLE_SHEET_ID" || ((MISSING_VARS++))
check_env_var "GOOGLE_CREDENTIALS_JSON" || ((MISSING_VARS++))

# OCR
check_env_var "OCR_CONFIDENCE_HIGH" || ((MISSING_VARS++))
check_env_var "OCR_CONFIDENCE_MEDIUM" || ((MISSING_VARS++))

# Alerts
check_env_var "ALERT_HOURS_WARNING" || ((MISSING_VARS++))
check_env_var "ALERT_HOURS_URGENT" || ((MISSING_VARS++))

# Timezone
check_env_var "TIMEZONE" || ((MISSING_VARS++))

if [ $MISSING_VARS -eq 0 ]; then
  check_pass "All required variables are set"
else
  check_fail "$MISSING_VARS required variables are missing"
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 2: Environment Variable Formats
# ─────────────────────────────────────────────────────────────────────────────

print_header "CHECK 2: ENVIRONMENT VARIABLE FORMATS"

# Check JSON formats
check_env_var_format_json "GOOGLE_CREDENTIALS_JSON" || true

# Check Supabase URL format
if [[ "${SUPABASE_URL:-}" =~ ^https://[a-z0-9-]+\.supabase\.co$ ]]; then
  check_pass "Supabase URL format looks correct"
else
  check_warn "Supabase URL format may be incorrect: ${SUPABASE_URL:-}"
fi

# Check Service Key format (should be long JWT-like token)
if [ ${#SUPABASE_SERVICE_KEY:-0} -gt 100 ]; then
  check_pass "Supabase Service Key length looks correct"
else
  check_warn "Supabase Service Key seems too short (< 100 chars)"
fi

# Check numeric values
if [[ "${OCR_CONFIDENCE_HIGH:-}" =~ ^0\.[0-9]+$ ]] || [[ "${OCR_CONFIDENCE_HIGH:-}" =~ ^[01]$ ]]; then
  check_pass "OCR_CONFIDENCE_HIGH format valid"
else
  check_warn "OCR_CONFIDENCE_HIGH format may be invalid"
fi

if [[ "${OCR_CONFIDENCE_MEDIUM:-}" =~ ^0\.[0-9]+$ ]] || [[ "${OCR_CONFIDENCE_MEDIUM:-}" =~ ^[01]$ ]]; then
  check_pass "OCR_CONFIDENCE_MEDIUM format valid"
else
  check_warn "OCR_CONFIDENCE_MEDIUM format may be invalid"
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 3: Supabase Connection
# ─────────────────────────────────────────────────────────────────────────────

print_header "CHECK 3: SUPABASE CONNECTION"

if command -v curl &> /dev/null; then
  echo "Testing Supabase connection..."

  # Test Supabase health check endpoint
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    "${SUPABASE_URL}/rest/v1/" 2>/dev/null || echo "000")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ]; then
    check_pass "Supabase URL is reachable (HTTP $HTTP_CODE)"
  else
    check_fail "Supabase URL not reachable (HTTP $HTTP_CODE)"
    echo "  URL: ${SUPABASE_URL}"
  fi
else
  check_warn "curl not found, skipping Supabase connection test"
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 4: Google Credentials
# ─────────────────────────────────────────────────────────────────────────────

print_header "CHECK 4: GOOGLE CREDENTIALS"

# Check if Google credentials contain required fields
if echo "$GOOGLE_CREDENTIALS_JSON" | jq -e '.type == "service_account"' > /dev/null 2>&1; then
  check_pass "Google credentials type is correct (service_account)"
else
  check_fail "Google credentials type is invalid"
fi

if echo "$GOOGLE_CREDENTIALS_JSON" | jq -e '.project_id' > /dev/null 2>&1; then
  PROJECT_ID=$(echo "$GOOGLE_CREDENTIALS_JSON" | jq -r '.project_id')
  check_pass "Google credentials has project_id: $PROJECT_ID"
else
  check_fail "Google credentials missing project_id"
fi

if echo "$GOOGLE_CREDENTIALS_JSON" | jq -e '.client_email' > /dev/null 2>&1; then
  CLIENT_EMAIL=$(echo "$GOOGLE_CREDENTIALS_JSON" | jq -r '.client_email')
  check_pass "Google credentials has client_email: $CLIENT_EMAIL"
else
  check_fail "Google credentials missing client_email"
fi

if echo "$GOOGLE_CREDENTIALS_JSON" | jq -e '.private_key' > /dev/null 2>&1; then
  check_pass "Google credentials has private_key"
else
  check_fail "Google credentials missing private_key"
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 5: Optional Google Vision Credentials
# ─────────────────────────────────────────────────────────────────────────────

print_header "CHECK 5: GOOGLE VISION CREDENTIALS (OPTIONAL)"

if [ -n "${GOOGLE_VISION_CREDENTIALS_JSON:-}" ]; then
  if echo "$GOOGLE_VISION_CREDENTIALS_JSON" | jq . > /dev/null 2>&1; then
    check_pass "Separate Vision API credentials configured and valid"
  else
    check_warn "GOOGLE_VISION_CREDENTIALS_JSON is set but not valid JSON"
  fi
else
  check_pass "Will use GOOGLE_CREDENTIALS_JSON for Vision API (default)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 6: Google Sheet ID
# ─────────────────────────────────────────────────────────────────────────────

print_header "CHECK 6: GOOGLE SHEET ID"

if [ -n "${GOOGLE_SHEET_ID:-}" ]; then
  # Sheet IDs are typically 40+ characters
  if [ ${#GOOGLE_SHEET_ID} -gt 20 ]; then
    check_pass "Google Sheet ID length looks correct"
    echo "  Sheet ID: $GOOGLE_SHEET_ID"
  else
    check_warn "Google Sheet ID seems too short (< 20 chars)"
  fi
else
  check_fail "GOOGLE_SHEET_ID is empty"
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 7: Telegram Bot Token
# ─────────────────────────────────────────────────────────────────────────────

print_header "CHECK 7: TELEGRAM BOT TOKEN"

if [[ "${TELEGRAM_BOT_TOKEN:-}" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
  check_pass "Telegram bot token format looks correct"
else
  check_warn "Telegram bot token format may be incorrect"
  echo "  Format should be: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 8: Optional Variables
# ─────────────────────────────────────────────────────────────────────────────

print_header "CHECK 8: OPTIONAL VARIABLES"

if [ -n "${TELEGRAM_WEBHOOK_URL:-}" ]; then
  check_pass "Telegram Webhook URL is configured"
else
  check_warn "Telegram Webhook URL not set (optional, can be set after deployment)"
fi

if [ -n "${MANAGER_CHAT_IDS:-}" ]; then
  check_pass "Manager Chat IDs configured for alerts"
else
  check_warn "Manager Chat IDs not set (alerts will be disabled)"
fi

if [ -n "${DAILY_REPORT_HOUR:-}" ]; then
  if [[ "${DAILY_REPORT_HOUR}" =~ ^[0-9]{1,2}$ ]] && [ "$DAILY_REPORT_HOUR" -ge 0 ] && [ "$DAILY_REPORT_HOUR" -le 23 ]; then
    check_pass "Daily report hour is valid: ${DAILY_REPORT_HOUR}:00"
  else
    check_warn "Daily report hour format invalid (should be 0-23)"
  fi
else
  check_warn "Daily report hour not set"
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 9: Local Dependencies
# ─────────────────────────────────────────────────────────────────────────────

print_header "CHECK 9: LOCAL DEPENDENCIES"

if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version)
  check_pass "Node.js installed: $NODE_VERSION"
else
  check_fail "Node.js not found, install from https://nodejs.org"
fi

if command -v npm &> /dev/null; then
  NPM_VERSION=$(npm --version)
  check_pass "npm installed: $NPM_VERSION"
else
  check_fail "npm not found"
fi

if [ -f "package.json" ]; then
  check_pass "package.json found"
else
  check_fail "package.json not found"
fi

if [ -f "package-lock.json" ] || [ -f "yarn.lock" ]; then
  check_pass "Dependency lock file found"
else
  check_warn "No lock file (package-lock.json or yarn.lock) found"
fi

if [ -d "node_modules" ]; then
  check_pass "node_modules directory exists"
else
  check_warn "node_modules directory not found (run: npm install)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 10: Source Code
# ─────────────────────────────────────────────────────────────────────────────

print_header "CHECK 10: SOURCE CODE"

REQUIRED_FILES=(
  "src/server.js"
  "src/db.js"
  "src/config.js"
  "src/matcher.js"
  "src/telegram.js"
  "supabase/migrations/001-init-schema.sql"
)

for file in "${REQUIRED_FILES[@]}"; do
  if [ -f "$file" ]; then
    check_pass "File exists: $file"
  else
    check_fail "Missing required file: $file"
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────

print_header "DEPLOYMENT READINESS SUMMARY"

echo "✓ Passed:  $PASSED"
echo "✗ Failed:  $FAILED"
echo "⚠ Warnings: $WARNINGS"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}✓ ALL CHECKS PASSED - READY TO DEPLOY${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Review DEPLOYMENT_CHECKLIST.md for detailed deployment steps"
  echo "2. Deploy to Render/Railway/VPS using DEPLOY_TO_RENDER.md"
  echo "3. Test bot after deployment: DEPLOYMENT_CHECKLIST.md section 7"
  echo ""
  exit 0
else
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${RED}✗ $FAILED CHECK(S) FAILED - FIX ERRORS BEFORE DEPLOYING${NC}"
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "See errors above. Common fixes:"
  echo "1. Missing env vars? → Check .env file and SETUP_GUIDE.md"
  echo "2. Invalid format? → Copy template: cp .env.template .env"
  echo "3. Supabase not set? → Follow DEPLOYMENT_CHECKLIST.md section 3"
  echo "4. Google not set? → Follow DEPLOYMENT_CHECKLIST.md section 4"
  echo ""
  exit 1
fi
