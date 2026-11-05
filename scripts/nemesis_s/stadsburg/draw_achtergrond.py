#!/usr/bin/env python3
"""Draw the opposite bank directly on Stadsburg's native two-ink grid.

The distant architecture shares a five-pixel storey and a ground line at 132.
Whole roof and wall planes carry the silhouette; black cuts describe openings
and shadow. These are authored pixels, not resized foreground drawings.

Triton's themed source drawings and exact 8x1 pattern/colour representation:
https://github.com/santiontanon/triton/tree/master/java/src
"""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[3]
ART = ROOT / 'carts/nemesis_s/authoring/achtergrond'
SIZE = (512, 160)
BLACK = (0, 0, 0)
BLUE = (32, 32, 224)
STOREY = 5
GROUND = 132


def house(draw, x, width, floors, roof, *, ground=GROUND, chimney=False):
    """A complete small facade: five-pixel storeys and two-pixel window bays."""
    top = ground - floors * STOREY
    right = x + width - 1
    middle = x + width // 2
    draw.rectangle((x, top, right, ground - 1), fill=BLUE)
    # The unlit return belongs to the same volume, not a second outlined box.
    draw.rectangle((right - 1, top + 1, right, ground - 1), fill=BLACK)
    if roof == 'step':
        draw.polygon([(x, top), (x, top - 2), (x + 2, top - 2),
                      (x + 2, top - 4), (middle - 1, top - 4),
                      (middle - 1, top - 6), (middle + 1, top - 6),
                      (middle + 1, top - 4), (right - 2, top - 4),
                      (right - 2, top - 2), (right, top - 2),
                      (right, top)], fill=BLUE)
        draw.point((middle, top - 3), fill=BLACK)
    elif roof == 'point':
        draw.polygon([(x - 1, top), (middle, top - 6),
                      (right + 1, top)], fill=BLUE)
        draw.line([(middle + 1, top - 4), (right - 1, top - 1)], fill=BLACK)
        draw.point((middle - 1, top - 2), fill=BLACK)
    elif roof == 'hip':
        draw.polygon([(x - 1, top - 1), (x + 3, top - 5),
                      (right - 3, top - 5), (right + 1, top - 1)], fill=BLUE)
        draw.polygon([(x + 3, top - 3), (right - 3, top - 3),
                      (right, top - 1), (x + 1, top - 1)], fill=BLACK)
    else:
        draw.rectangle((x - 1, top - 2, right, top - 1), fill=BLUE)
        draw.line((x, top, right, top), fill=BLACK)
    if chimney:
        chimney_foot = top - (2 if roof == 'flat' else 4)
        draw.rectangle((right - 3, chimney_foot - 3, right - 2, chimney_foot), fill=BLUE)
    columns = [x + 2] if width < 11 else [x + 2, x + 7]
    for floor in range(floors):
        y = top + floor * STOREY + 1
        for column in columns:
            draw.rectangle((column, y, column + 1, y + 1), fill=BLACK)
    draw.rectangle((x + 2, ground - 3, x + 3, ground - 1), fill=BLACK)
    if floors >= 3:
        draw.line((x + 1, top + STOREY * (floors - 1) - 1,
                   x + min(width - 4, 5), top + STOREY * (floors - 1) - 1), fill=BLACK)


def bank(draw, left, right, top=GROUND):
    """One far-bank footing, with a quiet dark return beneath its cap."""
    draw.rectangle((left, top, right, top + 1), fill=BLUE)
    for x in range(left + 3, right - 2, 13):
        draw.rectangle((x, top + 2, min(x + 6, right), top + 3), fill=BLUE)


def church(draw, x):
    # Bell opening, shaft and nave follow the same scale as nearby houses.
    draw.rectangle((x + 2, 108, x + 10, GROUND - 1), fill=BLUE)
    draw.rectangle((x + 9, 112, x + 10, GROUND - 1), fill=BLACK)
    draw.rectangle((x, 111, x + 11, 112), fill=BLUE)
    draw.rectangle((x + 4, 109, x + 5, 111), fill=BLACK)
    draw.rectangle((x + 8, 109, x + 8, 111), fill=BLACK)
    draw.polygon([(x + 1, 107), (x + 6, 94), (x + 11, 107)], fill=BLUE)
    draw.line((x + 7, 98, x + 9, 106), fill=BLACK)
    draw.line((x + 6, 91, x + 6, 95), fill=BLUE)
    draw.line((x + 5, 93, x + 7, 93), fill=BLUE)
    draw.rectangle((x + 4, 117, x + 5, 120), fill=BLACK)
    draw.rectangle((x + 4, 128, x + 6, 131), fill=BLACK)
    draw.rectangle((x + 11, 123, x + 35, 131), fill=BLUE)
    draw.polygon([(x + 10, 122), (x + 17, 116),
                  (x + 29, 116), (x + 36, 122)], fill=BLUE)
    draw.polygon([(x + 18, 118), (x + 28, 118),
                  (x + 33, 122), (x + 14, 122)], fill=BLACK)
    for window in (x + 15, x + 22, x + 29):
        draw.rectangle((window, 125, window + 1, 128), fill=BLACK)
    draw.rectangle((x + 34, 124, x + 35, 131), fill=BLACK)


def winterstad(draw):
    # Dark alleys separate blocks; columns 0 and 336 are open scene joins.
    for x, width, floors, roof, stack in (
        (8, 11, 3, 'point', False), (21, 13, 2, 'hip', True),
        (36, 10, 4, 'flat', False),
        (60, 12, 3, 'step', False), (74, 10, 3, 'point', False),
        (86, 13, 2, 'hip', True),
        (110, 10, 4, 'flat', True), (122, 13, 3, 'step', False),
        (150, 13, 2, 'hip', False), (165, 10, 4, 'point', False),
        (177, 12, 3, 'step', False), (191, 10, 3, 'flat', False),
        (216, 13, 3, 'hip', True), (231, 10, 4, 'point', False),
        (243, 12, 3, 'step', False), (258, 10, 2, 'flat', False),
        (282, 12, 3, 'step', False), (296, 10, 4, 'point', False),
        (308, 13, 2, 'hip', True),
        (400, 12, 3, 'point', False), (414, 13, 3, 'hip', True),
        (429, 10, 4, 'flat', False), (441, 12, 3, 'step', False),
        (468, 10, 3, 'point', False), (480, 13, 2, 'hip', True),
        (495, 10, 3, 'flat', False),
    ):
        house(draw, x, width, floors, roof, chimney=stack)
    church(draw, 361)
    for left, right in ((5, 48), (57, 101), (107, 138), (147, 203),
                        (213, 270), (279, 324), (358, 455), (465, 508)):
        bank(draw, left, right)


def hall(draw, x, width, *, sawtooth=False, height=10):
    """Industrial bays are two storeys tall; piers keep a long shed legible."""
    top = GROUND - height
    right = x + width - 1
    draw.rectangle((x, top, right, GROUND - 1), fill=BLUE)
    draw.rectangle((right - 1, top + 1, right, GROUND - 1), fill=BLACK)
    if sawtooth:
        for left in range(x, right - 5, 8):
            draw.polygon([(left, top - 1), (left + 6, top - 6),
                          (left + 6, top - 1)], fill=BLUE)
            draw.line((left + 4, top - 3, left + 5, top - 3), fill=BLACK)
    else:
        draw.polygon([(x - 1, top - 1), (x + 4, top - 6),
                      (right - 4, top - 6), (right + 1, top - 1)], fill=BLUE)
        draw.polygon([(x + 5, top - 4), (right - 4, top - 4),
                      (right - 1, top - 1), (x + 2, top - 1)], fill=BLACK)
    for left in range(x + 3, right - 3, 7):
        draw.rectangle((left, top + 3, left + 3, GROUND - 2), fill=BLACK)
        draw.line((left, top + 1, left + 2, top + 1), fill=BLACK)


def stack(draw, x, top, base):
    draw.rectangle((x, top, x + 3, top + 1), fill=BLUE)
    draw.rectangle((x + 1, top + 2, x + 3, base), fill=BLUE)
    draw.line((x + 3, top + 3, x + 3, base), fill=BLACK)
    draw.point((x + 1, top + 7), fill=BLACK)


def bridge(draw, x, width):
    draw.rectangle((x, 128, x + width - 1, 132), fill=BLUE)
    draw.polygon([(x + 3, 132), (x + 6, 129),
                  (x + width - 7, 129), (x + width - 4, 132),
                  (x + width - 4, 137), (x + 3, 137)], fill=BLACK)
    draw.line((x, 126, x + width - 1, 126), fill=BLUE)
    for post in range(x + 1, x + width, 5):
        draw.line((post, 126, post, 128), fill=BLUE)
    draw.rectangle((x, 133, x + 2, 135), fill=BLUE)
    draw.rectangle((x + width - 3, 133, x + width - 1, 135), fill=BLUE)


def crane(draw, x, *, ground=GROUND):
    draw.polygon([(x, ground - 1), (x + 4, ground - 17),
                  (x + 7, ground - 17), (x + 11, ground - 1)], fill=BLUE)
    draw.polygon([(x + 2, ground - 2), (x + 5, ground - 13),
                  (x + 6, ground - 13), (x + 9, ground - 2)], fill=BLACK)
    draw.rectangle((x + 2, ground - 21, x + 9, ground - 16), fill=BLUE)
    draw.rectangle((x + 3, ground - 20, x + 6, ground - 18), fill=BLACK)
    draw.polygon([(x + 6, ground - 22), (x + 27, ground - 33),
                  (x + 29, ground - 31), (x + 8, ground - 19)], fill=BLUE)
    draw.line((x + 11, ground - 23, x + 25, ground - 30), fill=BLACK)
    draw.line((x + 27, ground - 30, x + 27, ground - 18), fill=BLUE)
    draw.line([(x + 27, ground - 18), (x + 25, ground - 16),
               (x + 24, ground - 17)], fill=BLUE)


def hijswerf(draw):
    # Cuts 128, 392 and 440 fall in passages, never through a hall.
    house(draw, 8, 12, 3, 'step')
    hall(draw, 24, 32, height=10)
    stack(draw, 43, 103, 115)
    bridge(draw, 59, 24)
    hall(draw, 87, 31, sawtooth=True)
    house(draw, 140, 11, 4, 'flat')
    hall(draw, 155, 37, height=10)
    stack(draw, 177, 97, 115)
    hall(draw, 196, 23, height=10)
    bridge(draw, 224, 30)
    hall(draw, 264, 40, sawtooth=True)
    house(draw, 308, 13, 3, 'step')
    hall(draw, 326, 24, height=10)
    crane(draw, 355)
    house(draw, 402, 12, 3, 'hip', chimney=True)
    house(draw, 418, 11, 3, 'step')
    hall(draw, 452, 29, sawtooth=True)
    house(draw, 485, 12, 2, 'hip')
    for left, right in ((5, 57), (85, 120), (137, 220),
                        (261, 351), (354, 386), (399, 432), (449, 501)):
        bank(draw, left, right)
    for left, y, right in ((13, 138, 22), (101, 138, 112), (152, 139, 160),
                           (279, 138, 290), (335, 139, 342), (467, 138, 478)):
        draw.line((left, y, right, y), fill=BLUE)


def boat(draw, x, *, sailing=False):
    """A distant vessel with a compact cabin and a substantial readable hull."""
    width = 38 if sailing else 46
    bow = x + width - 1
    draw.polygon([(x, 130), (x + 6, 132), (bow - 7, 132), (bow, 128),
                  (bow - 2, 133), (bow - 7, 136), (x + 7, 136),
                  (x + 2, 133)], fill=BLUE)
    draw.line((x + 7, 134, bow - 8, 134), fill=BLACK)
    draw.line((bow - 6, 133, bow - 3, 131), fill=BLACK)
    draw.rectangle((x + 10, 127, bow - 11, 130), fill=BLUE)
    draw.line((x + 12, 129, bow - 12, 129), fill=BLACK)
    if sailing:
        mast = x + 17
        draw.line((mast, 107, mast, 131), fill=BLUE)
        draw.line((mast, 111, x + 4, 129), fill=BLUE)
        draw.line((mast + 1, 114, bow - 3, 130), fill=BLUE)
        draw.line((mast, 107, mast + 3, 109), fill=BLUE)
    else:
        draw.rectangle((bow - 13, 123, bow - 8, 130), fill=BLUE)
        draw.rectangle((bow - 12, 124, bow - 9, 125), fill=BLACK)
        draw.line((x + 18, 117, x + 18, 126), fill=BLUE)
        draw.line((x + 18, 118, x + 30, 126), fill=BLUE)
    draw.line((x + 9, 139, x + 21, 139), fill=BLUE)
    draw.line((bow - 18, 141, bow - 8, 141), fill=BLUE)


def haven(draw):
    # Repeat and scene cuts at 8,64,128,152,192 remain in dark water.
    house(draw, 18, 12, 3, 'step')
    house(draw, 33, 11, 3, 'point')
    house(draw, 47, 10, 2, 'flat')
    house(draw, 77, 13, 3, 'hip', chimney=True)
    house(draw, 93, 11, 4, 'point')
    house(draw, 107, 12, 3, 'step')
    house(draw, 155, 9, 2, 'flat')
    house(draw, 166, 12, 3, 'hip')
    house(draw, 181, 9, 2, 'point')
    boat(draw, 207)
    house(draw, 271, 11, 4, 'step')
    hall(draw, 286, 25, height=10)
    house(draw, 315, 12, 3, 'point')
    house(draw, 330, 13, 3, 'hip', chimney=True)
    boat(draw, 360, sailing=True)
    hall(draw, 415, 31, sawtooth=True)
    crane(draw, 456)
    for left, right in ((15, 59), (74, 122), (153, 191),
                        (268, 346), (412, 450), (453, 492)):
        bank(draw, left, right)
    for left, y, right in ((21, 139, 29), (44, 137, 53), (79, 138, 88),
                           (105, 140, 114), (169, 138, 177), (275, 139, 284),
                           (302, 138, 312), (332, 140, 342),
                           (422, 139, 432), (460, 138, 469), (480, 140, 488)):
        draw.line((left, y, right, y), fill=BLUE)


def main():
    ART.mkdir(exist_ok=True)
    for name, draw_scene in (('winterstad', winterstad), ('hijswerf', hijswerf), ('haven', haven)):
        image = Image.new('RGB', SIZE, BLACK)
        draw_scene(ImageDraw.Draw(image))
        target = ART / f'{name}.png'
        image.save(target)
        print(target.relative_to(ROOT))


if __name__ == '__main__':
    main()
