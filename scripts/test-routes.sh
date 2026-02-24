#!/usr/bin/env bash
# Test health and session routes. Usage: ./scripts/test-routes.sh [BASE_URL]
# Example: ./scripts/test-routes.sh https://mcp.worxstream.io
# Example: ./scripts/test-routes.sh http://localhost:3000

BASE="${1:-http://localhost:3000}"

echo "Testing routes at: $BASE"
echo ""

echo "1. GET $BASE/health"
curl -s -w "  -> HTTP %{http_code}\n" "$BASE/health" | head -1
curl -s -w "  -> HTTP %{http_code}\n" -o /dev/null "$BASE/health"
echo ""

echo "2. GET $BASE/session"
OUT=$(curl -s -w "\n%{http_code}" "$BASE/session")
CODE=$(echo "$OUT" | tail -1)
BODY=$(echo "$OUT" | sed '$d')
echo "  Body: $BODY"
echo "  -> HTTP $CODE"
echo ""

echo "3. POST $BASE/session (empty body, expect 400)"
curl -s -w "  -> HTTP %{http_code}\n" -o /dev/null -X POST "$BASE/session" -H "Content-Type: application/json" -d '{}'
echo ""

echo "4. DELETE $BASE/session"
curl -s -w "  -> HTTP %{http_code}\n" -o /dev/null -X DELETE "$BASE/session"
echo ""

echo "Done. After deploy, run: ./scripts/test-routes.sh https://mcp.worxstream.io"
