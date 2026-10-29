"""Native bare-board import and nominal finished-thickness geometry."""

import cadquery as cq


def load_board_solid(path):
    """The entire STEP import must describe one board, not just its first root."""
    imported = cq.importers.importStep(str(path))
    assert len(imported.vals()) == 1, "Additional STEP roots/solids are not part of a bare board"
    return imported.val()


def nominal_board_in_assembly(native, top_z_mm, thickness_mm):
    """Exact native XY/hole wires, nominal finished thickness, world Y down.

    KiCad owns the dielectric STEP, whose thickness excludes outer copper.
    Extrude its top-face wires to the declared finished thickness; do not scale
    holes or infer the board from component STEP names.
    """
    assert native.isValid() and len(native.Solids()) == 1
    tops = [f for f in native.Faces() if f.geomType() == "PLANE" and f.normalAt().z > 0.99]
    assert len(tops) == 1
    face = tops[0]
    solid = cq.Solid.extrudeLinear(
        face.outerWire(), face.innerWires(), cq.Vector(0, 0, -thickness_mm)
    )
    return solid.mirror("XZ").translate((0, 0, top_z_mm - face.Center().z))
