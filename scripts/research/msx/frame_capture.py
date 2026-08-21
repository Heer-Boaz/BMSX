from pathlib import Path


def write_rgb24_ppm(
    path: Path,
    width: int,
    height: int,
    pixels: bytes | bytearray,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as output:
        output.write(f"P6\n{width} {height}\n255\n".encode("ascii"))
        output.write(pixels)
