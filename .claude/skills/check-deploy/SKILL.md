---
name: check-deploy
description: Run pre-deploy validation checks then push to Render. Validates syntax, tests, and env var coverage before deploying.
disable-model-invocation: true
---

# Pre-Deploy Check + Deploy

Run this before every production deploy to Render.

## Steps

### 1. Syntax check all source files
```bash
for f in /tmp/vinfast-phuc-loi/src/*.js; do
  node --check "$f" && echo "OK: $f" || { echo "FAIL: $f"; exit 1; }
done
```

### 2. Run tests
```bash
cd /tmp/vinfast-phuc-loi && npm test
```
Stop if any test fails.

### 3. Check .env.example coverage
Verify every key in `.env.example` has a corresponding entry in `.env.template`.

### 4. Verify no hardcoded secrets
```bash
grep -rn "eyJ\|sk-\|rnd_\|AIza" /tmp/vinfast-phuc-loi/src/ && echo "WARNING: possible secret in src/" || echo "No secrets found"
```

### 5. Deploy to Render
```bash
cd /tmp/vinfast-phuc-loi && git add -A && git commit -m "chore: pre-deploy checkpoint" || true
git push origin claude/vehicle-tracking-zalo-ocr-3ERhn
curl -s -X POST "https://api.render.com/v1/services/srv-d6ghcshaae7s73bcdovg/deploys" \
  -H "Authorization: Bearer rnd_FhwoBJtRUJpiBMuUnl1SaaQlAjPa" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);console.log('Deploy triggered:', r.id, r.status);})"
```

### 6. Confirm
Check `https://xuong-vinfast-phuc-loi.onrender.com/health` after ~2 minutes.
