#!/usr/bin/env bash
# Test that auth/session routes respond. Usage: ./scripts/test-auth-routes.sh [BASE_URL]
# Example: ./scripts/test-auth-routes.sh https://mcp.worxstream.io
# Example: ./scripts/test-auth-routes.sh http://localhost:3000

BASE="${1:-http://localhost:3000}"

echo "Testing auth routes at base: $BASE"
echo ""

echo "1. GET $BASE/api/auth (auth mount check)"
curl -s -o /dev/null -w "   Status: %{http_code}\n" "$BASE/api/auth"
echo ""

echo "2. GET $BASE/api/auth/session (session status)"
curl -s "$BASE/api/auth/session" | head -c 200
echo ""
echo ""

echo "3. POST $BASE/api/auth/session (set session - expect 400 without body)"
curl -s -o /dev/null -w "   Status: %{http_code}\n" -X POST "$BASE/api/auth/session" -H "Content-Type: application/json" -d '{}'
echo ""

echo "If you see 200 for (1) and (2), and 400 for (3), routes are working."
echo "If you see 404, the server at $BASE is not this app or the path is wrong."
