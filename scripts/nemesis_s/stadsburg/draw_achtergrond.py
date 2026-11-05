#!/usr/bin/env python3
"""Draw Stadsburg's native two-ink winter-night backdrops.

The editable PNG sources use authored architectural planes and material-specific
marks. Black is the dominant shadow; blue describes selected roof slopes,
masonry piers, stone courses and hull strakes. There is no whole-surface dither.
Collision and placement remain with the existing level compiler.

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


def line(image, points):
    ImageDraw.Draw(image).line(points, fill=BLUE)


def mass(image, points, colour=BLUE):
    ImageDraw.Draw(image).polygon(points, fill=colour)


def block(image, bounds, colour=BLUE):
    ImageDraw.Draw(image).rectangle(bounds, fill=colour)


def window(image, x, y, width, height):
    """A dark recess with a lit jamb and sill, rather than a glowing window."""
    block(image, (x, y, x + width - 1, y + height - 1))
    block(image, (x + 1, y + 1, x + width - 1, y + height - 2), BLACK)
    if width >= 5 and height >= 5:
        line(image, [(x + 2, y + 1), (x + 2, y + height - 2)])
    line(image, [(x - 1, y + height), (x + width, y + height)])


def brick_face(image, left, top, right, bottom, *, windows=(), piers=(), marks=()):
    """Quiet wall bays between lit brick piers and selected mortar courses."""
    block(image, (left, top, right, bottom), BLACK)
    # A broad, broken light-facing return gives the wall thickness. The other
    # edge and the foundation disappear into shadow instead of outlining a box.
    mass(image, [(left, top), (left + 3, top), (left + 3, top + 4),
                 (left + 1, top + 6), (left + 1, bottom - 1), (left, bottom - 1)])
    line(image, [(left, top), (right - 2, top)])
    for x, y, width, height in piers:
        block(image, (x, y, x + width - 1, y + height - 1))
        if height >= 7:
            block(image, (x + width - 2, y + 4, x + width - 1, y + 4), BLACK)
    for x, y, length in marks:
        line(image, [(x, y), (x + length - 1, y)])
    for opening in windows:
        window(image, *opening)


def hipped_roof(image, left, eave, ridge_left, top, ridge_right, right, *, broad_light=False):
    """A lit hip, a dark broad slope and a few coherent overlapping tile rows."""
    outline = [(left, eave), (ridge_left, top), (ridge_right, top), (right, eave)]
    mass(image, outline, BLACK)
    mass(image, [(left, eave), (ridge_left, top), (ridge_left + 3, top),
                 (left + 4, eave)])
    line(image, [(ridge_left, top), (ridge_right, top)])
    line(image, [(left + 1, eave), (right - 2, eave)])
    if broad_light:
        mass(image, [(ridge_left - 1, top + 2), (ridge_right - 4, top + 2),
                     (ridge_right - 8, top + 4), (ridge_left - 3, top + 4)])
    else:
        line(image, [(ridge_left + 6, top + 3), (ridge_right - 3, top + 3)])
        line(image, [(ridge_left + 4, eave - 2), (ridge_left + 10, eave - 2)])
    # Only the lower end of the far slope catches light.
    line(image, [(right - 3, eave - 2), (right - 1, eave)])


def gable(image, outline, eave, bottom, *, windows=(), piers=(), marks=()):
    """A masonry gable with heavier lit shoulders and a dark central wall."""
    left, right = outline[0][0], outline[-1][0]
    brick_face(image, left, eave, right, bottom,
               windows=windows, piers=piers, marks=marks)
    mass(image, outline + [(right, eave), (left, eave)], BLACK)
    line(image, outline)
    # Each left-hand stair catches a small area of light, not an isolated dot.
    for (x0, y0), (x1, y1) in zip(outline, outline[1:]):
        if y0 == y1 and x1 > x0 and x1 <= (left + right) // 2:
            block(image, (x0 + 1, y0 + 1, x1, min(eave - 1, y0 + 2)))
    line(image, [(left + 2, eave - 1), (right - 3, eave - 1)])


def winterstad():
    image = Image.new('RGB', SIZE, BLACK)
    # Homes keep complete storeys and narrow fronts. Low garden walls carry the
    # repeat seam; shadowed alleys keep the separate buildings readable.
    line(image, [(0, 138), (18, 138)])
    line(image, [(45, 138), (57, 138)])
    for x in (8, 49):
        block(image, (x, 140, x + 3, 142))
    brick_face(image, 22, 132, 43, 143,
               windows=[(27, 134, 3, 5), (36, 134, 3, 5)],
               marks=[(31, 142, 5)])
    hipped_roof(image, 22, 131, 28, 123, 37, 43)
    gable(image, [(57, 124), (61, 124), (61, 120), (64, 120),
          (64, 116), (68, 116), (68, 113), (73, 113), (73, 116),
          (77, 116), (77, 120), (80, 120), (80, 124), (84, 124)],
          127, 143, windows=[(64, 130, 3, 4), (74, 130, 3, 4)],
          piers=[(59, 132, 3, 6)], marks=[(63, 139, 5), (73, 141, 6)])
    window(image, 69, 120, 3, 3)
    brick_face(image, 94, 124, 117, 143,
               windows=[(99, 126, 3, 5), (109, 126, 3, 5),
                        (99, 135, 3, 5), (109, 135, 3, 5)],
               marks=[(104, 133, 4), (113, 142, 3)])
    hipped_roof(image, 94, 123, 100, 115, 111, 117, broad_light=True)
    block(image, (105, 110, 107, 114))
    block(image, (106, 112, 107, 114), BLACK)

    brick_face(image, 166, 124, 185, 143,
               windows=[(171, 126, 3, 5), (179, 126, 3, 5),
                        (171, 135, 3, 5), (179, 135, 3, 5)],
               marks=[(174, 133, 4)])
    hipped_roof(image, 166, 123, 171, 114, 180, 185)
    brick_face(image, 193, 132, 211, 143,
               windows=[(198, 134, 3, 5), (205, 134, 3, 5)],
               marks=[(199, 142, 4)])
    hipped_roof(image, 193, 131, 198, 123, 207, 211)
    gable(image, [(214, 122), (218, 122), (218, 118), (222, 118),
          (222, 114), (226, 114), (226, 110), (230, 110), (230, 114),
          (234, 114), (234, 118), (238, 118), (238, 122), (241, 122)],
          125, 143, windows=[(221, 129, 3, 4), (232, 129, 3, 4)],
          piers=[(216, 131, 3, 8)], marks=[(221, 139, 5), (233, 141, 5)])
    window(image, 227, 117, 2, 3)
    brick_face(image, 248, 122, 268, 143,
               windows=[(253, 125, 3, 5), (262, 125, 3, 5),
                        (253, 135, 3, 5), (262, 135, 3, 5)],
               marks=[(256, 132, 5), (264, 142, 3)])
    hipped_roof(image, 248, 121, 253, 113, 263, 268)
    gable(image, [(279, 125), (282, 125), (282, 121), (286, 121),
          (286, 117), (291, 117), (291, 121), (295, 121),
          (295, 125), (298, 125)],
          128, 143, windows=[(284, 131, 3, 5), (292, 131, 3, 5)],
          marks=[(284, 141, 4), (294, 142, 3)])
    window(image, 287, 122, 3, 3)

    # The church has a separate slate spire, bell chamber, cornice and stone
    # shaft. These large connected parts survive the native-size silhouette.
    mass(image, [(352, 110), (355, 98), (356, 91), (357, 98), (360, 110)], BLACK)
    mass(image, [(352, 110), (355, 99), (356, 91), (356, 103), (354, 110)])
    line(image, [(357, 102), (359, 108)])
    brick_face(image, 348, 110, 364, 119,
               windows=[(352, 112, 3, 5), (359, 112, 2, 5)],
               piers=[(362, 111, 2, 7)])
    block(image, (346, 118, 365, 119))
    brick_face(image, 345, 120, 367, 143,
               windows=[(353, 124, 3, 5)], piers=[(349, 121, 3, 10), (361, 133, 2, 8)],
               marks=[(349, 133, 8), (352, 139, 6), (357, 142, 7)])
    block(image, (348, 136, 350, 141))
    brick_face(image, 368, 133, 408, 143,
               windows=[(379, 135, 3, 5), (393, 135, 3, 5)],
               piers=[(402, 134, 2, 7)], marks=[(373, 141, 4)])
    hipped_roof(image, 368, 133, 376, 125, 399, 408)
    gable(image, [(420, 123), (424, 123), (424, 119), (428, 119),
          (428, 115), (434, 115), (434, 119), (438, 119),
          (438, 123), (443, 123)],
          126, 143, windows=[(426, 128, 3, 4), (435, 128, 3, 4),
                             (426, 137, 3, 4), (435, 137, 3, 4)],
          marks=[(430, 135, 4)])
    window(image, 430, 120, 2, 3)
    brick_face(image, 458, 132, 480, 143,
               windows=[(463, 134, 3, 5), (473, 134, 3, 5)],
               marks=[(468, 142, 4)])
    hipped_roof(image, 458, 131, 464, 122, 474, 480)
    line(image, [(483, 138), (511, 138)])
    for x in (494, 505):
        block(image, (x, 140, x + 3, 142))
    return image


def arch_span(image, x, width, deck):
    # Stone shoulders carry the deck; the opening and its far edge stay dark.
    mass(image, [(x, deck), (x + 16, deck), (x + 10, deck + 3),
                 (x + 4, deck + 10), (x, deck + 10)])
    mass(image, [(x + width - 12, deck), (x + width, deck),
                 (x + width, deck + 10), (x + width - 3, deck + 10),
                 (x + width - 6, deck + 4)])
    for dx, dy in ((1, 3), (4, 6), (width - 6, 3), (width - 4, 7)):
        block(image, (x + dx, deck + dy, x + dx + 2, deck + dy), BLACK)
    line(image, [(x + 9, deck), (x + width // 2 - 3, deck)])
    line(image, [(x + width // 2 + 3, deck), (x + width - 9, deck)])
    line(image, [(x + 6, deck + 5), (x + 10, deck + 2), (x + 17, deck + 1)])
    for start in (x + 5, x + width - 6):
        line(image, [(start, deck - 3), (start, deck)])
    line(image, [(x, deck - 3), (x + width, deck - 3)])


def chimney(image, x, top, bottom, width):
    block(image, (x, top, x + width - 1, top + 2))
    block(image, (x + 1, top + 3, x + 2, bottom))
    line(image, [(x + width - 2, top + 3), (x + width - 2, top + 7)])
    for y in range(top + 6, bottom, 6):
        block(image, (x + 2, y, x + 2, y), BLACK)
        line(image, [(x + 3, y + 1), (x + width - 2, y + 1)])


def quay(image, left, right, top, bottom):
    """Broad horizontal stone faces with recessed joints and a dark foot."""
    line(image, [(left, top), (right, top)])
    for x in range(left + 3, right - 4, 17):
        block(image, (x, top + 1, min(x + 7, right - 2), top + 2))
    for x in range(left + 9, right - 4, 23):
        line(image, [(x, bottom - 1), (min(x + 9, right - 1), bottom - 1)])
    block(image, (left, top + 1, left + 1, bottom - 1))


def hijswerf():
    image = Image.new('RGB', SIZE, BLACK)
    # The long halls have tall structural bays; their lower annexes are separate
    # volumes rather than ordinary house fronts stretched across the quay.
    brick_face(image, 10, 124, 64, 143,
               windows=[(20, 129, 6, 9), (38, 129, 6, 9), (55, 129, 6, 9)],
               piers=[(13, 126, 3, 15), (31, 126, 3, 15), (48, 126, 3, 15)],
               marks=[(19, 141, 7), (39, 141, 6), (56, 141, 6)])
    hipped_roof(image, 10, 123, 22, 113, 52, 64)
    brick_face(image, 65, 130, 79, 143,
               windows=[(70, 133, 5, 7)], marks=[(74, 142, 3)])
    line(image, [(65, 129), (79, 129)])
    line(image, [(0, 138), (10, 138)])
    arch_span(image, 78, 53, 130)
    gable(image, [(131, 118), (137, 118), (137, 114), (145, 114),
          (145, 109), (154, 109), (154, 114), (163, 114), (163, 118), (169, 118)],
          123, 143, windows=[(139, 126, 4, 6), (153, 126, 4, 6)],
          piers=[(134, 127, 3, 12), (163, 125, 3, 10)],
          marks=[(139, 138, 7), (151, 141, 8)])
    window(image, 147, 115, 4, 4)
    brick_face(image, 172, 123, 222, 143,
               windows=[(182, 128, 5, 10), (200, 128, 5, 10)],
               piers=[(174, 125, 3, 17), (192, 125, 3, 17), (210, 125, 3, 17)],
               marks=[(181, 141, 6), (199, 141, 6), (217, 135, 4)])
    hipped_roof(image, 172, 122, 183, 112, 212, 222, broad_light=True)
    brick_face(image, 223, 130, 238, 143,
               windows=[(229, 132, 4, 8)], marks=[(234, 142, 3)])
    line(image, [(223, 129), (238, 129)])
    chimney(image, 194, 93, 111, 8)
    arch_span(image, 237, 69, 129)

    # The sawtooth roof has four lit slopes with black vertical returns.
    # Broad piers and dark loading bays give the shed a different scale to homes.
    brick_face(image, 305, 127, 384, 143,
               windows=[(314, 132, 6, 7), (335, 132, 6, 7), (356, 132, 6, 7)],
               piers=[(307, 129, 3, 12), (326, 129, 3, 12),
                      (347, 129, 3, 12), (368, 129, 3, 12)],
               marks=[(312, 141, 7), (336, 141, 6), (374, 135, 7), (376, 141, 5)])
    for left, peak in ((305, 321), (321, 339), (339, 357), (357, 374)):
        mass(image, [(left, 124), (peak, 113), (peak, 124)], BLACK)
        mass(image, [(left, 124), (peak, 113), (peak, 116), (left + 5, 124)])
        line(image, [(peak - 1, 119), (peak - 1, 123)])
    line(image, [(305, 125), (328, 125)])
    line(image, [(336, 125), (359, 125)])
    line(image, [(367, 125), (384, 125)])
    brick_face(image, 402, 121, 438, 143,
               windows=[(409, 124, 3, 5), (422, 124, 3, 5),
                        (409, 134, 3, 5), (422, 134, 3, 5)],
               piers=[(433, 123, 3, 18)], marks=[(414, 132, 6), (426, 142, 5)])
    hipped_roof(image, 402, 120, 412, 111, 428, 438)
    chimney(image, 424, 100, 110, 6)
    brick_face(image, 441, 132, 458, 143,
               windows=[(447, 135, 6, 7)], marks=[(443, 142, 3)])
    line(image, [(441, 131), (458, 131)])
    line(image, [(460, 140), (464, 127), (485, 127), (491, 140)])
    line(image, [(460, 140), (491, 140)])
    line(image, [(464, 127), (476, 140), (485, 127)])
    block(image, (463, 127, 465, 128))
    block(image, (484, 127, 486, 128))
    line(image, [(487, 136), (494, 138), (511, 138)])
    line(image, [(493, 143), (511, 143)])
    for left, right in ((0, 79), (131, 238), (305, 384), (402, 458)):
        quay(image, left, right, 143, 149)
    for x in (78, 129, 237, 304, 461, 489):
        line(image, [(x, 139), (x, 149)])
        line(image, [(x + 1, 144), (x + 1, 147)])
    # Retain the established distant reflection positions and water boundary.
    for x0, y, x1 in ((9, 151, 26), (48, 149, 61), (90, 147, 108),
                      (112, 150, 126), (146, 151, 161), (181, 150, 197),
                      (219, 151, 232), (253, 147, 278), (276, 150, 294),
                      (316, 151, 329), (351, 149, 365), (373, 151, 389),
                      (411, 150, 425), (446, 151, 462), (478, 150, 503)):
        line(image, [(x0, y), (x1, y)])
    return image


def haven():
    image = Image.new('RGB', SIZE, BLACK)
    for points in (
        [(0, 138), (18, 138), (18, 137), (36, 137), (36, 138), (62, 138)],
        [(69, 139), (82, 139), (82, 137), (101, 137)],
        [(184, 138), (202, 138), (202, 140), (224, 140)],
        [(306, 139), (324, 139), (324, 137), (343, 137)],
        [(448, 140), (465, 140), (465, 138), (511, 138)],
    ):
        line(image, points)
    # Across the water, whole house modules are smaller in both dimensions.
    # Narrow fronts and standing windows preserve their proportions at distance.
    brick_face(image, 101, 126, 120, 139,
               windows=[(106, 129, 2, 4), (114, 129, 2, 4)],
               marks=[(109, 137, 4)])
    hipped_roof(image, 101, 125, 106, 117, 115, 120)
    gable(image, [(133, 121), (136, 121), (136, 118), (139, 118),
          (139, 114), (145, 114), (145, 118), (148, 118),
          (148, 121), (151, 121)],
          123, 139, windows=[(138, 125, 2, 4), (146, 125, 2, 4),
                             (138, 133, 2, 4), (146, 133, 2, 4)])
    gable(image, [(164, 129), (173, 121), (182, 129)],
          130, 139, windows=[(168, 132, 2, 4), (176, 132, 2, 4)])
    mass(image, [(164, 129), (173, 121), (173, 124), (167, 129)])

    # Cargo barge: the raised bow has a lit plate; long strakes follow the hull.
    # Dark gaps separate deck, wheelhouse and water instead of a closed contour.
    mass(image, [(238, 134), (244, 136), (289, 136), (298, 132),
                 (296, 137), (290, 141), (246, 141), (241, 138)], BLACK)
    mass(image, [(287, 136), (298, 132), (296, 137), (290, 140), (285, 140)])
    line(image, [(238, 134), (244, 136), (280, 136)])
    line(image, [(242, 138), (247, 140), (263, 140)])
    line(image, [(266, 139), (285, 139)])
    block(image, (290, 137, 295, 137), BLACK)
    mass(image, [(248, 134), (248, 131), (270, 131), (274, 134)], BLACK)
    mass(image, [(248, 134), (248, 131), (270, 131), (270, 132), (251, 132), (251, 134)])
    line(image, [(274, 134), (286, 134)])
    block(image, (277, 127, 284, 133))
    block(image, (279, 129, 283, 131), BLACK)
    block(image, (281, 132, 284, 133), BLACK)
    line(image, [(266, 130), (266, 106), (270, 109)])
    line(image, [(267, 112), (281, 126)])
    block(image, (265, 112, 267, 113))

    gable(image, [(342, 121), (346, 121), (346, 117), (350, 117),
          (350, 114), (354, 114), (354, 117), (358, 117),
          (358, 121), (361, 121)],
          123, 139, windows=[(347, 125, 2, 4), (355, 125, 2, 4),
                             (347, 133, 2, 4), (355, 133, 2, 4)])
    gable(image, [(370, 128), (378, 120), (386, 128)],
          130, 139, windows=[(374, 132, 2, 4), (381, 132, 2, 4)])
    mass(image, [(370, 128), (378, 120), (378, 123), (373, 128)])
    # Smaller moored sailing boat with a dark hull and a lit bow plank.
    mass(image, [(398, 133), (407, 135), (437, 135), (446, 131),
                 (443, 136), (437, 139), (407, 139), (401, 136)], BLACK)
    line(image, [(398, 133), (407, 135), (433, 135)])
    mass(image, [(434, 135), (446, 131), (443, 136), (437, 138), (433, 138)])
    line(image, [(402, 136), (408, 138), (422, 138)])
    block(image, (438, 135, 442, 135), BLACK)
    mass(image, [(413, 133), (413, 129), (427, 129), (430, 133)], BLACK)
    block(image, (413, 129, 427, 130))
    block(image, (413, 131, 415, 133))
    line(image, [(427, 131), (429, 133)])
    line(image, [(418, 134), (418, 103), (421, 106)])
    line(image, [(418, 110), (404, 132)])
    line(image, [(419, 112), (440, 132)])
    block(image, (417, 112, 419, 113))
    # The crane uses thin open steel, with solid joints only at its pivots.
    line(image, [(467, 137), (473, 115), (479, 137)])
    line(image, [(471, 123), (477, 123)])
    line(image, [(473, 116), (497, 105), (501, 107), (478, 118), (473, 116)])
    line(image, [(497, 107), (497, 122), (495, 124), (493, 123)])
    mass(image, [(473, 114), (469, 112), (464, 115), (470, 118)])
    block(image, (467, 114, 470, 115), BLACK)
    block(image, (473, 116, 475, 118))
    for left, right, top in ((0, 62, 138), (69, 101, 139), (96, 186, 139),
                            (184, 224, 140), (306, 387, 139), (448, 511, 140)):
        quay(image, left, right, top, 145)
    for x in (20, 78, 102, 182, 216, 322, 379, 454, 483):
        line(image, [(x, 141), (x, 148)])
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
