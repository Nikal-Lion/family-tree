#!/usr/bin/env python3
"""Pull and deploy the latest stable GitHub Release without inbound SSH."""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlsplit


ROOT = Path(os.environ.get("DEPLOY_ROOT", "/srv/family-tree")).resolve(strict=True)
REPOSITORY = "Nikal-Lion/family-tree"
API_URL = f"https://api.github.com/repos/{REPOSITORY}/releases/latest"
REQUIRED_FILES = {
    "SHA256SUMS",
    "image.txt",
    "family-tree-image.tar.gz",
    "docker-compose.yml",
    "docker-compose.production.yml",
    "scripts/deploy.sh",
}
OPTIONAL_FILES = {"scripts/pull-release.py", "scripts/run-weekly.sh"}
TAG_PATTERN = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
HASH_PATTERN = re.compile(r"[a-f0-9]{64}")
CHUNK_SIZE = 256 * 1024
DOWNLOAD_WORKERS = 8


def fetch(url, destination, max_time):
    subprocess.run(
        [
            "curl", "--ipv4", "--fail", "--location", "--silent", "--show-error",
            "--proto", "=https", "--proto-redir", "=https",
            "--retry", "6", "--retry-all-errors", "--retry-delay", "4",
            "--connect-timeout", "10", "--max-time", str(max_time),
            "--retry-max-time", "1800", "--output", str(destination),
            "--header", "Accept: application/vnd.github+json",
            "--header", "User-Agent: family-tree-release-puller", url,
        ],
        check=True,
    )


def asset_download_url(api_url):
    result = subprocess.run(
        [
            "curl", "--ipv4", "--fail", "--silent", "--show-error", "--head",
            "--proto", "=https", "--retry", "4", "--retry-all-errors",
            "--retry-delay", "4", "--connect-timeout", "10", "--max-time", "60",
            "--output", os.devnull, "--write-out", "%{redirect_url}",
            "--header", "Accept: application/octet-stream",
            "--header", "User-Agent: family-tree-release-puller", api_url,
        ],
        capture_output=True, text=True,
    )
    if result.returncode:
        raise RuntimeError(f"Cannot obtain GitHub asset redirect (curl exit {result.returncode})")
    url = result.stdout.strip()
    parsed = urlsplit(url)
    if (
        parsed.scheme != "https"
        or parsed.netloc != "release-assets.githubusercontent.com"
        or not parsed.path
        or not parsed.query
        or parsed.fragment
        or any(ord(char) < 33 or ord(char) > 126 or char in '"\\' for char in url)
    ):
        raise ValueError("GitHub asset redirect has an unexpected URL")
    return url


def fetch_chunk(url, part, start, end):
    temporary = part.with_suffix(".partial")
    length = end - start + 1
    try:
        result = subprocess.run(
            [
                "curl", "--ipv4", "--fail", "--silent", "--show-error",
                "--proto", "=https", "--retry", "4", "--retry-all-errors",
                "--retry-delay", "2", "--retry-max-time", "420",
                "--connect-timeout", "10", "--max-time", "90",
                "--speed-limit", "1024", "--speed-time", "20",
                "--max-filesize", str(length), "--range", f"{start}-{end}",
                "--output", str(temporary), "--write-out", "%{http_code}",
                "--config", "-",
            ],
            input=f'url = "{url}"\n', capture_output=True, text=True,
        )
        status = result.stdout.strip()
        if result.returncode or status != "206":
            status = status if re.fullmatch(r"[0-9]{3}", status) else "unknown"
            raise RuntimeError(
                f"Download failed for bytes {start}-{end} "
                f"(curl exit {result.returncode}, HTTP {status})"
            )
        if temporary.stat().st_size != length:
            raise ValueError(f"Download returned the wrong size for bytes {start}-{end}")
        os.replace(temporary, part)
    finally:
        temporary.unlink(missing_ok=True)


def download_asset(api_url, archive, expected_hash, expected_size):
    parts = archive.parent / f".{archive.name}.{expected_hash}.chunks"
    if parts.is_symlink():
        raise ValueError("Download chunk directory must not be a symlink")
    parts.mkdir(mode=0o700, exist_ok=True)
    chunks = []
    for index, start in enumerate(range(0, expected_size, CHUNK_SIZE)):
        end = min(start + CHUNK_SIZE, expected_size) - 1
        part = parts / f"{index:06d}.part"
        if part.is_symlink():
            raise ValueError("Download chunk must not be a symlink")
        if part.exists() and (not part.is_file() or part.stat().st_size != end - start + 1):
            part.unlink()
        chunks.append((part, start, end))

    pending = [(part, start, end) for part, start, end in chunks if not part.exists()]
    completed = expected_size - sum(end - start + 1 for _, start, end in pending)
    if completed:
        print(f"Resuming release download: {completed}/{expected_size} bytes", flush=True)

    for attempt in range(2):
        if not pending:
            break
        url = asset_download_url(api_url)
        try:
            with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as pool:
                futures = {
                    pool.submit(fetch_chunk, url, part, start, end): (start, end)
                    for part, start, end in pending
                }
                try:
                    next_report = completed + 16 * 1024 * 1024
                    for future in as_completed(futures):
                        future.result()
                        start, end = futures[future]
                        completed += end - start + 1
                        if completed >= next_report or completed == expected_size:
                            print(f"Downloaded {completed}/{expected_size} bytes", flush=True)
                            next_report = completed + 16 * 1024 * 1024
                except Exception:
                    for future in futures:
                        future.cancel()
                    raise
        except (OSError, RuntimeError, ValueError) as error:
            if attempt:
                raise
            print(f"Download interrupted; retrying missing chunks: {error}", flush=True)
            pending = [(part, start, end) for part, start, end in chunks if not part.exists()]
            completed = expected_size - sum(end - start + 1 for _, start, end in pending)
        else:
            pending = []

    partial = archive.parent / f".{archive.name}.{os.getpid()}.part"
    try:
        with partial.open("xb") as output:
            for part, _, _ in chunks:
                with part.open("rb") as source:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
        try:
            verify_download(partial, expected_hash, expected_size)
        except ValueError:
            shutil.rmtree(parts)
            raise
        os.replace(partial, archive)
        shutil.rmtree(parts)
    finally:
        partial.unlink(missing_ok=True)


def read_release(path):
    with path.open(encoding="utf-8") as file:
        release = json.load(file)
    if not isinstance(release, dict) or release.get("draft") is not False or release.get("prerelease") is not False:
        raise ValueError("Latest release is not a published stable release")
    tag = release.get("tag_name")
    if not isinstance(tag, str) or not TAG_PATTERN.fullmatch(tag):
        raise ValueError("Latest release does not have a vX.Y.Z tag")
    name = f"family-tree-{tag}-linux-amd64.tar.gz"
    assets = release.get("assets")
    if not isinstance(assets, list):
        raise ValueError("Release asset list is invalid")
    matches = [asset for asset in assets if isinstance(asset, dict) and asset.get("name") == name]
    if len(matches) != 1 or matches[0].get("state") != "uploaded":
        raise ValueError(f"Release does not contain exactly one uploaded {name}")
    asset = matches[0]
    browser_url = f"https://github.com/{REPOSITORY}/releases/download/{tag}/{name}"
    if asset.get("browser_download_url") != browser_url:
        raise ValueError("Release asset URL does not match the expected repository")
    asset_id = asset.get("id")
    if not isinstance(asset_id, int) or isinstance(asset_id, bool) or asset_id <= 0:
        raise ValueError("Release asset ID is invalid")
    url = f"https://api.github.com/repos/{REPOSITORY}/releases/assets/{asset_id}"
    if asset.get("url") != url:
        raise ValueError("Release asset API URL does not match the expected repository")
    digest = asset.get("digest")
    size = asset.get("size")
    if not isinstance(digest, str) or not digest.startswith("sha256:") or not HASH_PATTERN.fullmatch(digest[7:]):
        raise ValueError("Release asset has no valid SHA-256 digest")
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        raise ValueError("Release asset has an invalid size")
    return tag, name, url, digest[7:], size


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_download(path, expected_hash, expected_size):
    if path.stat().st_size != expected_size or sha256(path) != expected_hash:
        raise ValueError(f"Release bundle failed size or SHA-256 validation: {path}")


def extract_bundle(archive, destination):
    extracted = set()
    with tarfile.open(archive, "r:gz") as bundle:
        for member in bundle:
            name = member.name
            while name.startswith("./"):
                name = name[2:]
            name = name.rstrip("/")
            if name in ("", ".", "scripts") and member.isdir():
                continue
            if name not in REQUIRED_FILES | OPTIONAL_FILES or not member.isfile() or name in extracted:
                raise ValueError(f"Unexpected or unsafe release archive entry: {member.name}")
            extracted.add(name)
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            source = bundle.extractfile(member)
            if source is None:
                raise ValueError(f"Cannot read release archive entry: {name}")
            with source, target.open("xb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
    if not REQUIRED_FILES.issubset(extracted):
        raise ValueError(f"Release bundle is missing files: {sorted(REQUIRED_FILES - extracted)}")
    if extracted & OPTIONAL_FILES and not OPTIONAL_FILES.issubset(extracted):
        raise ValueError("Release bundle contains an incomplete updater")
    return extracted


def verify_manifest(destination, extracted):
    checksums = {}
    with (destination / "SHA256SUMS").open(encoding="utf-8") as file:
        for line in file:
            match = re.fullmatch(r"([a-f0-9]{64}) [ *]([^\r\n]+)\n?", line)
            if not match or match[2] in checksums:
                raise ValueError("Invalid or duplicate release checksum")
            checksums[match[2]] = match[1]
    if set(checksums) != extracted - {"SHA256SUMS"}:
        raise ValueError("Release checksum manifest does not cover exactly the extracted files")
    for name, expected in checksums.items():
        if sha256(destination / name) != expected:
            raise ValueError(f"Release file checksum mismatch: {name}")


def update_puller(release, extracted):
    bin_dir = ROOT / "bin"
    bin_dir.mkdir(mode=0o700, exist_ok=True)
    for name in sorted(OPTIONAL_FILES & extracted):
        target = bin_dir / Path(name).name
        with tempfile.NamedTemporaryFile(dir=bin_dir, prefix=".update-", delete=False) as temporary:
            temporary_path = Path(temporary.name)
            try:
                with (release / name).open("rb") as source:
                    shutil.copyfileobj(source, temporary)
                temporary.flush()
                os.fchmod(temporary.fileno(), 0o700)
                os.replace(temporary_path, target)
            finally:
                temporary_path.unlink(missing_ok=True)


def main():
    os.umask(0o077)
    with (ROOT / "pull.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("Another release check is already running") from error

        with tempfile.TemporaryDirectory(prefix=".release-metadata-", dir=ROOT) as temporary:
            metadata = Path(temporary) / "release.json"
            fetch(API_URL, metadata, 60)
            tag, name, url, digest, size = read_release(metadata)

        image = f"family-tree:{tag[1:]}"
        current_file = ROOT / "current-image.txt"
        if current_file.exists():
            current = current_file.read_text(encoding="utf-8").strip()
            match = re.fullmatch(r"family-tree:(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", current)
            if not match:
                raise ValueError("Current image marker is invalid; refusing automatic deployment")
            current_version = tuple(map(int, match.groups()))
            latest_version = tuple(map(int, TAG_PATTERN.fullmatch(tag).groups()))
            if latest_version < current_version:
                raise ValueError(f"Latest release {tag} is older than deployed {current}; refusing downgrade")
            if current == image:
                print(f"{tag} is already deployed; checking local health", flush=True)
                subprocess.run(
                    ["curl", "--fail", "--silent", "--show-error", "--connect-timeout", "5",
                     "--max-time", "15", "http://127.0.0.1:3000/healthz"],
                    check=True,
                )
                return

        downloads = ROOT / "downloads"
        releases = ROOT / "releases"
        downloads.mkdir(mode=0o700, exist_ok=True)
        releases.mkdir(mode=0o700, exist_ok=True)
        archive = downloads / name
        if archive.exists():
            print(f"Verifying cached {name}", flush=True)
            verify_download(archive, digest, size)
        else:
            print(f"Downloading {name}", flush=True)
            download_asset(url, archive, digest, size)

        release = releases / f"{tag}-{time.time_ns()}-{os.getpid()}"
        release.mkdir(mode=0o700)
        extracted = extract_bundle(archive, release)
        verify_manifest(release, extracted)
        if (release / "image.txt").read_text(encoding="utf-8").strip() != image:
            raise ValueError("Release image does not match the selected version")
        print(f"Deploying {tag} from {release}", flush=True)
        subprocess.run(["bash", str(release / "scripts/deploy.sh"), str(release)], check=True)
        if current_file.read_text(encoding="utf-8").strip() != image:
            raise RuntimeError("Deployment did not record the expected current image")
        update_puller(release, extracted)
        archive.unlink()
        print(f"Release {tag} deployed successfully", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, tarfile.TarError, subprocess.CalledProcessError) as error:
        print(f"Release check failed: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
