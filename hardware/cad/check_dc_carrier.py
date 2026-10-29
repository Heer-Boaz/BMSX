"""Focused actual DC carrier and native STEP round-trip, not a console review."""

import hashlib
import json
from pathlib import Path
from time import perf_counter

import cadquery as cq
from fixtures import fabricate
from geometry import bounds, tube_path
from rear_components import dc_carrier

ROOT = Path(__file__).resolve().parents[1]


def main():
    started = perf_counter()
    plan_path = ROOT / "design/enclosure_rear_io.json"
    plan = json.loads(plan_path.read_text())
    manifest_path = ROOT / plan["input_manifest"]
    manifest = json.loads(manifest_path.read_text())
    row = next(p for p in manifest["parts"] if p["name"] == "DC__DC_REAR_CARRIER")
    native_path = ROOT / row["brep"]
    assert hashlib.sha256(native_path.read_bytes()).hexdigest() == row["sha256"]
    fixtures, *_ = fabricate([plan["fixtures"]])
    carrier = dc_carrier(
        plan, cq.Shape.importBrep(str(native_path)), fixtures["DC_INTERNAL_G10_EARS"]
    )
    assert carrier.isValid() and len(carrier.Solids()) == 1
    export = ROOT / "build/exports/BMSX_DC_carrier.step"
    export.parent.mkdir(parents=True, exist_ok=True)
    cq.exporters.export(carrier, str(export))
    restored = cq.importers.importStep(str(export)).val()
    assert restored.isValid() and len(restored.Solids()) == 1
    assert abs(restored.Volume() - carrier.Volume()) < 1e-5
    for wire in plan["DC_wires"]:
        solid = tube_path(wire["segments"], wire["OD_mm"] / 2)
        assert carrier.intersect(solid).Volume() < 1e-6
    report = {
        "scope": __doc__,
        "native_STEP_valid_single_solid": True,
        "wire_clearance_volume_pass": True,
        "bounds_mm": bounds(carrier),
        "native_volume_mm3": carrier.Volume(),
        "source_sha256": {
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (
                plan_path,
                manifest_path,
                native_path,
                Path(__file__),
                ROOT / "cad/rear_components.py",
                ROOT / "cad/geometry.py",
                ROOT / "cad/fixtures.py",
            )
        },
        "elapsed_seconds": perf_counter() - started,
        "fabrication_release": False,
    }
    target = ROOT / "build/reports/dc-carrier.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
