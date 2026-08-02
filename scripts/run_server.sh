#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}"
echo "TowerWatch API starting on http://127.0.0.1:8000"
echo "Live camera feed needs a second terminal: ./scripts/run_edge.sh"
echo "Or use one command for demo: ./scripts/run_demo.sh"
exec python3 -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload