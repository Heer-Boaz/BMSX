"""Export the wide-GFX placement study as a separate native STEP assembly.

The KiCad board, retained cartridge sockets and snapshot bodies are reference
geometry. The GFX and four VRAM regions are thin planar markers, not package
models or component heights. There is no routing, complete population, fit,
electrical or timing qualification. Earlier exports are never replaced.

CadQuery assembly/export owner:
https://github.com/CadQuery/cadquery/blob/master/tests/test_assembly.py
"""

import argparse
import hashlib
import json
from pathlib import Path

import cadquery as cq

from board_model import load_board_solid, nominal_board_in_assembly
from geometry import box, bounds

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "build/exports/BMSX_WIDE_GFX_CLUSTER_CONCEPT.step")
    parser.add_argument("--report", type=Path, default=ROOT / "build/reports/gfx-wide-cluster-concept.json")
    args = parser.parse_args()
    design_path = ROOT / "design/gfx_wide_cluster.json"
    current_path = ROOT / "build/cad/gfx_wide_cluster/current_board.json"
    native_path = ROOT / "build/cad/gfx_wide_cluster/current_board.step"
    previous_path = ROOT / "build/reports/mainboard.json"
    retained_path = ROOT / "build/reports/compact-assembly.json"
    pack_path = ROOT / "design/packaging_outline.json"
    output = args.output
    report_path = args.report
    for path in (output, report_path):
        if path.exists():
            raise FileExistsError(f"Refusing to replace an existing artifact: {path}")

    design = json.loads(design_path.read_text())
    current = json.loads(current_path.read_text())
    previous = json.loads(previous_path.read_text())
    retained = json.loads(retained_path.read_text())
    pack = json.loads(pack_path.read_text())
    board_source = ROOT / current["board_source"]
    assert hashlib.sha256(board_source.read_bytes()).hexdigest() == current["source_sha256"]
    old = {part["ref"]: part for part in previous["placements"]}
    new = {part["ref"]: part for part in current["placements"]}
    for ref in ("U1", "J_CART0", "J_CART1"):
        assert old[ref]["position_mm"] == new[ref]["position_mm"]
        assert old[ref]["rotation_degrees"] == new[ref]["rotation_degrees"]
    z_bottom = pack["mainboard_candidate"]["bottom_Z_mm"]
    z_top = z_bottom + current["thickness_mm"]
    marker = design["marker_thickness_mm"]

    assembly = cq.Assembly(name="BMSX_WIDE_GFX_CLUSTER_CONCEPT")
    board = nominal_board_in_assembly(load_board_solid(native_path), z_top, current["thickness_mm"])
    assembly.add(board, name="CURRENT_BOARD_UNROUTED", color=cq.Color(0.13, 0.34, 0.23))

    for name in ("MAIN__U1", "BANK__SLOT0__SOCKET", "BANK__SLOT1__SOCKET"):
        part = retained["physical_parts"][name]
        source = ROOT / part["brep"]
        assert hashlib.sha256(source.read_bytes()).hexdigest() == part["sha256"]
        assembly.add(cq.Shape.importBrep(str(source)), name="RETAINED__" + name,
                     color=cq.Color(0.22, 0.22, 0.22))

    # Snapshot models come from the same retained bodies used by the existing
    # INPUT/memory assembly, translated to the current candidate placement.
    for target, origin in (("U152", "U30"), ("U153", "U31")):
        part = retained["physical_parts"]["MAIN__" + origin]
        source = ROOT / part["brep"]
        assert hashlib.sha256(source.read_bytes()).hexdigest() == part["sha256"]
        before, after = old[origin], new[target]
        assert before["rotation_degrees"] == after["rotation_degrees"]
        offset = tuple(after["position_mm"][i] - before["position_mm"][i] for i in (0, 1))
        shape = cq.Shape.importBrep(str(source)).translate((*offset, 0))
        assembly.add(shape, name="RETAINED_SNAPSHOT__" + target, color=cq.Color(0.20, 0.25, 0.31))

    x, y = new["U2"]["position_mm"]
    w, h = design["gfx_body_reservation_mm"]
    region = box((x-w/2, y-h/2, z_top, x+w/2, y+h/2, z_top+marker))
    assembly.add(region, name="U2_40X40_PLAN_MARKER_NOT_PACKAGE", color=cq.Color(0.28, 0.52, 0.75))

    w, h = design["vram_reservation_mm"]
    for index, ref in enumerate(("U30", "U31"), start=1):
        x, y = new[ref]["position_mm"]
        top = box((x-w/2, y-h/2, z_top, x+w/2, y+h/2, z_top+marker))
        assembly.add(top, name=f"VRAM_{index}_TOP_PLAN_MARKER_NOT_PACKAGE", color=cq.Color(0.9, 0.56, 0.10))
        y = design["underside_reservation_y_mm"]
        bottom = box((x-w/2, y-h/2, z_bottom-marker, x+w/2, y+h/2, z_bottom))
        assembly.add(bottom, name=f"VRAM_{index+2}_BOTTOM_PLAN_MARKER_NOT_PACKAGE", color=cq.Color(0.9, 0.56, 0.10))

    assembly.export(str(output))
    roundtrip = list(cq.Assembly.importStep(str(output)))
    names = [name.rsplit("/", 1)[-1] for _, name, _, _ in roundtrip]
    assert len(names) == len(set(names)) == 11
    assert all(shape.isValid() for shape, _, _, _ in roundtrip)
    report = {
        "scope": __doc__,
        "board_source": current["board_source"],
        "board_source_sha256": current["source_sha256"],
        "native_step_sha256": hashlib.sha256(native_path.read_bytes()).hexdigest(),
        "retained_geometry_report": str(retained_path.relative_to(ROOT)),
        "board_bounds_mm": bounds(board),
        "named_bodies": names,
        "design": design,
        "export_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"output": str(output), "named_bodies": len(names), "bounds_mm": bounds(board)}))


if __name__ == "__main__":
    main()
