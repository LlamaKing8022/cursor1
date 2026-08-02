#!/usr/bin/env bash
# Quick setup check — run this if pages or APIs return 404.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== TowerWatch doctor ==="
echo "folder: $ROOT"
echo

# 1. Branch / files
BRANCH="$(git branch --show-current 2>/dev/null || echo unknown)"
echo "git branch: $BRANCH"
if [ "$BRANCH" != "cursor/tower-drowning-mvp-5351" ]; then
  echo "  !! You are probably on the wrong branch."
  echo "     Run: git checkout cursor/tower-drowning-mvp-5351 && git pull"
fi
for f in backend/app/main.py frontend/index.html requirements.txt; do
  if [ -f "$f" ]; then echo "  ok  $f"; else echo "  MISSING $f"; fi
done
echo

# 2. Python env
if [ -d .venv ]; then
  echo "venv: .venv exists"
  # shellcheck disable=SC1091
  source .venv/bin/activate
else
  echo "venv: MISSING — run: python3 -m venv .venv && source .venv/bin/activate"
fi
export PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}"
if python3 -c "import fastapi, uvicorn, cv2" 2>/dev/null; then
  echo "python deps: ok (fastapi, uvicorn, cv2)"
else
  echo "python deps: MISSING — run: pip install -r requirements.txt"
fi
echo

# 3. Server
URL="${TOWERWATCH_URL:-http://127.0.0.1:8000}"
echo "checking $URL ..."
if curl -sf "$URL/api/health" >/tmp/tw-health.json 2>/dev/null; then
  python3 - <<'PY'
import json
h = json.load(open("/tmp/tw-health.json"))
print("  health: OK")
print(f"  version: {h.get('version')}")
print(f"  live frame: {h.get('has_live_frame')}")
print(f"  edge connected: {h.get('edge_connected')}")
if h.get("hint"):
    print(f"  hint: {h['hint']}")
PY
  for path in "/" "/static/app.js" "/api/stream/latest.jpg" "/api/tower/status" "/api/alerts"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "$URL$path")
    echo "  $path -> $code"
  done
else
  echo "  health: NOT REACHABLE"
  echo "  Start the app with:"
  echo "    source .venv/bin/activate"
  echo "    ./scripts/run_demo.sh"
  echo "  or in two terminals:"
  echo "    ./scripts/run_server.sh"
  echo "    ./scripts/run_edge.sh"
fi
echo
echo "Open: $URL/"
echo "Header should show v0.3.0 after a hard refresh (Cmd/Ctrl+Shift+R)."
