"""Focused rear-material and supplier-envelope checks against current mainboard.

The rear geometry owner produces its own BReps and STEP independently. This
cross-check uses that geometry together with the current mainboard; complete
assembly collision and declared-mating rules remain with compact_assembly.py.
"""

import hashlib
import json
from pathlib import Path

import cadquery as cq
from geometry import overlaps

ROOT = Path(__file__).resolve().parents[1]
TOL = 1e-6


def main():
    rear_path = ROOT / "build/reports/compact-rear-io.json"
    main_path = ROOT / "build/reports/compact-main-scene.json"
    rear = json.loads(rear_path.read_text())
    board = json.loads(main_path.read_text())
    rear_items = dict(rear["physical_parts"])
    rear_items.update({
        name: row for name, row in rear["receiving_spaces"].items()
        if row["representation"] == "receiving_allocation_not_factory_material"
    })
    checks, hits = [], []
    parts = {}
    for name, row in rear_items.items():
        shape = None
        for main_name, main_row in board["physical_parts"].items():
            if not overlaps(row["bounds_mm"], main_row["bounds_mm"]):
                continue
            if shape is None:
                path = ROOT / row["brep"]
                assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"]
                shape = cq.Shape.importBrep(str(path))
            if main_name not in parts:
                path = ROOT / main_row["brep"]
                assert hashlib.sha256(path.read_bytes()).hexdigest() == main_row["sha256"]
                parts[main_name] = cq.Shape.importBrep(str(path))
            volume = shape.intersect(parts[main_name]).Volume()
            item = {"rear": name, "main": main_name, "intersection_mm3": volume}
            checks.append(item)
            if volume > TOL:
                hits.append(item)
    report = {
        "scope": __doc__,
        "input_sha256": {
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (Path(__file__), ROOT / "cad/geometry.py", rear_path, main_path)
        },
        "focused_rear_vs_current_main_checks": checks,
        "focused_main_material_intersections": hits,
    }
    (ROOT / "build/reports/compact-rear-main-clearance.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"checks": len(checks), "intersections": hits}))
    assert not hits, hits


if __name__ == "__main__":
    main()
