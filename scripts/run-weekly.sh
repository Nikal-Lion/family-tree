#!/usr/bin/env bash
set -euo pipefail
umask 077

root=$(realpath "${DEPLOY_ROOT:-/srv/family-tree}")
mkdir -p "$root/logs"
log="$root/logs/weekly-deploy.log"
if [[ -f "$log" ]] && (( $(wc -c < "$log") >= 5242880 )); then
  mv -f "$log" "$log.1"
fi

{
  printf '\n[%s] Starting weekly release check\n' "$(TZ=Asia/Shanghai date '+%F %T %Z')"
  if [[ "$(timedatectl show --property=Timezone --value)" != Asia/Shanghai ]]; then
    echo "Weekly release check failed: server timezone is not Asia/Shanghai" >&2
    exit 1
  fi
  if python3 "$root/bin/pull-image.py"; then
    echo "Weekly release check completed"
  else
    status=$?
    echo "Weekly release check failed (exit $status)" >&2
    exit "$status"
  fi
} >>"$log" 2>&1
