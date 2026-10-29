"""Produce the complete, zero-tailed 8 MiB programming image for U33.

The firmware payload is opaque: its BLua image header is not a flash-length
field. Image extent/fill belongs to the programming-image producer, as in
U-Boot binman's fixed-size images, not to the read datapath.
https://github.com/u-boot/u-boot/blob/master/tools/binman/etype/fill.py
"""

import argparse
import hashlib
import json
import shutil
from pathlib import Path

FLASH_BYTES = 8 * 1024 * 1024


def build_image(source: Path, destination: Path):
    with source.open("rb") as payload:
        payload_bytes = source.stat().st_size
        if payload_bytes > FLASH_BYTES:
            raise ValueError(f"Firmware occupies {payload_bytes} bytes; U33 holds {FLASH_BYTES}")
        with destination.open("xb") as image:
            shutil.copyfileobj(payload, image)
            zero_block = bytes(64 * 1024)
            remaining = FLASH_BYTES - payload_bytes
            while remaining:
                count = min(remaining, len(zero_block))
                image.write(zero_block[:count])
                remaining -= count
        payload.seek(0)
        source_sha256 = hashlib.file_digest(payload, "sha256").hexdigest()
    with destination.open("rb") as image:
        image_sha256 = hashlib.file_digest(image, "sha256").hexdigest()
    return {
        "source": str(source),
        "source_bytes": payload_bytes,
        "source_sha256": source_sha256,
        "image": str(destination),
        "image_bytes": FLASH_BYTES,
        "image_sha256": image_sha256,
        "zero_tail_bytes": FLASH_BYTES - payload_bytes,
    }


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("source", type=Path)
    cli.add_argument("destination", type=Path)
    args = cli.parse_args()
    print(json.dumps(build_image(args.source, args.destination), indent=2))


if __name__ == "__main__":
    main()
