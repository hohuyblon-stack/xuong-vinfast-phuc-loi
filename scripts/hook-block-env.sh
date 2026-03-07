#!/bin/bash
# PreToolUse hook: block edits to credential/env files
file=$(node -e "
  let d='';
  process.stdin.on('data', c => d += c);
  process.stdin.on('end', () => {
    try { console.log(JSON.parse(d).file_path || ''); }
    catch(e) { process.exit(0); }
  });
")
if echo "$file" | grep -qE '(\.env$|\.env\.|credentials\.json|token\.json|service_account\.json)'; then
  echo "BLOCKED: Do not edit '$file' directly. Use Render dashboard for env vars."
  exit 2
fi
