"""Underside-only case closure, integral lid capture and opaque lower tray.

The four screws carry a real clamp stack; captive nuts bear on closed underside
boss floors, not on an open-ended decorative pocket. Side skirts are partitioned
from the existing shell, so the lid can lift without exterior screw caps.
Native CAD operations: CadQuery/OCCT production shapes.py/assembly.py.
"""

from fasteners import axial_hexagon
from geometry import bounds, box, cylinder, rounded_prism


def build_closure(shell, lid, base, spec):
    closure = spec["closure"]
    tray = spec["bottom_cover"]
    parts = {}
    materials = {}
    case_regions = []
    # Transfer the actual side profile to the removable cap; no guessed exterior.
    for region in closure["lid_side_regions"]:
        lid = lid.fuse(shell.intersect(box(region)))
    for region in closure["case_side_clearances"]:
        shell = shell.cut(box(region))
    for region in closure["lid_bridges"]:
        lid = lid.fuse(box(region))
    bottom = rounded_prism(tray["outer_bounds_mm"], tray["outer_radius_mm"]).cut(
        rounded_prism(tray["inner_bounds_mm"], tray["inner_radius_mm"])
    )
    for row in tray["intake_slots"]:
        bottom = bottom.cut(rounded_prism(row["bounds_mm"], row["radius_mm"]))
    for index, (x, y) in enumerate(closure["axes_XY_mm"]):
        lo, hi = closure["base_pad_range_Z_mm"]
        base = base.fuse(cylinder((x, y, lo), (0, 0, 1), closure["base_pad_OD_mm"] / 2, hi - lo))
        base = base.cut(
            cylinder(
                (x, y, lo - 0.1), (0, 0, 1), closure["clearance_diameter_mm"] / 2, hi - lo + 0.2
            )
        )
        lo, hi = closure["compression_range_Z_mm"]
        if x < 120:
            r = closure["left_post_OD_mm"] / 2
            split_lo, split_hi = closure["left_mid_range_Z_mm"]
            post = cylinder((x, y, lo), (0, 0, 1), r, split_lo - lo)
            middle = cylinder((x, y, split_lo), (0, 0, 1), r, split_hi - split_lo).intersect(
                box([x - r, y - r, split_lo, closure["left_mid_clip_X_mm"], y + r, split_hi])
            )
            post = post.fuse(middle).fuse(cylinder((x, y, split_hi), (0, 0, 1), r, hi - split_hi))
            post = post.cut(
                cylinder(
                    (x, y, lo - 0.1), (0, 0, 1), closure["clearance_diameter_mm"] / 2, hi - lo + 0.2
                )
            ).clean()
            name = "CASE__LEFT_COMPRESSION_" + str(index)
            parts[name] = post
            materials[name] = "PA12 prototype compression sleeve"
        else:
            r = closure["right_post_OD_mm"] / 2
            post = cylinder((x, y, lo), (0, 0, 1), r, hi - lo).intersect(
                box([closure["right_stock_min_X_mm"], y - r, lo, x + r, y + r, hi])
            )
            post = post.cut(
                cylinder(
                    (x, y, lo - 0.1), (0, 0, 1), closure["clearance_diameter_mm"] / 2, hi - lo + 0.2
                )
            )
            shell = shell.fuse(post).cut(
                cylinder(
                    (x, y, lo - 0.1), (0, 0, 1), closure["clearance_diameter_mm"] / 2, hi - lo + 0.2
                )
            )
            case_regions.append(bounds(post))
        lo, hi = closure["lid_boss_range_Z_mm"]
        r = closure["lid_boss_OD_mm"] / 2
        boss = cylinder((x, y, lo), (0, 0, 1), r, hi - lo)
        if x < 120:
            boss = boss.intersect(box([closure["lid_boss_min_X_mm"], y - r, lo, x + r, y + r, hi]))
        lid = lid.fuse(boss)
        pocket_lo, pocket_hi = closure["nut_pocket_range_Z_mm"]
        pocket = axial_hexagon(
            "Z",
            [x, y, 0],
            pocket_lo,
            pocket_hi,
            closure["nut_pocket_AF_mm"],
            closure["nut_clocking_deg"],
        )
        # Slide each nut from the central interior; solid floor carries tension.
        loading = (
            box([x, y - 3.4, pocket_lo, x + r + 0.1, y + 3.4, pocket_hi])
            if x < 120
            else box([x - r - 0.1, y - 3.4, pocket_lo, x, y + 3.4, pocket_hi])
        )
        lid = (
            lid.cut(pocket)
            .cut(loading)
            .cut(
                cylinder(
                    (x, y, lo - 0.1),
                    (0, 0, 1),
                    closure["clearance_diameter_mm"] / 2,
                    closure["blind_shaft_end_Z_mm"] - lo + 0.1,
                )
            )
        )
        lo, hi = tray["boss_range_Z_mm"]
        bottom = bottom.fuse(cylinder((x, y, lo), (0, 0, 1), tray["boss_OD_mm"] / 2, hi - lo))
        lo, hi = tray["counterbore_range_Z_mm"]
        bottom = bottom.cut(
            cylinder((x, y, lo), (0, 0, 1), tray["head_counterbore_OD_mm"] / 2, hi - lo)
        )
        lo, hi = tray["shaft_range_Z_mm"]
        bottom = bottom.cut(
            cylinder((x, y, lo), (0, 0, 1), closure["clearance_diameter_mm"] / 2, hi - lo)
        )
    for index, (x, y) in enumerate(spec["feet"]["axes_XY_mm"]):
        lo, hi = spec["feet"]["rubber_range_Z_mm"]
        name = "CASE__FOOT_" + str(index)
        parts[name] = cylinder((x, y, lo), (0, 0, 1), spec["feet"]["foot_OD_mm"] / 2, hi - lo)
        materials[name] = "Selfadhesive elastomer prototype foot"
    parts["CASE__BOTTOM_COVER"] = bottom.clean()
    materials["CASE__BOTTOM_COVER"] = "PC-ABS proposal, prototype PA12"
    return shell.clean(), lid.clean(), base.clean(), parts, materials, case_regions


def service_envelopes(spec):
    """Continuous lift/drop allocations of actual closure features, not samples."""
    c = spec["closure"]
    t = spec["bottom_cover"]
    result = {}
    ztop = 131
    result["LID_MAIN"] = rounded_prism([3.9, 35.4, 53, 236.1, 179.6, ztop], 1)
    # The cover lifts around these real through-openings; filling them in
    # would incorrectly reserve material across the fixed polarising ribs.
    for row in spec["cartridge_roof_apertures"]:
        x, y = row["centre_XY_mm"]
        width, depth = row["size_XY_mm"]
        result["LID_MAIN"] = result["LID_MAIN"].cut(
            rounded_prism(
                [x - width / 2, y - depth / 2, 52.9, x + width / 2, y + depth / 2, ztop + 0.1],
                row["radius_mm"],
            )
        )
    for index, region in enumerate(c["lid_side_regions"]):
        b = list(region)
        b[5] = ztop
        result["LID_SIDE_" + str(index)] = box(b)
    for index, (x, y) in enumerate(c["axes_XY_mm"]):
        z = c["lid_boss_range_Z_mm"][0]
        sweep = cylinder((x, y, z), (0, 0, 1), c["service_profile_boss_radius_mm"], ztop - z)
        if x < 120:
            sweep = sweep.intersect(box([c["lid_boss_min_X_mm"], y - 5, z, x + 5, y + 5, ztop]))
        result["LID_BOSS_" + str(index)] = sweep
    lo = t["outer_bounds_mm"]
    inside = t["inner_bounds_mm"]
    drop = 20
    outer = rounded_prism([lo[0], lo[1], lo[2] - drop, lo[3], lo[4], lo[5]], t["outer_radius_mm"])
    inner = rounded_prism(
        [inside[0], inside[1], lo[2] - drop - 0.1, inside[3], inside[4], lo[5] + 0.1],
        t["inner_radius_mm"],
    )
    result["BOTTOM_WALL"] = outer.cut(inner)
    result["BOTTOM_FLOOR"] = rounded_prism(
        [lo[0], lo[1], lo[2] - drop, lo[3], lo[4], inside[2]], t["outer_radius_mm"]
    )
    for index, (x, y) in enumerate(c["axes_XY_mm"]):
        z = t["boss_range_Z_mm"][0] - drop
        result["BOTTOM_BOSS_" + str(index)] = cylinder(
            (x, y, z), (0, 0, 1), t["boss_OD_mm"] / 2, t["boss_range_Z_mm"][1] - z
        )
    return result
