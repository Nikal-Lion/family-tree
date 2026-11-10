#!/usr/bin/env python3
"""Pull the tested ACR latest image and deploy its immutable digest."""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time


ROOT = Path(os.environ.get("DEPLOY_ROOT", "/srv/family-tree")).resolve(strict=True)
REPOSITORY = "registry-vpc.cn-shanghai.aliyuncs.com/wolfife/family"
VERSION = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
DIGEST = re.compile(re.escape(REPOSITORY) + r"@sha256:[a-f0-9]{64}")


def inspect_image(reference):
    result = subprocess.run(
        ["docker", "image", "inspect", reference],
        capture_output=True, text=True, check=True,
    )
    images = json.loads(result.stdout)
    if not isinstance(images, list) or len(images) != 1 or not isinstance(images[0], dict):
        raise ValueError("Docker returned invalid image metadata")
    return images[0]


def version_of(image):
    config = image.get("Config")
    labels = config.get("Labels") if isinstance(config, dict) else None
    version = labels.get("org.opencontainers.image.version") if isinstance(labels, dict) else None
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise ValueError("Image has no valid release version label")
    return version


def check_health():
    for url in ("http://127.0.0.1:3000/healthz", "https://wolfife.top/family/healthz"):
        subprocess.run(
            ["curl", "--fail", "--silent", "--show-error", "--connect-timeout", "5",
             "--max-time", "15", url], check=True,
        )


def main():
    os.umask(0o077)
    with (ROOT / "pull.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("Another release check or installer is already running") from error

        # Registry authentication belongs to the cron user's Docker credential store.
        latest = f"{REPOSITORY}:latest"
        subprocess.run(["docker", "pull", "--platform", "linux/amd64", latest], check=True)
        image = inspect_image(latest)
        digests = image.get("RepoDigests")
        matches = [ref for ref in digests if isinstance(ref, str) and DIGEST.fullmatch(ref)] if isinstance(digests, list) else []
        if len(matches) != 1:
            raise ValueError("Pulled image has no unique digest for the configured registry")
        reference = matches[0]
        pinned = inspect_image(reference)
        if not image.get("Id") or pinned.get("Id") != image["Id"]:
            raise ValueError("Pulled image and digest do not match")
        version = version_of(pinned)
        if pinned.get("Os") != "linux" or pinned.get("Architecture") != "amd64":
            raise ValueError("Image must target linux/amd64")
        if pinned["Config"]["Labels"].get("org.family-tree.base-path") != "/family/":
            raise ValueError("Image was not built for /family/")

        marker = ROOT / "current-image.txt"
        if marker.exists():
            current = marker.read_text(encoding="utf-8").strip()
            if current.startswith("family-tree:") and VERSION.fullmatch(current[12:]):
                current_version = current[12:]
            elif DIGEST.fullmatch(current):
                current_version = version_of(inspect_image(current))
            else:
                raise ValueError("Invalid current image marker; refusing deployment")
            if tuple(map(int, version.split("."))) < tuple(map(int, current_version.split("."))):
                raise ValueError("Registry latest is older than the deployed version; refusing downgrade")
            if current == reference:
                print("Image digest is unchanged; checking local and public health", flush=True)
                check_health()
                return

        releases = ROOT / "releases"
        releases.mkdir(mode=0o700, exist_ok=True)
        release = releases / f"v{version}-{time.time_ns()}-{os.getpid()}"
        (release / "scripts").mkdir(mode=0o700, parents=True)
        templates = ROOT / "bin"
        for name in ("docker-compose.yml", "docker-compose.production.yml"):
            shutil.copyfile(templates / name, release / name)
        shutil.copyfile(templates / "deploy.sh", release / "scripts/deploy.sh")
        (release / "image.txt").write_text(reference + "\n", encoding="utf-8")
        names = ("image.txt", "docker-compose.yml", "docker-compose.production.yml", "scripts/deploy.sh")
        checksums = [f"{hashlib.sha256((release / name).read_bytes()).hexdigest()}  {name}\n" for name in names]
        (release / "SHA256SUMS").write_text("".join(checksums), encoding="utf-8")
        print(f"Deploying {version} as {reference}", flush=True)
        subprocess.run(["bash", str(release / "scripts/deploy.sh"), str(release)], check=True)
        if marker.read_text(encoding="utf-8").strip() != reference:
            raise RuntimeError("Deployment did not record the expected image digest")
        print(f"Deployed {reference}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Image deployment failed: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
