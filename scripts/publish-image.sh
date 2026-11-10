#!/usr/bin/env bash
set -euo pipefail
umask 077

version=${1:?Usage: publish-image.sh X.Y.Z registry.cn-shanghai.aliyuncs.com/wolfife/family}
repository=${2:?Usage: publish-image.sh X.Y.Z registry.cn-shanghai.aliyuncs.com/wolfife/family}
if ! [[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] ||
   [[ "$repository" != registry.cn-shanghai.aliyuncs.com/wolfife/family ]]; then
  echo "Invalid version or Alibaba Cloud image repository" >&2
  exit 1
fi

temporary=$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/family-acr-inspect.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT

is_missing_manifest() {
  grep -Eqi 'manifest unknown|manifest for .* not found|MANIFEST_UNKNOWN' "$temporary"
}

local_image="family-tree:$version"
target_id=$(docker image inspect --format '{{.Id}}' "$local_image")
target_tag="$repository:$version"
if docker pull "$target_tag" >"$temporary" 2>&1; then
  existing_id=$(docker image inspect --format '{{.Id}}' "$target_tag")
  if [[ "$existing_id" != "$target_id" ]]; then
    echo "Version tag $target_tag already points to a different image" >&2
    exit 1
  fi
  echo "Version tag already points to the built image"
elif is_missing_manifest; then
  docker tag "$local_image" "$target_tag"
  docker push "$target_tag"
else
  cat "$temporary" >&2
  echo "Could not safely inspect the existing version tag" >&2
  exit 1
fi

latest_tag="$repository:latest"
if docker pull "$latest_tag" >"$temporary" 2>&1; then
  latest_version=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$latest_tag")
  latest_id=$(docker image inspect --format '{{.Id}}' "$latest_tag")
  decision=$(node - "$latest_version" "$version" "$latest_id" "$target_id" <<'NODE'
const [current, target, currentId, targetId] = process.argv.slice(2)
const parse = (value) => {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Invalid registry image version: ${value}`)
  }
  return value.split('.').map(Number)
}
const a = parse(current)
const b = parse(target)
const comparison = a.findIndex((part, index) => part !== b[index])
if (comparison < 0) {
  if (currentId !== targetId) throw new Error('A different image already uses this version')
  console.log('same')
} else {
  console.log(a[comparison] > b[comparison] ? 'newer' : 'older')
}
NODE
)
  case "$decision" in
    older)
      docker tag "$local_image" "$latest_tag"
      docker push "$latest_tag"
      ;;
    same)
      echo "latest already points to this image"
      ;;
    newer)
      echo "Refusing to move latest backwards from $latest_version to $version" >&2
      exit 1
      ;;
    *)
      echo "Unexpected latest-version comparison result" >&2
      exit 1
      ;;
  esac
elif is_missing_manifest; then
  docker tag "$local_image" "$latest_tag"
  docker push "$latest_tag"
else
  cat "$temporary" >&2
  echo "Could not safely inspect the current latest image" >&2
  exit 1
fi
