#!/usr/bin/env bash
set -euo pipefail
umask 077
export LC_ALL=C

root=$(realpath "${DEPLOY_ROOT:-/srv/family-tree}")
if [[ "$root" == *[!a-zA-Z0-9_./-]* ]]; then
  echo "Deployment path contains characters unsafe for crontab" >&2
  exit 1
fi
if [[ "$(timedatectl show --property=Timezone --value)" != Asia/Shanghai ]]; then
  echo "Server timezone must be Asia/Shanghai for the weekly schedule" >&2
  exit 1
fi
if ! systemctl is-active --quiet cron; then
  echo "The system cron service is not active" >&2
  exit 1
fi

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
python3 -c 'import sys; compile(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1], "exec")' "$source_dir/pull-release.py"
bash -n "$source_dir/run-weekly.sh"
install -d -m 700 "$root/bin" "$root/logs" "$root/releases" "$root/downloads"
for name in pull-release.py run-weekly.sh; do
  temporary="$root/bin/.$name.$$"
  install -m 700 "$source_dir/$name" "$temporary"
  mv -f "$temporary" "$root/bin/$name"
done

python3 - "$root" <<'PY'
import os
import pwd
import subprocess
import sys

root = sys.argv[1]
result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
no_crontab = f"no crontab for {pwd.getpwuid(os.getuid()).pw_name}"
if result.returncode and result.stderr.strip() != no_crontab:
    raise SystemExit(f"Cannot read existing crontab: {result.stderr.strip()}")
lines = result.stdout.splitlines()
start, end = "# BEGIN FAMILY_TREE_WEEKLY", "# END FAMILY_TREE_WEEKLY"
if lines.count(start) != lines.count(end) or lines.count(start) > 1:
    raise SystemExit("Existing family-tree crontab markers are invalid; refusing to overwrite")
if start in lines:
    first, last = lines.index(start), lines.index(end)
    if last < first:
        raise SystemExit("Existing family-tree crontab markers are reversed")
    lines[first:last + 1] = []
lines.extend([
    start,
    f"0 22 * * 4 DEPLOY_ROOT={root} /bin/bash {root}/bin/run-weekly.sh",
    end,
])
subprocess.run(["crontab", "-"], input="\n".join(lines) + "\n", text=True, check=True)
print("Installed weekly release check: Thursday 22:00 Asia/Shanghai")
PY
