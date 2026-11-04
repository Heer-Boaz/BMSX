#!/usr/bin/env python3
"""Draw the native winter-night backdrops from their authored pixel geometry.

These are new, two-ink drawings; no existing artwork is sampled or recoloured.
The PNGs are editable sources for bake_achtergrond.py. Regenerating them restores
the geometry below. Collision and placement belong to the level compiler.

The Menace from Triton's GenerateTileSets.java and
PNGtoMSX/ConvertPatternsToAssembler.java were studied for its separate themed
source drawings and exact 8x1 pattern/colour representation:
https://github.com/santiontanon/triton/tree/master/java/src
"""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[3]
ART = ROOT / 'carts/nemesis_s/authoring/achtergrond'
SIZE = (512, 160)
BLACK = (0, 0, 0)
BLUE = (32, 32, 224)
WALL_PATTERN = (0b11000000, 0b01000000, 0b00001100, 0b00000100)
CLOUD_PATTERN = (0b11000000, 0b11000000, 0b00001100, 0b00001100)


def line(image, points):
    ImageDraw.Draw(image).line(points, fill=BLUE)


def wall(image, outline, *, courses=(), windows=(), phase=0):
    """A dark built surface with clustered texture and an upper-edge highlight."""
    mask = Image.new('1', SIZE)
    ImageDraw.Draw(mask).polygon(outline, fill=1)
    left, top, right, bottom = mask.getbbox()
    pixels = image.load()
    ink = mask.load()
    # Clustered blue masonry gives the silhouette weight; black stays dominant.
    # The upper roof/wall has more body than its dark lower foundation.
    for y in range(top, bottom):
        pattern = CLOUD_PATTERN if y < top + 8 else WALL_PATTERN
        for x in range(left, right):
            if ink[x, y] and pattern[(y - top) % 4] & (128 >> ((x + phase) % 8)):
                pixels[x, y] = BLUE
    # Only the roof catches light. Closed rectangular outlines look too near.
    for x in range(left, right):
        for y in range(top, bottom):
            if ink[x, y]:
                if (x + phase) % 8 < 5:
                    pixels[x, y] = BLUE
                break
    for x0, y, x1 in courses:
        line(image, [(x0, y), (x1, y)])
    draw = ImageDraw.Draw(image)
    for x, y, width, height in windows:
        draw.rectangle((x, y, x + width - 1, y + height - 1), fill=BLACK)
        line(image, [(x - 1, y + height), (x + width, y + height)])


def cloud(image, x, y, width, profile):
    """Low stratus masses with native two-pixel clusters and broken undersides."""
    outline = [(x + px, y + py) for px, py in profile]
    mask = Image.new('1', SIZE)
    ImageDraw.Draw(mask).polygon(outline, fill=1)
    ink = mask.load()
    pixels = image.load()
    left, top, right, bottom = mask.getbbox()
    for yy in range(top, bottom):
        for xx in range(left, right):
            if ink[xx, yy] and CLOUD_PATTERN[(yy - y) % 4] & (128 >> ((xx - x) % 8)):
                pixels[xx, yy] = BLUE
    # Longer connected bodies anchor the clustered mist, avoiding laser dashes.
    base = max(py for _, py in profile)
    for start, length, row in ((width // 5, width // 4, base - 3),
                              (width * 3 // 5, width // 5, base - 2),
                              (width // 3, width // 5, base)):
        for xx in range(x + start, x + start + length):
            if ink[xx, y + row]:
                pixels[xx, y + row] = BLUE


def winter_clouds(image, variant):
    if variant == 'city':
        cloud(image, 17, 52, 128, [(0, 9), (13, 9), (13, 6), (27, 6),
              (27, 4), (45, 4), (45, 1), (68, 1), (68, 3), (83, 3),
              (83, 5), (102, 5), (102, 8), (128, 8), (119, 12), (12, 12)])
        cloud(image, 215, 65, 81, [(0, 5), (16, 5), (16, 2), (35, 2),
              (35, 0), (48, 0), (48, 3), (63, 3), (63, 5), (81, 5),
              (74, 9), (6, 9)])
        cloud(image, 354, 48, 131, [(0, 10), (18, 10), (18, 7), (42, 7),
              (42, 4), (60, 4), (60, 2), (78, 2), (78, 3), (98, 3),
              (98, 7), (117, 7), (117, 9), (131, 9), (122, 13), (9, 13)])
    elif variant == 'wharf':
        cloud(image, 9, 56, 107, [(0, 7), (17, 7), (17, 4), (31, 4),
              (31, 1), (56, 1), (56, 3), (78, 3), (78, 5), (107, 5),
              (96, 10), (7, 10)])
        cloud(image, 190, 48, 145, [(0, 9), (22, 9), (22, 5), (51, 5),
              (51, 2), (77, 2), (77, 4), (97, 4), (97, 6), (119, 6),
              (119, 8), (145, 8), (134, 12), (13, 12)])
        cloud(image, 399, 65, 95, [(0, 5), (20, 5), (20, 2), (38, 2),
              (38, 0), (57, 0), (57, 3), (77, 3), (77, 5), (95, 5),
              (85, 9), (8, 9)])
    else:
        cloud(image, 42, 56, 156, [(0, 10), (22, 10), (22, 7), (49, 7),
              (49, 4), (67, 4), (67, 2), (89, 2), (89, 5), (111, 5),
              (111, 8), (139, 8), (139, 10), (156, 10), (144, 13), (13, 13)])
        cloud(image, 310, 63, 135, [(0, 6), (21, 6), (21, 4), (45, 4),
              (45, 1), (64, 1), (64, 3), (91, 3), (91, 5), (116, 5),
              (116, 7), (135, 7), (126, 11), (9, 11)])


def winterstad():
    image = Image.new('RGB', SIZE, BLACK)
    winter_clouds(image, 'city')
    # First roof group: a low quay roof, a bell gable, and a broad house.
    wall(image, [(0, 138), (18, 138), (24, 133), (39, 133), (45, 138),
         (57, 138), (57, 143), (0, 143)], phase=3)
    wall(image, [(57, 143), (57, 124), (61, 124), (61, 120), (64, 120),
         (64, 116), (68, 116), (68, 113), (73, 113), (73, 116), (77, 116),
         (77, 120), (80, 120), (80, 124), (84, 124), (84, 143)],
         courses=[(61, 127, 79)], windows=[(64, 129, 3, 4), (74, 129, 3, 4)])
    wall(image, [(87, 143), (87, 133), (96, 124), (117, 124), (126, 133),
         (126, 143)], windows=[(95, 134, 4, 3), (108, 134, 4, 3)], phase=5)
    wall(image, [(101, 123), (101, 119), (104, 119), (104, 123)], phase=2)
    line(image, [(101, 123), (101, 119), (104, 119), (104, 123)])
    # Unequal middle roofs, with a narrow stepped gable between broad surfaces.
    wall(image, [(165, 143), (165, 130), (172, 130), (181, 122), (199, 122),
         (207, 130), (213, 130), (213, 143)],
         courses=[(171, 132, 206)], windows=[(176, 134, 3, 3), (190, 134, 3, 3)])
    wall(image, [(214, 143), (214, 122), (218, 122), (218, 118), (222, 118),
         (222, 114), (226, 114), (226, 110), (230, 110), (230, 114),
         (234, 114), (234, 118), (238, 118), (238, 122), (241, 122), (241, 143)],
         courses=[(218, 125, 237)], windows=[(221, 128, 3, 4), (231, 128, 3, 4)])
    wall(image, [(245, 143), (245, 133), (253, 128), (278, 128), (287, 133),
         (304, 133), (304, 143)], phase=6,
         windows=[(253, 135, 4, 3), (268, 135, 4, 3), (291, 136, 3, 2)])
    # Church tower and its low nave are one distant landmark, not a repeated box.
    wall(image, [(345, 143), (345, 116), (348, 116), (348, 110), (352, 110),
         (352, 104), (355, 98), (356, 91), (357, 98), (360, 104),
         (360, 110), (364, 110), (364, 116), (367, 116), (367, 143)],
         courses=[(349, 118, 363), (349, 132, 363)],
         windows=[(352, 121, 2, 5), (359, 121, 2, 5)])
    wall(image, [(368, 143), (368, 133), (376, 125), (399, 125), (408, 133),
         (408, 143)], windows=[(379, 133, 3, 5), (392, 133, 3, 5)], phase=4)
    wall(image, [(416, 143), (416, 128), (422, 128), (422, 123), (428, 123),
         (428, 120), (434, 120), (434, 123), (440, 123), (440, 128),
         (445, 128), (445, 143)], windows=[(424, 131, 3, 4), (435, 131, 3, 4)])
    wall(image, [(450, 143), (450, 135), (457, 130), (477, 130), (484, 135),
         (489, 138), (511, 138), (511, 143)], phase=2)
    return image


def arch_span(image, x, width, deck):
    wall(image, [(x, deck), (x + width, deck), (x + width, deck + 10),
         (x + width - 3, deck + 10), (x + width - 9, deck + 4),
         (x + width - 16, deck + 1), (x + 16, deck + 1),
         (x + 9, deck + 4), (x + 3, deck + 10), (x, deck + 10)])
    line(image, [(x, deck), (x + width, deck)])
    line(image, [(x, deck + 10), (x + 3, deck + 10), (x + 9, deck + 4),
         (x + 16, deck + 1), (x + width - 16, deck + 1),
         (x + width - 9, deck + 4), (x + width - 3, deck + 10),
         (x + width, deck + 10)])
    for start in (x + 5, x + width - 6):
        line(image, [(start, deck - 3), (start, deck)])
    line(image, [(x, deck - 3), (x + width, deck - 3)])


def hijswerf():
    image = Image.new('RGB', SIZE, BLACK)
    winter_clouds(image, 'wharf')
    wall(image, [(0, 138), (10, 138), (10, 128), (22, 119), (52, 119),
         (64, 128), (79, 128), (79, 143), (0, 143)],
         courses=[(15, 131, 73)], windows=[(21, 133, 5, 4), (39, 133, 5, 4),
         (60, 133, 5, 4)], phase=6)
    arch_span(image, 78, 53, 130)
    wall(image, [(131, 143), (131, 118), (137, 118), (137, 114), (145, 114),
         (145, 109), (154, 109), (154, 114), (163, 114), (163, 118),
         (169, 118), (169, 143)], courses=[(135, 123, 165)],
         windows=[(138, 126, 4, 5), (151, 126, 4, 5)])
    wall(image, [(172, 143), (172, 127), (183, 120), (213, 120), (222, 127),
         (238, 127), (238, 143)], windows=[(181, 131, 5, 4), (199, 131, 5, 4),
         (225, 132, 4, 3)], phase=5)
    wall(image, [(195, 97), (200, 97), (200, 119), (195, 119)], phase=3)
    line(image, [(195, 119), (195, 97), (194, 97), (194, 93),
         (201, 93), (201, 97), (200, 97), (200, 119)])
    line(image, [(197, 102), (198, 102)])
    line(image, [(197, 111), (198, 111)])
    arch_span(image, 237, 69, 129)
    # A shallow sawtooth shed and an older hipped warehouse differ in silhouette.
    wall(image, [(305, 143), (305, 124), (321, 113), (321, 124),
         (339, 113), (339, 124), (357, 113), (357, 124), (374, 113),
         (374, 124), (384, 124), (384, 143)],
         courses=[(311, 128, 378)], windows=[(314, 132, 5, 4), (333, 132, 5, 4),
         (352, 132, 5, 4), (371, 132, 5, 4)], phase=4)
    wall(image, [(402, 143), (402, 133), (413, 124), (448, 124), (458, 133),
         (458, 143)], windows=[(414, 134, 4, 3), (433, 134, 4, 3)])
    wall(image, [(425, 103), (428, 103), (428, 123), (425, 123)], phase=1)
    line(image, [(425, 123), (425, 103), (424, 103), (424, 100),
         (429, 100), (429, 103), (428, 103), (428, 123)])
    # The final open steel span reaches the next repeat through a low quay roof.
    line(image, [(460, 140), (464, 127), (485, 127), (491, 140)])
    line(image, [(460, 140), (491, 140)])
    line(image, [(464, 127), (476, 140), (485, 127)])
    line(image, [(487, 136), (494, 138), (511, 138)])
    line(image, [(493, 143), (511, 143)])
    # The rear buildings stand on a low far quay, above the native water at 152.
    for left, right in ((0, 79), (131, 238), (305, 384), (402, 458)):
        wall(image, [(left, 143), (right, 143), (right, 146),
             (right - 4, 149), (left + 4, 149), (left, 146)], phase=left % 7)
    for x in (78, 129, 237, 304, 461, 489):
        line(image, [(x, 139), (x, 149)])
        line(image, [(x + 1, 144), (x + 1, 147)])
    for x0, y, x1 in ((9, 151, 26), (48, 149, 61), (90, 147, 108),
                      (112, 150, 126), (146, 151, 161), (181, 150, 197),
                      (219, 151, 232), (253, 147, 278), (276, 150, 294),
                      (316, 151, 329), (351, 149, 365), (373, 151, 389),
                      (411, 150, 425), (446, 151, 462), (478, 150, 503)):
        line(image, [(x0, y), (x1, y)])
    return image


def haven():
    image = Image.new('RGB', SIZE, BLACK)
    winter_clouds(image, 'harbor')
    # A broken far bank, at a different height from the foreground waterline.
    for points in (
        [(0, 138), (18, 138), (18, 137), (36, 137), (36, 138), (62, 138)],
        [(69, 139), (82, 139), (82, 137), (101, 137)],
        [(184, 138), (202, 138), (202, 140), (224, 140)],
        [(306, 139), (324, 139), (324, 137), (343, 137)],
        [(448, 140), (465, 140), (465, 138), (511, 138)],
    ):
        line(image, points)
    # Tiny opposite-bank roofs, kept out of the two boat silhouettes.
    wall(image, [(96, 139), (96, 132), (104, 126), (122, 126), (131, 132),
         (131, 139)], windows=[(105, 133, 2, 2), (120, 133, 2, 2)], phase=2)
    wall(image, [(133, 139), (133, 130), (137, 130), (137, 127), (141, 127),
         (141, 123), (145, 123), (145, 127), (149, 127), (149, 130),
         (153, 130), (153, 139)], windows=[(138, 132, 2, 3), (147, 132, 2, 3)])
    wall(image, [(158, 139), (158, 134), (165, 129), (179, 129), (186, 134),
         (186, 139)], phase=6)
    # Side-view cargo barge: low dark hull, raised bow, wheelhouse and mast.
    hull = [(238, 134), (244, 136), (289, 136), (298, 132),
            (296, 137), (290, 141), (246, 141), (241, 138)]
    wall(image, hull, phase=2)
    wall(image, [(248, 134), (248, 131), (270, 131), (274, 134)], phase=5)
    line(image, hull + [hull[0]])
    line(image, [(248, 134), (248, 131), (270, 131), (274, 134), (287, 134)])
    line(image, [(277, 133), (277, 127), (284, 127), (284, 134)])
    line(image, [(279, 130), (282, 130)])
    line(image, [(266, 130), (266, 106), (270, 109)])
    line(image, [(267, 112), (281, 126)])
    line(image, [(251, 139), (265, 139)])
    line(image, [(278, 139), (289, 139)])
    wall(image, [(339, 139), (339, 131), (347, 125), (369, 125), (378, 131),
         (387, 131), (387, 139)], windows=[(349, 132, 3, 2), (368, 132, 3, 2)],
         phase=5)
    # A smaller moored sailing boat; no bright sail or lit cabin.
    hull = [(398, 133), (407, 135), (437, 135), (446, 131),
            (443, 136), (437, 139), (407, 139), (401, 136)]
    wall(image, hull, phase=5)
    wall(image, [(413, 133), (413, 129), (427, 129), (430, 133)], phase=3)
    line(image, hull + [hull[0]])
    line(image, [(418, 134), (418, 103), (421, 106)])
    line(image, [(418, 110), (404, 132)])
    line(image, [(419, 112), (440, 132)])
    line(image, [(413, 133), (413, 129), (427, 129), (430, 133)])
    # Distant harbour crane: one open triangle, a short boom, and a hanging hook.
    line(image, [(467, 137), (473, 115), (479, 137)])
    line(image, [(471, 123), (477, 123)])
    line(image, [(473, 116), (497, 105), (501, 107), (478, 118), (473, 116)])
    line(image, [(497, 107), (497, 122), (495, 124), (493, 123)])
    line(image, [(473, 114), (469, 112), (464, 115), (470, 118)])
    # Low quay faces and a few piles connect the opposite bank to its dark water.
    for left, right, top in ((0, 62, 138), (69, 101, 139), (96, 186, 139),
                            (184, 224, 140), (306, 387, 139), (448, 511, 140)):
        wall(image, [(left, top), (right, top), (right - 3, 145),
             (left + 4, 145)], phase=left % 7)
    for x in (20, 78, 102, 182, 216, 322, 379, 454, 483):
        line(image, [(x, 141), (x, 148)])
    # Reflections begin directly under the boats, then break into the native sea.
    for x0, y, x1 in ((12, 147, 26), (39, 150, 52), (74, 149, 88),
                      (106, 147, 119), (137, 151, 153), (167, 149, 178),
                      (192, 151, 207), (216, 147, 230),
                      (246, 143, 259), (267, 143, 290), (252, 146, 271),
                      (279, 146, 293), (241, 149, 257), (265, 150, 285),
                      (301, 151, 312), (313, 147, 324), (335, 150, 349),
                      (351, 147, 366), (372, 151, 387),
                      (405, 141, 420), (427, 142, 440), (410, 145, 431),
                      (402, 148, 417), (424, 150, 441),
                      (449, 151, 464), (479, 147, 492), (500, 150, 511)):
        line(image, [(x0, y), (x1, y)])
    return image


def main():
    ART.mkdir(exist_ok=True)
    for name, draw in (('winterstad', winterstad), ('hijswerf', hijswerf), ('haven', haven)):
        target = ART / f'{name}.png'
        draw().save(target)
        print(target.relative_to(ROOT))


if __name__ == '__main__':
    main()
