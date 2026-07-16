#!/usr/bin/env python3

from hashlib import sha256
from pathlib import Path
import sys


TOOLCHAIN_FILES = (
	"Makefile",
	"machine/cpp/cmake/toolchains/snesmini.cmake",
	"scripts/snesmini/build.sh",
	"scripts/snesmini/toolchain_id.py",
)


def main() -> int:
	root = Path(sys.argv[1])
	identity = sha256()
	identity.update((root / ".snesmini/sdk-sysroot/.bmsx-snesmini-sdk").read_bytes())
	for relative_path in TOOLCHAIN_FILES:
		identity.update(sha256((root / relative_path).read_bytes()).digest())
	print(identity.hexdigest())
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
