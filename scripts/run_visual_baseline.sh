#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:4173/index.html}"

if ! python -c "import playwright" >/dev/null 2>&1; then
  echo "Missing dependency: playwright"
  echo "Install with:"
  echo "  python -m pip install -r scripts/requirements-dev.txt"
  echo "  python -m playwright install chromium"
  exit 1
fi

python scripts/capture_chart_baseline.py "$BASE_URL"
echo "Baseline screenshots captured in artifacts/."
