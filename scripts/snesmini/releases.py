"""Native release publication and reachability-based collection."""

import argparse
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import uuid


def collect_releases(root: Path, apply: bool) -> dict:
    releases = root / "releases"
    retained = set()
    roots = [root / "current", root / "debug", *(root / "pins").glob("*")]
    for link in roots:
        if link.is_symlink():
            retained.add(link.resolve(strict=True).relative_to(releases).parts[0])
    removed, kept = [], []
    for release in sorted(releases.iterdir()):
        if release.name in retained:
            kept.append(release.name)
        else:
            removed.append(release.name)
            if apply:
                shutil.rmtree(release)
    return {"retained": kept, "removed": removed, "applied": apply}


def publish_release(root: Path, stage: Path, build_type: str) -> str:
    release_id = hashlib.sha256((stage / "acceptance.txt").read_bytes()).hexdigest()
    destination = root / "releases" / release_id
    if destination.exists():
        shutil.rmtree(stage)
    else:
        stage.rename(destination)
    channel = "current" if build_type == "Release" else "debug"
    pending = root / f".{channel}.{uuid.uuid4().hex}"
    pending.symlink_to(Path("releases") / release_id)
    pending.replace(root / channel)
    return channel


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    publish = commands.add_parser("publish")
    publish.add_argument("root", type=Path)
    publish.add_argument("stage", type=Path)
    publish.add_argument("build_type", choices=["Release", "Debug"])
    collect = commands.add_parser("collect")
    collect.add_argument("root", type=Path)
    collect.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    (root / "releases").mkdir(parents=True, exist_ok=True)
    with (root / ".publish.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.command == "publish":
            channel = publish_release(root, args.stage, args.build_type)
            print(f"SNES Mini release accepted: {root / channel}", flush=True)
            result = collect_releases(root, True)
        else:
            result = collect_releases(root, args.apply)
        print(json.dumps(result))


if __name__ == "__main__":
    main()
