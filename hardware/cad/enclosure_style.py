"""Industrial shell form and native face-coating ownership.

The inner cavity, mounts, connector datums and vent cuts stay with the structural
owner. Only the exterior is swept; face colours are native XCAF metadata, not
invented parts or vendor geometry. CadQuery's production Assembly.addSubshape
and Solid.makeLoft are used directly (cadquery/assembly.py and occ_impl/shapes.py).
"""

import cadquery as cq
from geometry import bounds, box, rounded_prism


def outer_shell_stock(style):
    wires = []
    for row in style["outer_sections"]:
        x, y, X, Y = row["bounds_XY_mm"]
        z = row["Z_mm"]
        section = rounded_prism([x, y, z, X, Y, z + 1], row["radius_mm"])
        wires.append(cq.Workplane(obj=section).faces("<Z").wires().val())
    stock = cq.Solid.makeLoft(wires, ruled=True)
    groove = style["waist_groove"]
    ring = box(groove["bounds_mm"]).cut(
        rounded_prism(groove["retained_inside_bounds_mm"], groove["retained_radius_mm"])
    )
    stock = stock.cut(ring)
    recess = style["front_recess"]
    stock = stock.cut(rounded_prism(recess["bounds_mm"], recess["radius_mm"], "Y"))
    rear = style["rear_recess"]
    return stock.cut(rounded_prism(rear["bounds_mm"], rear["radius_mm"], "Y"))


def face_paints(name, shape, style):
    """Assign coatings to actual native faces; never substitute a body model."""
    result = []
    for index, face in enumerate(shape.Faces()):
        bb = bounds(face)
        tag = None
        if name == "CASE__FIXED_BODY":
            if (
                bb[4] <= 0.000001
                and bb[1] >= -0.000001
                and bb[0] >= 6.999999
                and bb[3] <= 223.000001
                and bb[2] >= 9.499999
                and bb[5] <= 35.500001
            ):
                tag = "fascia"
            elif (
                abs(bb[1] - 190) < 1e-6
                and abs(bb[4] - 190) < 1e-6
                and bb[0] >= 13.999999
                and bb[3] <= 227.000001
                and bb[2] >= 14.999999
                and bb[5] <= 53.200001
            ):
                tag = "fascia"
            elif bb[5] <= 11.400001:
                tag = "plinth"
        elif name == "CASE__REMOVABLE_LID":
            well = style["cartridge_well"]["bounds_mm"]
            if (
                abs(bb[2] - well[2]) < 1e-6
                and abs(bb[5] - well[2]) < 1e-6
                and bb[0] >= well[0] - 1e-6
                and bb[3] <= well[3] + 1e-6
                and bb[1] >= well[1] - 1e-6
                and bb[4] <= well[4] + 1e-6
            ):
                tag = "slot_well"
        if tag:
            result.append({"face_index": index, "appearance": tag})
    return result


def apply_native_colours(assembly, name, shape, paints, appearance):
    """XCAF stores coatings on their owning faces; geometry remains one solid."""
    node = assembly.objects[name]
    faces = shape.Faces()
    for row in paints:
        node.addSubshape(
            faces[row["face_index"]], color=cq.Color(*appearance["palette"][row["appearance"]])
        )
