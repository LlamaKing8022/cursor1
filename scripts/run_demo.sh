#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}"

echo "Starting TowerWatch API on http://127.0.0.1:8000 ..."
python3 -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for health
for i in {1..40}; do
  if curl -sf http://127.0.0.1:8000/api/health >/dev/null; then
    break
  fi
  sleep 0.25
done

echo "Starting edge worker (demo beach scene) ..."
python3 edge/worker.py --config "$ROOT/config/default.yaml" --source demo &
EDGE_PID=$!

cleanup() {
  kill "$EDGE_PID" "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo ""
echo "TowerWatch demo is running."
echo "Open the tower tablet UI: http://127.0.0.1:8000/"
echo "Press Ctrl+C to stop."
wait