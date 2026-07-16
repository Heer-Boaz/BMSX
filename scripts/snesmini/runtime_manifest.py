#!/usr/bin/env python3

from __future__ import annotations

import argparse
from hashlib import sha256
import os
from pathlib import Path
import stat


MANIFEST_NAME = ".bmsx-snesmini-runtime"
FORMAT = 2


def update_bytes(digest, value: bytes) -> None:
	digest.update(len(value).to_bytes(8, "big"))
	digest.update(value)


def update_entry(digest, root: Path, path: Path) -> None:
	metadata = path.lstat()
	relative = path.relative_to(root)
	update_bytes(digest, os.fsencode(relative.as_posix()))
	digest.update(stat.S_IMODE(metadata.st_mode).to_bytes(4, "big"))

	if stat.S_ISDIR(metadata.st_mode):
		digest.update(b"D")
		return
	if stat.S_ISLNK(metadata.st_mode):
		digest.update(b"L")
		update_bytes(digest, os.fsencode(os.readlink(path)))
		return
	if stat.S_ISREG(metadata.st_mode):
		digest.update(b"F")
		digest.update(metadata.st_size.to_bytes(8, "big"))
		with path.open("rb") as source:
			while chunk := source.read(1024 * 1024):
				digest.update(chunk)
		return
	if stat.S_ISCHR(metadata.st_mode):
		digest.update(b"C")
	elif stat.S_ISBLK(metadata.st_mode):
		digest.update(b"B")
	elif stat.S_ISFIFO(metadata.st_mode):
		digest.update(b"P")
	elif stat.S_ISSOCK(metadata.st_mode):
		digest.update(b"S")
	else:
		raise RuntimeError(f"unsupported runtime-root entry: {path}")
	digest.update(metadata.st_rdev.to_bytes(8, "big"))


def update_directory(digest, root: Path, directory: Path) -> None:
	for entry in sorted(os.scandir(directory), key=lambda item: os.fsencode(item.name)):
		path = Path(entry.path)
		if path.parent == root and path.name == MANIFEST_NAME:
			continue
		update_entry(digest, root, path)
		if entry.is_dir(follow_symlinks=False):
			update_directory(digest, root, path)


def tree_digest(root: Path) -> str:
	root = root.resolve()
	digest = sha256()
	update_entry(digest, root, root)
	update_directory(digest, root, root)
	return digest.hexdigest()


def manifest_text(root: Path) -> str:
	return f"format={FORMAT}\ntree_sha256={tree_digest(root)}\n"


def write_manifest(root: Path) -> None:
	manifest = root / MANIFEST_NAME
	temporary = root / f"{MANIFEST_NAME}.new"
	temporary.write_text(manifest_text(root), encoding="utf-8")
	temporary.replace(manifest)


def verify_manifest(root: Path) -> None:
	manifest = root / MANIFEST_NAME
	if manifest.read_text(encoding="utf-8") != manifest_text(root):
		raise RuntimeError(f"SNES Mini runtime root does not match {manifest}")


def main() -> None:
	parser = argparse.ArgumentParser()
	parser.add_argument("command", choices=("write", "verify"))
	parser.add_argument("root", type=Path)
	arguments = parser.parse_args()
	root = arguments.root.resolve()
	if arguments.command == "write":
		write_manifest(root)
	else:
		verify_manifest(root)


if __name__ == "__main__":
	main()
