---
name: deploy
description: Run tests, push to GitHub, and trigger Render deploy for VinFast Phuc Loi bot
disable-model-invocation: true
---

# Deploy

1. Run tests: `cd /tmp/vinfast-phuc-loi && npm test`
2. If any test fails, STOP and report the failure. Do not push.
3. Push: `cd /tmp/vinfast-phuc-loi && git push origin claude/vehicle-tracking-zalo-ocr-3ERhn`
4. Trigger Render deploy:
   ```bash
   curl -s -w "%{http_code}" -X POST "https://api.render.com/v1/services/srv-d6ghcshaae7s73bcdovg/deploys" \
     -H "Authorization: Bearer rnd_FhwoBJtRUJpiBMuUnl1SaaQlAjPa" \
     -H "Content-Type: application/json"
   ```
5. Confirm HTTP 202 response, then report success.
