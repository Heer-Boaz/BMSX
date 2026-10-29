"""Sample the real cartridge-flap/board-contact geometry during insertion.

Uses the same straight insertion and leaf-contact pose construction as the
cartridge-flap owner. Nominal finite samples cannot prove continuous clearance,
manufacturing tolerances, contact force, tilted insertion, plating wear or
durability. In particular, board-edge contact is recorded, not declared a
defect. Connector pinout, PCB, case and flap geometry are unchanged.
"""

import hashlib
import json
import math
from pathlib import Path
from time import perf_counter

import cadquery as cq

ROOT = Path(__file__).resolve().parents[1]


def main():
    started = perf_counter()
    flap_path = ROOT / "build/reports/compact-cartridge-flaps.json"
    bank_path = ROOT / "build/reports/compact-cartridge-bank.json"
    layout_path = ROOT / "build/reports/mainboard.json"
    plan_path = ROOT / "design/cartridge_flaps.json"
    flap = json.loads(flap_path.read_text())
    bank = json.loads(bank_path.read_text())
    layout = json.loads(layout_path.read_text())
    plan = json.loads(plan_path.read_text())
    seated = flap["states"]["seated"]
    card_rows = [row for row in bank["parts"] if row["role"] != "SOCKET"]
    leaf_rows = [flap["physical_parts"][f"FLAP__SLOT{slot}__LEAF"] for slot in range(2)]
    for row in [*card_rows, *leaf_rows]:
        assert hashlib.sha256((ROOT / row["brep"]).read_bytes()).hexdigest() == row["sha256"]
    anchor = next(row["position_mm"] for row in layout["placements"] if row["ref"] == "J_CART0")
    angles = [0, 30, 45, 55, 57, 58, 59, seated["angle_degrees"]]
    samples, hits = [], []
    for slot, (hinge_y, hinge_z) in enumerate(plan["hinge_axes"]):
        cards = {
            row["role"]: cq.Shape.importBrep(str(ROOT / row["brep"])).translate((*anchor, 0))
            for row in card_rows if row["slot"] == slot
        }
        leaf = cq.Shape.importBrep(str(ROOT / leaf_rows[slot]["brep"]))
        for angle in angles:
            theta = math.radians(angle)
            lift = max(
                0,
                *(
                    hinge_z
                    - (shape.BoundingBox().ymin - hinge_y) * math.tan(theta)
                    + 0.4 / math.cos(theta)
                    - shape.BoundingBox().zmin
                    for shape in cards.values()
                ),
            )
            moved_leaf = leaf.rotate((0, hinge_y, hinge_z), (1, hinge_y, hinge_z), -angle)
            moved = {name: shape.translate((0, 0, lift)) for name, shape in cards.items()}
            fingers = moved["FINGERS"]
            intersection = moved_leaf.intersect(fingers).Volume(tol=1e-10)
            row = {
                "slot": slot,
                "angle_degrees": angle,
                "cartridge_lift_mm": lift,
                "leaf_to_pcb_mm": moved_leaf.distance(moved["PCB"]),
                "leaf_to_fingers_mm": moved_leaf.distance(fingers),
                "leaf_to_shell_mm": moved_leaf.distance(moved["SHELL"]),
                "finger_intersection_mm3": intersection,
            }
            samples.append(row)
            if intersection > 1e-5:
                hits.append(row)
    assert abs(next(r["cartridge_lift_mm"] for r in samples if r["slot"] == 0 and r["angle_degrees"] == 45) - flap["states"]["insertion"]["cartridge_lift_mm"]) < 1e-7
    assert abs(samples[7]["cartridge_lift_mm"] - seated["cartridge_lift_mm"]) < 1e-7
    report = {
        "scope": __doc__,
        "input_sha256": {
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in [Path(__file__), flap_path, bank_path, layout_path, plan_path, *(ROOT / row["brep"] for row in [*card_rows, *leaf_rows])]
        },
        "samples": samples,
        "finger_intersections": hits,
        "fabrication_release": False,
        "elapsed_seconds": perf_counter() - started,
    }
    (ROOT / "build/reports/cartridge-edge-contact.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"samples": len(samples), "hits": hits, "min_sampled_finger_clearance_mm": min(row["leaf_to_fingers_mm"] for row in samples), "elapsed_seconds": report["elapsed_seconds"]}))
    assert not hits, hits


if __name__ == "__main__":
    main()
