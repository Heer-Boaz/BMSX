"""Focused current-board/card-bank/passive-sink packaging sanity.

Consume current native component BReps and real native board holes. The sink
is an explicitly conservative maker-sized receiving envelope, NOT invented
fin geometry or a measured thermal-resistance model. No final case fit or
mounting-force qualification follows from these source-bound checks.
"""

import hashlib
import json
from pathlib import Path
from time import perf_counter

import cadquery as cq
from geometry import bounds, overlaps, thermal_contact

ROOT = Path(__file__).resolve().parents[1]


def main():
    started = perf_counter()
    layout = json.loads((ROOT / "build/reports/mainboard.json").read_text())
    main = json.loads((ROOT / "build/reports/compact-main-scene.json").read_text())
    bank = json.loads((ROOT / "build/reports/compact-cartridge-bank.json").read_text())
    body = json.loads((ROOT / "build/reports/compact-board-body.json").read_text())
    for rel, h in main["input_sha256"].items():
        assert hashlib.sha256((ROOT / rel).read_bytes()).hexdigest() == h, rel
    shapes = {}
    records = {}
    paths = [
        Path(__file__),
        ROOT / "cad/geometry.py",
        ROOT / "build/reports/mainboard.json",
        ROOT / "design/enclosure_cooling.json",
        ROOT / "build/reports/compact-main-scene.json",
        ROOT / "build/reports/compact-cartridge-bank.json",
        ROOT / "build/reports/compact-board-body.json",
    ]
    for main_name, row in main["physical_parts"].items():
        path = ROOT / row["brep"]
        shapes[main_name] = cq.Shape.importBrep(str(path))
        records[main_name] = dict(bounds_mm=row["bounds_mm"], kind="main", source_BRep=row["brep"])
        paths.append(path)
    path = ROOT / body["physical_parts"]["MAIN_BOARD"]["brep"]
    shapes["BOARD"] = cq.Shape.importBrep(str(path))
    records["BOARD"] = dict(
        bounds_mm=bounds(shapes["BOARD"]),
        kind="board",
        source_BRep=body["physical_parts"]["MAIN_BOARD"]["brep"],
    )
    paths.append(path)
    poses = {r["ref"]: r["position_mm"] for r in layout["placements"]}
    anchor = poses["J_CART0"]
    assert poses["J_CART1"] == [anchor[0], anchor[1] + 30]
    for row in bank["parts"]:
        path = ROOT / row["brep"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"]
        delta = [anchor[0], anchor[1], 0]
        shape = cq.Shape.importBrep(str(path)).translate(tuple(delta))
        name = "BANK__" + row["name"]
        shapes[name] = shape
        records[name] = dict(
            bounds_mm=bounds(shape),
            kind="bank",
            source_current_BRep=row["brep"],
            translation_mm=delta,
        )
        paths.append(path)
    heat = json.loads((ROOT / "design/enclosure_cooling.json").read_text())["sink"]
    x, y, z, X, Y, Z = heat["receiving_bounds_mm"]
    h = Z - z
    shapes["SINK_RECEIVING_ENVELOPE"] = cq.Solid.makeBox(X - x, Y - y, h, cq.Vector(x, y, z))
    records["SINK_RECEIVING_ENVELOPE"] = dict(
        bounds_mm=bounds(shapes["SINK_RECEIVING_ENVELOPE"]),
        kind="maker_receiving_envelope",
        maker=heat["MPN"],
        scope="Maximumoccupiedbox forcollisionclearance; actualfins/thermalperformance notrepresented.",
    )
    contacts = []
    for ref in ["U1", "U2"]:
        x, y = poses[ref]
        base = records["MAIN__" + ref]["bounds_mm"][5]
        shape = cq.Solid.makeBox(26, 26, z - base, cq.Vector(x - 13, y - 13, base))
        name = "TIM__" + ref
        shapes[name] = shape
        records[name] = dict(
            bounds_mm=bounds(shape),
            kind="thermal_interface",
            scope="Retained26x26interface, actualgapfromcurrentASICtop toselectedsinkbase; material/pressurequalificationopen.",
        )
        contacts.append(dict(ref=ref, **thermal_contact(shapes["SINK_RECEIVING_ENVELOPE"], shape)))
    checks = []
    hits = []
    names = list(shapes)
    # Only changed owner boundaries; main-main and bank-bank already have proofs.
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            ka, kb = records[a]["kind"], records[b]["kind"]
            if ka == kb and ka in ["main", "bank"]:
                continue
            if not overlaps(records[a]["bounds_mm"], records[b]["bounds_mm"]):
                continue
            volume = shapes[a].intersect(shapes[b]).Volume()
            row = dict(a=a, b=b, intersection_mm3=volume)
            checks.append(row)
            if volume > 1e-5:
                hits.append(row)
    output = ROOT / "build/cad/compact_packaging"
    output.mkdir(parents=True, exist_ok=True)
    outputs = {}
    for name, row in records.items():
        if row["kind"] == "main" or row["kind"] == "board":
            continue
        path = output / (name + ".brep")
        shapes[name].exportBrep(str(path))
        row["source_BRep"] = str(path.relative_to(ROOT))
        outputs[row["source_BRep"]] = hashlib.sha256(path.read_bytes()).hexdigest()
    report = dict(
        scope=__doc__,
        input_sha256={
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths
        },
        physical_parts={
            name: {
                "brep": row["source_BRep"],
                "sha256": outputs[row["source_BRep"]],
                "bounds_mm": row["bounds_mm"],
                "regions_mm": [row["bounds_mm"]],
                "module": "bank",
            }
            for name, row in records.items()
            if row["kind"] == "bank" and name.endswith("SOCKET")
        },
        receiving_spaces={},
        card_study_parts={
            name: row
            for name, row in records.items()
            if row["kind"] == "bank" and not name.endswith("SOCKET")
        },
        study_allocations={
            name: row
            for name, row in records.items()
            if row["kind"] not in ["main", "board", "bank"]
        },
        source_main_parts=len(main["physical_parts"]),
        bank_global_first_slot_centre_mm=anchor,
        sink_envelope_mm=records["SINK_RECEIVING_ENVELOPE"]["bounds_mm"],
        TIM_contacts=contacts,
        changed_boundary_exact_checks=checks,
        material_intersections=hits,
        material_intersection_allowlist=[],
        no_overlap_suppression=True,
        output_sha256=outputs,
        not_proven=[
            "Case/ports/harness/serviceintegration",
            "Sinkclamp andactualpackagecontactpressure",
            "Actualfins/two-sourceperformance/enclosedairflow",
            "ASICpower/PVT/junctiontemperatures",
            "Copperrouting/SI/PI/fabrication",
        ],
        whole_enclosure_fit_approved=False,
        elapsed_seconds=perf_counter() - started,
    )
    (ROOT / "build/reports/compact-packaging-fit.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )
    print(
        json.dumps(
            dict(
                objects=len(records),
                exact_checks=len(checks),
                material_intersections=hits,
                contacts=contacts,
                elapsed_seconds=report["elapsed_seconds"],
            ),
            indent=2,
        )
    )
    assert not hits


if __name__ == "__main__":
    main()
