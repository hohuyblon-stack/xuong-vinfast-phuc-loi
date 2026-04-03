#!/bin/bash
# Composite quality metric: weighted average line coverage + test bonus
# Higher = better.

set -e
cd "$(dirname "$0")/.."

OUTPUT=$(node --experimental-test-coverage --test 'test/**/*.test.js' 2>&1)

TESTS=$(echo "$OUTPUT" | grep "^ℹ tests" | awk '{print $3}')
PASS=$(echo "$OUTPUT" | grep "^ℹ pass" | awk '{print $3}')
FAIL=$(echo "$OUTPUT" | grep "^ℹ fail" | awk '{print $3}')

# Parse coverage lines: "ℹ  filename.js  | line% | branch% | func% | uncovered"
FILE_COUNT=0
TOTAL_LINE_PCT=0
while IFS= read -r line; do
  pct=$(echo "$line" | awk -F'|' '{print $2}' | tr -d ' %')
  if [[ "$pct" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    TOTAL_LINE_PCT=$(echo "$TOTAL_LINE_PCT + $pct" | bc)
    FILE_COUNT=$((FILE_COUNT + 1))
  fi
done <<< "$(echo "$OUTPUT" | grep "^ℹ  " | grep -v "^ℹ  file" | grep -v "^ℹ  src" | grep -v "^ℹ  ---")"

if [ "$FILE_COUNT" -gt 0 ]; then
  AVG_COVERAGE=$(echo "scale=2; $TOTAL_LINE_PCT / $FILE_COUNT" | bc)
else
  AVG_COVERAGE=0
fi

# Score = avg_line_coverage + (test_count * 0.1) - (failures * 50)
SCORE=$(echo "scale=2; $AVG_COVERAGE + ($TESTS * 0.1) + ($FAIL * -50)" | bc)

echo "$SCORE"
>&2 echo "coverage=$AVG_COVERAGE% tests=$TESTS pass=$PASS fail=$FAIL score=$SCORE"
