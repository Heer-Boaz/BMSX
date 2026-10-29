"""Targeted insertion/seated native interfaces against the actual closed console.

The flap owner checks its own parts. This check replaces the closed module by
its supplied states and checks moved parts/cards against foreign hardware and
all state-specific card/flap interfaces. It does not rerun PCB or thermal work.
"""

import hashlib
import json
from pathlib import Path
from time import perf_counter

import cadquery as cq
from geometry import overlaps

ROOT = Path(__file__).resolve().parents[1]


def main():
    start = perf_counter()
    scene_path = ROOT / "build/reports/compact-assembly.json"
    flap_path = ROOT / "build/reports/compact-cartridge-flaps.json"
    scene = json.loads(scene_path.read_text())
    assert scene["integration_pass"]
    flap = json.loads(flap_path.read_text())
    closed = flap["physical_parts"]
    checks = []
    hits = []
    shapes = {}
    foreign = {
        n: r
        for n, r in (scene["physical_parts"] | scene["receiving_spaces"]).items()
        if r["module"] != "cartridge-flaps"
    }
    for state in ["insertion", "seated"]:
        parts = flap["states"][state]["parts"]
        for name, row in parts.items():
            is_card = row["module"] == "bank"
            if not is_card and row["sha256"] == closed[name]["sha256"]:
                continue
            peers = foreign | {n: r for n, r in parts.items() if is_card and n.startswith("FLAP__")}
            for peer, data in peers.items():
                if not overlaps(row["bounds_mm"], data["bounds_mm"]):
                    continue
                for item in [row, data]:
                    digest = item["sha256"]
                    if digest not in shapes:
                        path = ROOT / item["brep"]
                        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
                        shapes[digest] = cq.Shape.importBrep(str(path))
                volume = shapes[row["sha256"]].intersect(shapes[data["sha256"]]).Volume(tol=1e-10)
                entry = {"state": state, "parts": [name, peer], "intersection_mm3": volume}
                checks.append(entry)
                if volume > 1e-5:
                    hits.append(entry)
    result = {
        "scope": __doc__,
        "input_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [Path(__file__), scene_path, flap_path, ROOT / "cad/geometry.py"]
        },
        "checks": checks,
        "material_intersections": hits,
        "pass": not hits,
        "elapsed_seconds": perf_counter() - start,
        "fabrication_release": False,
    }
    (ROOT / "build/reports/cartridge-flaps-interfaces.json").write_text(
        json.dumps(result, indent=2) + "\n"
    )
    print(
        json.dumps(
            {"checks": len(checks), "hits": hits, "elapsed_seconds": result["elapsed_seconds"]},
            indent=2,
        )
    )
    assert not hits, hits


if __name__ == "__main__":
    main()
