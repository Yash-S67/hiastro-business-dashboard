#!/bin/zsh
set -euo pipefail

WORK_ROOT="/Users/yashs/Documents/WorkDirectory"
DASHBOARD_ROOT="${WORK_ROOT}/hiastro-business-dashboard"
LOG_DIR="${DASHBOARD_ROOT}/logs"
PYTHON="${WORK_ROOT}/.venv/bin/python"
GIT="/usr/bin/git"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "${LOG_DIR}"

cd "${WORK_ROOT}"
for attempt in 1 2 3; do
  if "${PYTHON}" "${DASHBOARD_ROOT}/scripts/build_dashboard_data.py"; then
    break
  fi
  if [[ "${attempt}" == "3" ]]; then
    exit 1
  fi
  echo "Dashboard refresh failed on attempt ${attempt}; retrying in 90 seconds..."
  sleep 90
done

cd "${DASHBOARD_ROOT}"
"${GIT}" fetch origin main

if ! "${GIT}" diff --quiet -- data/dashboard_data.json; then
  "${GIT}" add data/dashboard_data.json
  "${GIT}" commit -m "Refresh dashboard data"
  "${GIT}" push origin main
else
  echo "No dashboard data changes to commit."
fi
