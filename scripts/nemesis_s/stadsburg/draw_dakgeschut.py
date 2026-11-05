#!/usr/bin/env python3
"""Draw the roof weapons directly on their 24x16 native pixel canvas."""
from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[3] / 'carts/nemesis_s/res/img'
CLEAR = (0, 0, 0, 0)
BLACK = (0, 0, 0, 255)
WHITE = (224, 224, 224, 255)
GRAY = (160, 160, 160, 255)
BLUE = (32, 32, 224, 255)
LIGHT_BLUE = (64, 96, 224, 255)
CYAN = (64, 192, 224, 255)
RED = (224, 32, 32, 255)
YELLOW = (192, 192, 32, 255)


def body():
    image = Image.new('RGBA', (24, 16), CLEAR)
    draw = ImageDraw.Draw(image)
    # The twenty-pixel foot and two buttresses sit on one fixed roof line.
    draw.rectangle((2, 12, 21, 15), fill=BLUE)
    for left in (2, 18):
        draw.rectangle((left, 8, left + 3, 15), fill=GRAY)
        draw.line((left, 9, left, 14), fill=WHITE)
        draw.line((left + 1, 10, left + 1, 13), fill=RED)
        draw.line((left, 8, left + 3, 8), fill=WHITE)
        draw.line((left, 15, left + 3, 15), fill=WHITE)
    draw.line((6, 14, 9, 14), fill=LIGHT_BLUE)
    draw.line((13, 12, 16, 12), fill=LIGHT_BLUE)
    draw.point((16, 15), fill=BLACK)

    draw.polygon(((6, 3), (8, 1), (15, 1), (17, 3),
                  (17, 8), (15, 11), (8, 11), (6, 8)), fill=GRAY)
    draw.line((7, 4, 7, 8, 9, 10, 14, 10, 16, 8, 16, 4), fill=BLACK)
    draw.line((6, 4, 6, 7), fill=WHITE)
    draw.line((17, 4, 17, 7), fill=WHITE)
    draw.line((8, 11, 15, 11), fill=WHITE)

    # Snowy shoulders, cyan armor seams and red hinge pins remain readable.
    draw.line((4, 4, 6, 2, 8, 2), fill=WHITE)
    draw.line((15, 2, 17, 2, 19, 4), fill=WHITE)
    draw.line((4, 5, 7, 5), fill=CYAN)
    draw.line((16, 5, 19, 5), fill=CYAN)
    draw.line((4, 6, 4, 7), fill=GRAY)
    draw.line((19, 6, 19, 7), fill=GRAY)
    draw.point((6, 8), fill=RED)
    draw.point((17, 8), fill=RED)
    draw.rectangle((8, 3, 15, 8), fill=BLACK)
    draw.rectangle((9, 4, 14, 8), fill=GRAY)
    draw.line((9, 4, 9, 7), fill=WHITE)
    draw.line((14, 4, 14, 8), fill=BLACK)
    draw.line((10, 8, 13, 8), fill=BLACK)
    draw.line((8, 3, 15, 3), fill=RED)
    return image


def laser(state):
    image = body()
    draw = ImageDraw.Draw(image)
    draw.rectangle((8, 0, 15, 2), fill=YELLOW)
    draw.line((9, 0, 14, 0), fill=WHITE)
    draw.line((9, 1, 14, 1), fill=BLACK if state != 'closed' else GRAY)
    if state == 'opening':
        draw.line((10, 6, 13, 6), fill=YELLOW)
    elif state == 'open':
        draw.rectangle((9, 4, 14, 8), fill=BLACK)
        draw.line((10, 8, 13, 8), fill=YELLOW)
    elif state == 'fill':
        draw.rectangle((9, 6, 14, 8), fill=YELLOW)
        draw.line((11, 7, 12, 7), fill=WHITE)
    elif state == 'pulse':
        draw.rectangle((9, 4, 14, 8), fill=YELLOW)
        draw.rectangle((11, 4, 12, 8), fill=WHITE)
    elif state == 'charged':
        draw.rectangle((8, 3, 15, 8), fill=YELLOW)
        draw.rectangle((10, 3, 13, 8), fill=WHITE)
    elif state in ('channel', 'firing'):
        # The first upward ray tile overlaps rows 0..3 of this exact aperture.
        for x, ink in enumerate((RED, YELLOW, WHITE, WHITE, WHITE, WHITE, YELLOW, RED), 8):
            draw.line((x, 0, x, 8), fill=ink)
        if state == 'firing':
            draw.line((7, 6, 7, 7), fill=YELLOW)
            draw.line((16, 6, 16, 7), fill=YELLOW)
    return image


def smoke(opened):
    image = body()
    draw = ImageDraw.Draw(image)
    draw.rectangle((8, 0, 15, 2), fill=CYAN)
    draw.line((9, 0, 14, 0), fill=WHITE)
    draw.line((9, 1, 14, 1), fill=BLACK if opened else BLUE)
    if not opened:
        draw.line((11, 0, 12, 2), fill=BLACK)
    else:
        draw.rectangle((9, 2, 14, 4), fill=BLACK)
    return image


def wreck():
    image = Image.new('RGBA', (16, 8), CLEAR)
    draw = ImageDraw.Draw(image)
    draw.polygon(((1, 4), (4, 3), (5, 5), (8, 4), (10, 6),
                  (12, 4), (14, 5), (15, 7), (0, 7)), fill=GRAY)
    draw.rectangle((2, 1, 4, 5), fill=GRAY)
    draw.line((2, 0, 4, 0), fill=LIGHT_BLUE)
    draw.point((3, 2), fill=CYAN)
    draw.line((5, 5, 7, 6), fill=BLACK)
    draw.point((12, 6), fill=BLACK)
    draw.line((0, 7, 15, 7), fill=BLUE)
    draw.line((1, 7, 4, 7), fill=LIGHT_BLUE)
    draw.line((9, 7, 12, 7), fill=LIGHT_BLUE)
    return image


def main():
    drawings = {
        'schoorsteen_foe_1': laser('closed'),
        'schoorsteen_foe_2': laser('opening'),
        'schoorsteen_foe_3': laser('open'),
        'schoorsteen_foe_4': laser('pulse'),
        'schoorsteen_foe_5': laser('charged'),
        'rook_generator_closed': smoke(False),
        'rook_generator_open': smoke(True),
        'stadsburg_dakgeschut_wrak': wreck(),
    }
    for state in ('fill', 'pulse', 'charged', 'channel', 'firing'):
        drawings[f'stadsburg_laser_{state}'] = laser(state)
    for name, drawing in drawings.items():
        drawing.save(ROOT / f'{name}@atlas=gameplay.png')


if __name__ == '__main__':
    main()
