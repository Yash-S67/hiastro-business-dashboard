#!/bin/zsh
set -euo pipefail

WORK_ROOT="/Users/yashs/Documents/WorkDirectory"
DASHBOARD_ROOT="${WORK_ROOT}/hiastro-business-dashboard"
LOG_DIR="${DASHBOARD_ROOT}/logs"

mkdir -p "${LOG_DIR}"

cd "${WORK_ROOT}"
"${WORK_ROOT}/.venv/bin/python" "${DASHBOARD_ROOT}/scripts/build_dashboard_data.py"

cd "${DASHBOARD_ROOT}"
git fetch origin main

if ! git diff --quiet -- data/dashboard_data.json; then
  git add data/dashboard_data.json
  git commit -m "Refresh dashboard data"
  git push origin main
else
  echo "No dashboard data changes to commit."
fi
