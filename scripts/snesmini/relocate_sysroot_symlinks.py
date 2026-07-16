#!/usr/bin/env python3

import argparse
import os
from pathlib import Path


def main() -> None:
	parser = argparse.ArgumentParser()
	parser.add_argument("sysroot", type=Path)
	sysroot = parser.parse_args().sysroot.resolve()

	for directory, subdirectories, filenames in os.walk(sysroot, followlinks=False):
		for name in (*subdirectories, *filenames):
			link = Path(directory, name)
			if not link.is_symlink():
				continue
			target = Path(os.readlink(link))
			if not target.is_absolute():
				continue
			relocated = os.path.relpath(sysroot / target.relative_to("/"), link.parent)
			link.unlink()
			link.symlink_to(relocated)


if __name__ == "__main__":
	main()
