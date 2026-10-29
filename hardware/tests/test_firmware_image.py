"""Programming images preserve payload bytes and program every unused cell to zero."""

import tempfile
import unittest
from pathlib import Path

from tools.firmware_image import FLASH_BYTES, build_image


class FirmwareImageTest(unittest.TestCase):
    def test_unaligned_payload_and_zero_tail(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "firmware.rom"
            image = Path(directory) / "u33.bin"
            payload = bytes(range(256)) * 257 + b"\xa5\x71\x39"
            source.write_bytes(payload)
            report = build_image(source, image)
            self.assertEqual(source.read_bytes(), payload)
            with image.open("rb") as stream:
                self.assertEqual(stream.read(len(payload)), payload)
                self.assertEqual(stream.read(), bytes(FLASH_BYTES - len(payload)))
            self.assertEqual(image.stat().st_size, FLASH_BYTES)
            self.assertEqual(report["zero_tail_bytes"], FLASH_BYTES - len(payload))

    def test_exact_capacity_and_empty_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "firmware.rom"
            for size in (0, FLASH_BYTES):
                with source.open("wb") as stream:
                    stream.truncate(size)
                image = Path(directory) / f"u33-{size}.bin"
                report = build_image(source, image)
                self.assertEqual(image.read_bytes(), bytes(FLASH_BYTES))
                self.assertEqual(report["zero_tail_bytes"], FLASH_BYTES - size)

    def test_oversize_is_not_truncated_and_existing_image_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "firmware.rom"
            image = Path(directory) / "u33.bin"
            with source.open("wb") as stream:
                stream.truncate(FLASH_BYTES + 1)
            with self.assertRaises(ValueError):
                build_image(source, image)
            self.assertFalse(image.exists())
            self.assertEqual(source.stat().st_size, FLASH_BYTES + 1)
            source.write_bytes(b"payload")
            image.write_bytes(b"preserved original")
            with self.assertRaises(FileExistsError):
                build_image(source, image)
            self.assertEqual(image.read_bytes(), b"preserved original")
            with self.assertRaises(FileExistsError):
                build_image(source, source)
            self.assertEqual(source.read_bytes(), b"payload")


if __name__ == "__main__":
    unittest.main()
