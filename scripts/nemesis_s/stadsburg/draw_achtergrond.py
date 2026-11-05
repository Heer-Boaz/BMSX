#!/usr/bin/env python3
"""Assemble Stadsburg's authored architecture on its native two-ink grid.

architectuur.png owns whole buildings: facade, roof, openings and bearing
corners are painted together. ontwerp.yaml places those exact drawings in
blocks on the opposite bank. No roof generator or image resampling is used.

The themed source-art pipeline follows the native-grid approach in Triton:
https://github.com/santiontanon/triton/tree/master/java/src
"""
from pathlib import Path

import yaml
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[3]
ART = ROOT / 'carts/nemesis_s/authoring/achtergrond'
BLUE = (32, 32, 224)


def main():
    design = yaml.safe_load((ART / 'ontwerp.yaml').read_text())
    atlas = Image.open(ART / design['atlas']).convert('RGB')
    pieces = {name: atlas.crop((x, y, x + w, y + h))
              for name, (x, y, w, h) in design['pieces'].items()}
    for name, scene in design['scenes'].items():
        image = Image.new('RGB', tuple(scene['size']))
        draw = ImageDraw.Draw(image)
        for left, right in scene['banks']:
            draw.rectangle((left, 132, right, 134), fill=BLUE)
            for x in range(left + 7, right - 3, 17):
                draw.line((x, 133, x, 134), fill='black')
        for placement in scene['objects']:
            asset, x, *foot = placement
            ground = foot[0] if foot else 132
            piece = pieces[asset]
            image.paste(piece, (x, ground - piece.height))
        for left, y, right in scene['reflections']:
            draw.line((left, y, right, y), fill=BLUE)
        target = ART / f'{name}.png'
        image.save(target)
        print(target.relative_to(ROOT))


if __name__ == '__main__':
    main()
