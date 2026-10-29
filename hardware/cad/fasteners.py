"""R2 concrete screw/nut/washer/spacer geometry from design/fasteners.json.

Standard fastener envelopes and process/assembly conventions live in that owner.
No thread helix is modelled: native pilot holes remain their tap-drill diameter;
the explicitly engaged screw segment uses the declared core diameter. Free
shanks retain their nominal major diameter. This is an explicit threaded-joint
representation, not an overlap-ignore or a fictitious clearance fit.
"""

from math import cos, pi

import cadquery as cq
from geometry import bounds, cylinder

AXIS_INDEX = {"X": 0, "Y": 1, "Z": 2}
AXIS_VECTOR = {"X": [1, 0, 0], "Y": [0, 1, 0], "Z": [0, 0, 1]}


def axial_cylinder(axis, datum, lo, hi, diameter):
    origin = list(datum)
    origin[AXIS_INDEX[axis]] = lo
    return cylinder(origin, AXIS_VECTOR[axis], diameter / 2, hi - lo)


def axial_hexagon(axis, datum, lo, hi, across_flats, clocking):
    """A true hexagon, not an across-corner cylinder used as a nut."""
    shape = (
        cq.Workplane("XY")
        .polygon(6, across_flats / cos(pi / 6))
        .extrude(hi - lo)
        .val()
        .rotate((0, 0, 0), (0, 0, 1), clocking)
    )
    if axis == "X":
        shape = shape.rotate((0, 0, 0), (0, 1, 0), 90)
    elif axis == "Y":
        shape = shape.rotate((0, 0, 0), (1, 0, 0), -90)
    origin = list(datum)
    origin[AXIS_INDEX[axis]] = lo
    return shape.translate(tuple(origin))


def screw_shape(interface, component):
    axis = interface["axis"]
    ai = AXIS_INDEX[axis]
    direction = interface["axis_direction"]
    sign = direction[ai]
    datum = interface["under_head_position_mm"]
    under = datum[ai]
    tip = interface["tip_position_mm"][ai]
    major = component["thread_major_diameter_mm"]
    height = component["head_max_height_mm"]
    if component["head_style"] == "countersunk":
        outward = [-v for v in direction]
        head = cq.Solid.makeCone(
            major / 2,
            component["head_max_OD_mm"] / 2,
            height,
            cq.Vector(*datum),
            cq.Vector(*outward),
        )
    else:
        head_lo, head_hi = sorted((under, under - sign * height))
        head = axial_cylinder(axis, datum, head_lo, head_hi, component["head_max_OD_mm"])
    shaft_lo, shaft_hi = sorted((under, tip))
    if "tapped_engagement" in interface:
        joint = interface["tapped_engagement"]
        thread_lo, thread_hi = joint["axis_range_mm"]
        cuts = sorted(set((shaft_lo, shaft_hi, max(shaft_lo, thread_lo), min(shaft_hi, thread_hi))))
        shaft_parts = []
        for lo, hi in zip(cuts, cuts[1:]):
            diameter = (
                joint["cad_screw_core_diameter_mm"]
                if lo >= thread_lo and hi <= thread_hi
                else major
            )
            shaft_parts.append(axial_cylinder(axis, datum, lo, hi, diameter))
        shaft = shaft_parts[0]
        for part in shaft_parts[1:]:
            shaft = shaft.fuse(part)
    else:
        shaft = axial_cylinder(axis, datum, shaft_lo, shaft_hi, major)
    # Real drive recess rather than an inaccessible featureless disc.
    top = interface["screw"]["head_top_axis_mm"]
    depth = {"cap": 1.3 if major == 3 else 0.9, "button": 1.0, "countersunk": 1.1}[
        component["head_style"]
    ]
    lo, hi = sorted((top - sign * 0.05, top + sign * depth))
    socket = axial_hexagon(axis, datum, lo, hi, component["hex_key_AF_mm"], 0)
    return head.fuse(shaft).cut(socket).clean()


def fabricate_fasteners(plan):
    """Return concrete BRep parts, material owners and broadphase regions.

    Every hardware placement has a unique explicit name in the plan. Intentional
    thread mating is represented only at that interface's declared engagement;
    otherwise the actual nominal shaft remains present for normal collision tests.
    """
    parts = {}
    materials = {}
    regions = {}
    components = plan["components"]
    for interface in plan["fastening_interfaces"]:
        screw = interface["screw"]
        component = components[screw["component_ref"]]
        parts[screw["part_name"]] = screw_shape(interface, component)
        materials[screw["part_name"]] = "steel"
        datum = interface["under_head_position_mm"]
        axis = interface["axis"]
        if "nut" in interface:
            nut = interface["nut"]
            spec = components[nut["component_ref"]]
            lo, hi = nut["axis_range_mm"]
            shape = axial_hexagon(
                axis, datum, lo, hi, spec["max_across_flats_mm"], nut["hex_clocking_deg"]
            )
            bore = axial_cylinder(
                axis, datum, lo - 0.05, hi + 0.05, spec["cad_thread_clear_bore_mm"]
            )
            parts[nut["part_name"]] = shape.cut(bore).clean()
            materials[nut["part_name"]] = "steel"
        for washer in interface["washers"]:
            spec = components[washer["component_ref"]]
            lo, hi = washer["axis_range_mm"]
            shape = axial_cylinder(axis, datum, lo, hi, spec["OD_mm"])
            bore = axial_cylinder(axis, datum, lo - 0.05, hi + 0.05, spec["ID_mm"])
            parts[washer["part_name"]] = shape.cut(bore).clean()
            materials[washer["part_name"]] = "steel"
        if "spacer" in interface:
            spacer = interface["spacer"]
            spec = components[spacer["component_ref"]]
            lo, hi = spacer["axis_range_mm"]
            shape = axial_cylinder(axis, datum, lo, hi, spec["OD_mm"])
            bore = axial_cylinder(axis, datum, lo - 0.05, hi + 0.05, spec["ID_mm"])
            parts[spacer["part_name"]] = shape.cut(bore).clean()
            materials[spacer["part_name"]] = spec["material"]
    for name, shape in parts.items():
        regions[name] = [bounds(shape)]
    return parts, materials, regions
