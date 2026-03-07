#!/bin/bash
# PostToolUse hook: Node.js syntax check on src/ edits
file=$(node -e "
  let d='';
  process.stdin.on('data', c => d += c);
  process.stdin.on('end', () => {
    try { console.log(JSON.parse(d).file_path || ''); }
    catch(e) { process.exit(0); }
  });
")
if echo "$file" | grep -q '/src/.*\.js$'; then
  node --check "$file" && echo "Syntax OK: $file"
fi
