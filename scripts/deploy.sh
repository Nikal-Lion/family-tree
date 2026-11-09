#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

root=$(realpath "${DEPLOY_ROOT:-/srv/family-tree}")
release=${1:?Usage: deploy.sh /srv/family-tree/releases/vX.Y.Z-RUN-ATTEMPT}
if [[ "$(dirname "$release")" != "$root/releases" ]] ||
   ! [[ "$(basename "$release")" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-[0-9]+-[0-9]+$ ]]; then
  echo "Invalid release directory" >&2
  exit 1
fi
if [[ "$(realpath "$release")" != "$release" ]]; then
  echo "Release directory must not contain symlinks" >&2
  exit 1
fi

exec 9>"$root/deploy.lock"
flock -n 9 || { echo "Another deployment is running" >&2; exit 1; }
cd "$release"
sha256sum --check SHA256SUMS
image=$(cat image.txt)
if ! [[ "$image" =~ ^family-tree:[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid release image" >&2
  exit 1
fi
docker network inspect stock-analyze_default >/dev/null
docker load --input family-tree-image.tar.gz
docker image inspect "$image" >/dev/null
mkdir -p "$root/backups"

if [[ ! -f "$root/.env" ]]; then
  python3 - "$root" <<'PY'
import hashlib
from pathlib import Path
import secrets
import sys

root = Path(sys.argv[1])
password = secrets.token_hex(24)
salt = secrets.token_hex(16)
digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 100000).hex()
with (root / 'bootstrap-password.txt').open('x') as file:
    file.write(password + '\n')
with (root / '.env').open('x') as file:
    file.write("SYSADMIN_PASSWORD_PBKDF2='pbkdf2_sha256$100000$" + salt + '$' + digest + "'\n")
    file.write('BIND_ADDRESS=127.0.0.1\nPORT=3000\n')
print('Created first-run credentials in protected server files; no credentials are logged.')
PY
fi
chmod 600 "$root/.env"
export APP_IMAGE="$image"
compose=(docker compose --project-name family-tree --env-file "$root/.env"
  -f "$release/docker-compose.yml" -f "$release/docker-compose.production.yml")
"${compose[@]}" config --quiet

old_container=$(docker ps -aq --filter label=com.docker.compose.project=family-tree --filter label=com.docker.compose.service=app)
if [[ "$old_container" == *$'\n'* ]]; then
  echo "Expected at most one existing application container" >&2
  exit 1
fi
stopped=0
started=0
backup="$root/backups/$(basename "$release").tar.gz"

on_failure() {
  status=$?
  trap - ERR
  echo "Deployment failed (exit $status)." >&2
  if (( started )); then
    "${compose[@]}" logs --tail=80 app >&2 || echo "Could not read application logs" >&2
    "${compose[@]}" stop app || echo "Could not stop the failed application" >&2
    echo "New application stopped. Do not blindly roll back across schema changes." >&2
    echo "If a previous database existed, its pre-deploy backup is: $backup" >&2
  elif (( stopped )); then
    docker start "$old_container" || echo "Could not restart the previous application" >&2
  fi
  exit "$status"
}
trap on_failure ERR

if [[ -n "$old_container" ]]; then
  docker stop "$old_container"
  stopped=1
fi
volumes=$(docker volume ls --format '{{.Name}}')
if grep -Fxq family-tree_family-tree-data <<< "$volumes"; then
  docker run --rm --network none --memory 128m \
    --mount type=volume,source=family-tree_family-tree-data,target=/data,readonly \
    --mount "type=bind,source=$root/backups,target=/backup" \
    --entrypoint tar "$image" -czf "/backup/$(basename "$backup")" -C /data .
fi

started=1
"${compose[@]}" up -d --wait --wait-timeout 90
curl --fail --silent --show-error --max-time 15 http://127.0.0.1:3000/healthz
curl --fail --silent --show-error --retry 5 --retry-delay 3 --max-time 15 \
  https://wolfife.top/family/healthz
curl --fail --silent --show-error --max-time 15 https://wolfife.top/family/login \
  | grep -q '/family/assets/'

python3 - "$root" "$release" <<'PY'
import os
from pathlib import Path
import sys

root = Path(sys.argv[1])
temporary = root / ('current.' + str(os.getpid()))
temporary.symlink_to(sys.argv[2])
os.replace(temporary, root / 'current')
PY
printf '%s\n' "$image" > "$root/current-image.txt"
trap - ERR
echo "Deployed $image at https://wolfife.top/family/"
