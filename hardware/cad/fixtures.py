"""Physical fixture synthesis and conservative positive-material coverage.

A fixture primitive owns both its native solid and a conservative region used
by broadphase. Cuts remove material but cannot add unregistered obstacles.
This is not a wrapper around an arbitrary scene: it compiles the declared
fabricated-part groups, drilled axes and accessible nut pockets together.
"""

from math import sqrt

import cadquery as cq
from geometry import box, cylinder, rounded_prism

AXES = {"X": (1, 0, 0), "Y": (0, 1, 0), "Z": (0, 0, 1)}


def hole_shape(hole):
    axis = AXES[hole["axis"]]
    length = hole["through_length_mm"]
    origin = [hole["centre_mm"][i] - axis[i] * length / 2 for i in range(3)]
    return cylinder(origin, axis, hole["diameter_mm"] / 2, length)


def hex_pocket(pocket):
    length = pocket["length_mm"]
    shape = (
        cq.Workplane("XY")
        .polygon(6, pocket["across_flats_mm"] * 2 / sqrt(3))
        .extrude(length)
        .val()
        .translate((0, 0, -length / 2))
    )
    if pocket["axis"] == "X":
        shape = shape.rotate((0, 0, 0), (0, 1, 0), 90)
    elif pocket["axis"] == "Y":
        shape = shape.rotate((0, 0, 0), (1, 0, 0), 90)
    return shape.translate(tuple(pocket["centre_mm"]))


def fabricate(specs):
    groups = {}
    materials = {}
    regions = {}
    wall_cuts = []
    base_cuts = []
    wall_additions = []
    for spec in specs:
        for row in spec["parts"]:
            shape = box(row["bounds_mm"])
            for h in row["holes"]:
                shape = shape.cut(hole_shape(h))
            for slot in row["slots"]:
                shape = shape.cut(rounded_prism(slot["bounds_mm"], slot["radius_mm"], slot["axis"]))
            for cut in row["cutboxes"]:
                shape = shape.cut(box(cut["bounds_mm"]))
            for pocket in row["hex_pockets"]:
                shape = shape.cut(hex_pocket(pocket))
            group = row["group"]
            groups.setdefault(group, []).append(shape)
            regions.setdefault(group, []).append(row["bounds_mm"])
            materials[group] = spec["materials_by_group"][group]
        for h in spec["case_attachment_holes"]:
            {"chassis": base_cuts, "lower_shell": wall_cuts}[h["target"]].append(hole_shape(h))
        for row in spec["case_capture_lips"]:
            wall_additions.append(box(row["bounds_mm"]))
        for row in spec["case_clearance_cutboxes"]:
            wall_cuts.append(box(row["bounds_mm"]))
    parts = {}
    for group, shapes in groups.items():
        part = shapes[0]
        for s in shapes[1:]:
            part = part.fuse(s)
        parts[group] = part.clean()
    return parts, materials, regions, base_cuts, wall_cuts, wall_additions
