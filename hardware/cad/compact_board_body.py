"""Current compact board body from native KiCad STEP, with real native holes.

Reuse the board-model owner's exact nominal-thickness operation. No old-case
fit/structure checks, outline simplification, hole substitution or scaling.
"""

import hashlib
import json
from pathlib import Path

import cadquery as cq
from board_model import load_board_solid, nominal_board_in_assembly

ROOT = Path(__file__).resolve().parents[1]


def main():
    plan_path = ROOT / "build/reports/mainboard.json"
    layout = json.loads(plan_path.read_text())
    pack_path = ROOT / "design/packaging_outline.json"
    pack = json.loads(pack_path.read_text())
    pcb = ROOT / layout["board_source"]
    assert hashlib.sha256(pcb.read_bytes()).hexdigest() == layout["source_sha256"]
    native_path = ROOT / "build/exports/BMSX_COMPACT_board_native.step"
    native = load_board_solid(native_path)
    thickness = layout["thickness_mm"]
    bottom = pack["mainboard_candidate"]["bottom_Z_mm"]
    body = nominal_board_in_assembly(native, bottom + thickness, thickness)
    assert body.isValid() and len(body.Solids()) == 1
    b = body.BoundingBox()
    wanted = [
        *pack["mainboard_candidate"]["outline_XY_mm"][:2],
        bottom,
        *pack["mainboard_candidate"]["outline_XY_mm"][2:],
        bottom + thickness,
    ]
    actual = [b.xmin, b.ymin, b.zmin, b.xmax, b.ymax, b.zmax]
    assert max(abs(a - v) for a, v in zip(actual, wanted, strict=True)) < 1e-6, (actual, wanted)
    output = ROOT / "build/exports/BMSX_COMPACT_board_assembly.step"
    cq.exporters.export(body, str(output))
    out = ROOT / "build/cad/compact_board_assembly.brep"
    out.parent.mkdir(parents=True, exist_ok=True)
    body.exportBrep(str(out))
    back = load_board_solid(output)
    assert back.isValid() and len(back.Solids()) == 1 and abs(back.Volume() - body.Volume()) < 1e-5
    report = dict(
        scope=__doc__,
        input_sha256={
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [
                pcb,
                plan_path,
                pack_path,
                native_path,
                Path(__file__),
                ROOT / "cad/board_model.py",
            ]
        },
        native_board_only=True,
        nominal_finished_thickness_mm=thickness,
        assembly_bounds_mm=actual,
        holes_preserved_from_native_top_face=True,
        roundtrip_one_valid_solid_volume_pass=True,
        physical_parts={
            "MAIN_BOARD": {
                "brep": str(out.relative_to(ROOT)),
                "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
                "bounds_mm": actual,
                "regions_mm": [actual],
                "module": "board",
            }
        },
        receiving_spaces={},
        output_sha256={
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [out, output]
        },
        fabrication_release=False,
    )
    (ROOT / "build/reports/compact-board-body.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {k: report[k] for k in ["assembly_bounds_mm", "roundtrip_one_valid_solid_volume_pass"]},
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
