#!/usr/bin/env python3

from hashlib import sha256
from pathlib import Path
import sys


RECIPE_FILES = (
	"scripts/snesmini/Dockerfile",
	"scripts/snesmini/bootstrap_sdk_sysroot.sh",
	"scripts/snesmini/jessie-packages.sha256",
	"scripts/snesmini/relocate_sysroot_symlinks.py",
	"scripts/snesmini/sdk_recipe_id.py",
)


def main() -> int:
	root = Path(sys.argv[1])
	recipe = sha256()
	for relative_path in RECIPE_FILES:
		recipe.update(sha256((root / relative_path).read_bytes()).digest())
	print(recipe.hexdigest())
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
