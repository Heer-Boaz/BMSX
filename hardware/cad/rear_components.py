"""Local rear manufactured parts, independent of the full console assembly.

CadQuery's native union/cut and STEP owners retain the actual solids:
https://github.com/CadQuery/cadquery/blob/master/cadquery/occ_impl/shapes.py
"""

from geometry import box, cylinder, tube_path


def dc_carrier(plan, native_carrier, internal_ears):
    """Rework the G10 carrier, including one merged insulated-wire passage."""
    carrier = native_carrier.translate(tuple(plan["DC"]["source_translation_mm"]))
    rework = plan["DC"]["carrier_rework"]
    lo, hi = rework["fill_Y_range_mm"]
    for x, z in rework["fill_old_fixing_holes_XZ_mm"]:
        carrier = carrier.fuse(
            cylinder((x, lo, z), (0, 1, 0), rework["fill_diameter_mm"] / 2, hi - lo)
        )
    carrier = carrier.fuse(internal_ears).clean()
    channels = [
        tube_path(wire["segments"], wire["OD_mm"] / 2 + rework["wire_radial_clearance_mm"])
        for wire in plan["DC_wires"]
        if wire["name"] in rework["clearance_channels_from_wires"]
    ]
    # Tangent clearance holes leave a zero-width web. The specified joining
    # window makes one real, machinable passage rather than a degenerate seam.
    channel = channels[0].fuse(*channels[1:], box(rework["wire_channel_join_bounds_mm"])).clean()
    return carrier.cut(channel).clean()
