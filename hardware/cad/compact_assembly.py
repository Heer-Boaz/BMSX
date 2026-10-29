"""Integrate physical model rows and separate receiving allocations directly.

Each producer owns its local material checks and emits the same geometry
representation. This owner checks foreign boundaries and service geometry;
actuated cartridge interfaces remain with their native contact-state owner.
"""

import hashlib
import json
from pathlib import Path
from time import perf_counter

import cadquery as cq
from cartridge_polarisation import SPEC, SPEC_PATH
from geometry import bounds, box, overlaps

ROOT = Path(__file__).resolve().parents[1]


def main():
    start = perf_counter()
    records = {}
    receivers = {}
    shapes = {}
    receiving_shapes = {}
    paths = [
        Path(__file__),
        ROOT / "cad/geometry.py",
        ROOT / "cad/check_cartridge_flaps.py",
        ROOT / "cad/cartridge_polarisation.py",
        ROOT / "build/reports/compact-rear-main-clearance.json",
        SPEC_PATH,
    ]
    rear_clearance = json.loads((ROOT / "build/reports/compact-rear-main-clearance.json").read_text())
    assert not rear_clearance["focused_main_material_intersections"], rear_clearance["focused_main_material_intersections"]
    for module in [
        "main-scene",
        "board-body",
        "packaging-fit",
        "front-io",
        "rear-io",
        "controls",
        "cartridge-frame",
        "cooling",
        "structure",
        "cartridge-flaps",
    ]:
        path = ROOT / ("build/reports/compact-" + module + ".json")
        paths.append(path)
        report = json.loads(path.read_text())
        assert not records.keys() & report["physical_parts"].keys()
        records.update(report["physical_parts"])
        receivers.update(report["receiving_spaces"])
    for rows, target in [(records, shapes), (receivers, receiving_shapes)]:
        for name, row in rows.items():
            path = ROOT / row["brep"]
            assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"]
            target[name] = cq.Shape.importBrep(str(path))
    checks = []
    hits = []
    names = list(records)
    for i, name in enumerate(names):
        first = records[name]
        for peer in names[i + 1 :]:
            second = records[peer]
            if first["module"] == second["module"]:
                continue
            if not any(overlaps(a, b) for a in first["regions_mm"] for b in second["regions_mm"]):
                continue
            volume = shapes[name].intersect(shapes[peer]).Volume(tol=1e-10)
            entry = {
                "parts": [name, peer],
                "boundary": sorted([first["module"], second["module"]]),
                "intersection_mm3": volume,
            }
            checks.append(entry)
            if volume > 1e-5:
                hits.append(entry)
    receiving_checks = []
    receiving_hits = []
    receiving_containment = []
    declared_containment = {
        (name, part)
        for name, row in receivers.items()
        if row["module"] == "controls"
        for part in row["contained_parts"]
    }
    for name, row in receivers.items():
        for peer, data in records.items():
            if data["module"] == row["module"] or peer in row["mating_main_refs"]:
                continue
            if not any(overlaps(a, b) for a in row["regions_mm"] for b in data["regions_mm"]):
                continue
            volume = receiving_shapes[name].intersect(shapes[peer]).Volume(tol=1e-10)
            if (name, peer) in declared_containment:
                part_volume = shapes[peer].Volume(tol=1e-10)
                assert abs(volume - part_volume) < 1e-5, (name, peer, volume, part_volume)
                receiving_containment.append(
                    {
                        "receiving_space": name,
                        "contained_part": peer,
                        "intersection_mm3": volume,
                        "part_volume_mm3": part_volume,
                    }
                )
                continue
            entry = {"receiving_space": name, "foreign_part": peer, "intersection_mm3": volume}
            receiving_checks.append(entry)
            if volume > 1e-5:
                receiving_hits.append(entry)
    assert {
        (row["receiving_space"], row["contained_part"]) for row in receiving_containment
    } == declared_containment
    # Visible supplier allocations represent occupied packages, not finished
    # manufacturer material; include them in service and display at that scope.
    occupied = records | {name: row for name, row in receivers.items() if row["visible"]}
    occupied_shapes = shapes | {
        name: receiving_shapes[name] for name, row in receivers.items() if row["visible"]
    }
    service_checks = []
    service_hits = []
    actuated = []
    flaps = json.loads((ROOT / "build/reports/compact-cartridge-flaps.json").read_text())
    for slot, y in enumerate([110, 140]):
        sweep = box([115, y - 9, 34.4, 225, y + 9, 184.4])
        channel = list(SPEC["shell_channel_local_bounds_mm"])
        channel[2], channel[5] = 34.3, 184.5
        channel_shape = box(channel).translate((170, y, 0))
        sweep = sweep.cut(channel_shape).cut(channel_shape.mirror("YZ", (170, y, 0)))
        bb = bounds(sweep)
        for peer, row in occupied.items():
            if row["module"] == "bank":
                continue
            if peer in flaps["actuation_by_slot"][str(slot)]:
                actuated.append(
                    {"slot": slot, "part": peer, "owner": "cad/check_cartridge_flaps.py"}
                )
                continue
            if not any(overlaps(bb, region) for region in row["regions_mm"]):
                continue
            volume = sweep.intersect(occupied_shapes[peer]).Volume(tol=1e-10)
            entry = {
                "service": "CARD_" + str(slot) + "_VERTICAL_EXTRACTION",
                "part": peer,
                "intersection_mm3": volume,
            }
            service_checks.append(entry)
            if volume > 1e-5:
                service_hits.append(entry)
    structure = json.loads((ROOT / "build/reports/compact-structure.json").read_text())
    for name, row in structure["service_envelopes"].items():
        path = ROOT / row["source_BRep"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"]
        sweep = cq.Shape.importBrep(str(path))
        bb = row["bounds_mm"]
        carried = (
            structure["lid_carried_parts"]
            if name.startswith("LID_")
            else structure["bottom_carried_parts"]
        )
        for peer, data in occupied.items():
            if peer in carried or peer in structure["release_screws"]:
                continue
            if name.startswith("LID_") and data["module"] == "bank":
                continue
            if not any(overlaps(bb, region) for region in data["regions_mm"]):
                continue
            volume = sweep.intersect(occupied_shapes[peer]).Volume(tol=1e-10)
            entry = {"service": name, "part": peer, "intersection_mm3": volume}
            service_checks.append(entry)
            if volume > 1e-5:
                service_hits.append(entry)
    bounds_rows = [row["bounds_mm"] for row in occupied.values()]
    lo = [min(row[i] for row in bounds_rows) for i in range(3)]
    hi = [max(row[i + 3] for row in bounds_rows) for i in range(3)]
    report = {
        "scope": __doc__,
        "assembly_state": "closed_no_cartridges",
        "physical_parts": records,
        "receiving_spaces": receivers,
        "parts_count": len(records),
        "visible_receiving_models": sum(row["visible"] for row in receivers.values()),
        "material_checks": checks,
        "material_intersections": hits,
        "receiving_allocation_checks": receiving_checks,
        "receiving_allocation_foreign_intersections": receiving_hits,
        "receiving_declared_containment_checks": receiving_containment,
        "continuous_service_checks": service_checks,
        "continuous_service_intersections": service_hits,
        "actuated_cartridge_interfaces": actuated,
        "actuation_scope": "Supplied insertion/seated poses checked separately; no continuous elastic motion qualification.",
        "native_occupied_extents": {
            "current_assembly": {"bounds_mm": lo + hi, "size_mm": [hi[i] - lo[i] for i in range(3)]}
        },
        "input_sha256": {
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in paths
        },
        "integration_pass": not (hits or receiving_hits or service_hits),
        "fabrication_release": False,
        "thermal_qualification": False,
        "elapsed_seconds": perf_counter() - start,
    }
    (ROOT / "build/reports/compact-assembly.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                "physical_parts": len(records),
                "receiving_spaces": len(receivers),
                "material_hits": hits,
                "receiving_hits": receiving_hits,
                "service_hits": service_hits,
                "elapsed_seconds": report["elapsed_seconds"],
            },
            indent=2,
        )
    )
    assert report["integration_pass"]


if __name__ == "__main__":
    main()
