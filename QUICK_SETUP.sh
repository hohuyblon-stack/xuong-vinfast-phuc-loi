#!/bin/bash

# QUICK SETUP SCRIPT - Xuong VinFast Bot
# This script helps verify setup before deployment

set -e

echo "=========================================="
echo "Xuong VinFast Bot - Quick Setup Checker"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Node version
echo "1. Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo -e "${GREEN}✓ Node.js installed: ${NODE_VERSION}${NC}"
else
    echo -e "${RED}✗ Node.js not found. Please install Node.js >= 18.0.0${NC}"
    exit 1
fi

# Check npm
echo ""
echo "2. Checking npm..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    echo -e "${GREEN}✓ npm installed: ${NPM_VERSION}${NC}"
else
    echo -e "${RED}✗ npm not found${NC}"
    exit 1
fi

# Install dependencies
echo ""
echo "3. Installing dependencies..."
if [ ! -d "node_modules" ]; then
    npm install
    echo -e "${GREEN}✓ Dependencies installed${NC}"
else
    echo -e "${GREEN}✓ Dependencies already installed${NC}"
fi

# Check .env file
echo ""
echo "4. Checking .env file..."
if [ -f ".env" ]; then
    echo -e "${GREEN}✓ .env file found${NC}"

    # Check required variables
    if grep -q "TELEGRAM_BOT_TOKEN=" .env; then
        echo -e "${GREEN}  ✓ TELEGRAM_BOT_TOKEN defined${NC}"
    else
        echo -e "${YELLOW}  ⚠ TELEGRAM_BOT_TOKEN not set${NC}"
    fi

    if grep -q "GOOGLE_SHEET_ID=" .env; then
        echo -e "${GREEN}  ✓ GOOGLE_SHEET_ID defined${NC}"
    else
        echo -e "${YELLOW}  ⚠ GOOGLE_SHEET_ID not set${NC}"
    fi

    if grep -q "GOOGLE_CREDENTIALS_JSON=" .env; then
        echo -e "${GREEN}  ✓ GOOGLE_CREDENTIALS_JSON defined${NC}"
    else
        echo -e "${YELLOW}  ⚠ GOOGLE_CREDENTIALS_JSON not set${NC}"
    fi
else
    echo -e "${YELLOW}⚠ .env file not found. Creating from template...${NC}"
    if [ -f ".env.template" ]; then
        cp .env.template .env
        echo -e "${YELLOW}✓ Created .env from .env.template${NC}"
        echo -e "${YELLOW}⚠ Edit .env and fill in your credentials${NC}"
    else
        echo -e "${RED}✗ .env.template not found${NC}"
        exit 1
    fi
fi

# Run tests
echo ""
echo "5. Running tests..."
if npm test 2>/dev/null; then
    echo -e "${GREEN}✓ All tests passed${NC}"
else
    echo -e "${YELLOW}⚠ Some tests may have failed (continue anyway)${NC}"
fi

# Health check script
echo ""
echo "6. Creating test helper..."
cat > test-bot.sh << 'EOF'
#!/bin/bash
# Simple test script to check if server is running

if [ -z "$SERVER_URL" ]; then
    SERVER_URL="http://localhost:3000"
fi

echo "Testing server at: $SERVER_URL"
echo ""

# Health check
echo "Testing /health endpoint..."
curl -s "$SERVER_URL/health" | jq '.' 2>/dev/null || echo "Failed to reach server"

echo ""
echo "To test Telegram bot:"
echo "1. Start server: npm start"
echo "2. In another terminal, open your Telegram bot"
echo "3. Send /start or HELP command"
echo "4. Send a license plate image"
echo "5. Check Google Sheets if data is recorded"
EOF

chmod +x test-bot.sh
echo -e "${GREEN}✓ Created test-bot.sh${NC}"

# Summary
echo ""
echo "=========================================="
echo -e "${GREEN}Setup Check Complete!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Edit .env with your credentials:"
echo "   - TELEGRAM_BOT_TOKEN (from @BotFather)"
echo "   - GOOGLE_SHEET_ID (from Google Sheets URL)"
echo "   - GOOGLE_CREDENTIALS_JSON (from Service Account JSON)"
echo ""
echo "2. Test locally:"
echo "   npm start"
echo ""
echo "3. Test bot at localhost:3000:"
echo "   ./test-bot.sh"
echo ""
echo "4. Deploy to cloud:"
echo "   - Render.com (recommended for free tier)"
echo "   - Railway.app"
echo "   - Your own VPS"
echo ""
echo "See DEPLOYMENT_CHECKLIST.md for detailed steps"
echo ""
