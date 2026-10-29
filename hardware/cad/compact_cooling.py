"""Passive sink receiving stock, real mount geometry and two TIM interfaces.

The manufacturer profile's maximum occupied box is an explicit procurement
receiving model, not invented fins or a thermal surface-area calculation.
Only the known 4.3mm continuous base is machined with two blind M3 pilots.
CadQuery's production Boolean/export owners are used directly. No fan,
50C air requirement, undocumented clamp or performance derating is present.
"""

import hashlib
import json
from pathlib import Path
from time import perf_counter

import cadquery as cq
from fasteners import fabricate_fasteners
from geometry import bounds, box, cylinder, overlaps

ROOT = Path(__file__).resolve().parents[1]


def main():
    start = perf_counter()
    spec_path = ROOT / "design/enclosure_cooling.json"
    spec = json.loads(spec_path.read_text())
    parts = {}
    materials = {}
    sink = box(spec["sink"]["receiving_bounds_mm"])
    for row in spec["sink"]["blind_pilots"]:
        sink = sink.cut(
            cylinder(row["origin_mm"], (0, 0, 1), row["diameter_mm"] / 2, row["depth_mm"])
        )
    parts["COOLING__SK50875_MACHINED_RECEIVING"] = sink
    materials["COOLING__SK50875_MACHINED_RECEIVING"] = (
        "Black aluminium profile receiving envelope; fins not modelled"
    )
    for row in spec["support_posts"]:
        x, y = row["axis_XY_mm"]
        lo, hi = row["range_Z_mm"]
        post = cylinder((x, y, lo), (0, 0, 1), row["OD_mm"] / 2, hi - lo)
        if "bridge_bounds_mm" in row:
            post = post.fuse(box(row["bridge_bounds_mm"])).cut(
                cylinder((169, 58, 15.6), (0, 0, 1), 1.7, 1.2)
            )
        post = post.cut(cylinder((x, y, 2.9), (0, 0, 1), 1.25, 8.6))
        if "top_stud" in row:
            lo, hi = row["top_stud"]["range_Z_mm"]
            post = post.fuse(
                cylinder((x, y, lo), (0, 0, 1), row["top_stud"]["CAD_thread_core_mm"] / 2, hi - lo)
            )
        parts[row["name"]] = post.clean()
        materials[row["name"]] = "6061-T6 aluminium, machined integral support/bridge"
    for row in spec["TIMs"]:
        parts[row["name"]] = box(row["bounds_mm"])
        materials[row["name"]] = (
            "Electrically insulating compliant TIM, material/pressure to qualify"
        )
    hardware, hwmat, _ = fabricate_fasteners(spec["fastener_plan"])
    parts.update(hardware)
    materials.update(hwmat)
    boxes = {n: bounds(s) for n, s in parts.items()}
    checks = []
    hits = []
    names = list(parts)
    main_path = ROOT / "build/reports/compact-main-scene.json"
    main = json.loads(main_path.read_text())
    main_checks = []
    for i, a in enumerate(names):
        assert parts[a].isValid() and len(parts[a].Solids()) == 1, a
        for b in names[i + 1 :]:
            if not overlaps(boxes[a], boxes[b]):
                continue
            v = parts[a].intersect(parts[b]).Volume()
            r = {"parts": [a, b], "intersection_mm3": v}
            checks.append(r)
            if v > 1e-5:
                hits.append(r)
    for main_name, row in main["physical_parts"].items():
        candidates = [n for n in names if overlaps(boxes[n], row["bounds_mm"])]
        if not candidates:
            continue
        path = ROOT / row["brep"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == main["output_sha256"][row["brep"]]
        peer = cq.Shape.importBrep(str(path))
        for name in candidates:
            v = parts[name].intersect(peer).Volume()
            r = {"parts": [name, main_name], "intersection_mm3": v}
            main_checks.append(r)
            if v > 1e-5:
                hits.append(r)
    out = ROOT / "build/cad/compact_cooling"
    out.mkdir(parents=True, exist_ok=True)
    assembly = cq.Assembly(name="BMSX_COMPACT_PASSIVE_COOLING")
    records = {}
    for name, shape in parts.items():
        path = out / (name + ".brep")
        assert shape.exportBrep(str(path))
        assembly.add(shape, name=name)
        records[name] = {
            "brep": str(path.relative_to(ROOT)),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bounds_mm": boxes[name],
            "regions_mm": [boxes[name]],
            "module": "cooling",
            "volume_mm3": shape.Volume(),
            "valid": True,
            "solids": 1,
            "material": materials[name],
        }
    target = ROOT / "build/exports/BMSX_COMPACT_cooling.step"
    assembly.export(str(target))
    back = cq.importers.importStep(str(target)).val()
    assert (
        back.isValid()
        and len(back.Solids()) == len(parts)
        and abs(back.Volume() - sum(s.Volume() for s in parts.values())) < 1e-5
    )
    report = {
        "scope": __doc__,
        "receiving_spaces": {},
        "physical_parts": records,
        "checks": checks,
        "main_checks": main_checks,
        "material_intersections": hits,
        "overlap_allowlist": [],
        "input_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [
                spec_path,
                Path(__file__),
                ROOT / "cad/geometry.py",
                ROOT / "cad/fasteners.py",
                main_path,
            ]
        },
        "exports": {str(target.relative_to(ROOT)): hashlib.sha256(target.read_bytes()).hexdigest()},
        "STEP_roundtrip_valid_solids_volume_pass": True,
        "elapsed_seconds": perf_counter() - start,
        "thermal_qualification": False,
        "fabrication_release": False,
    }
    (ROOT / "build/reports/compact-cooling.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                "parts": len(parts),
                "checks": len(checks) + len(main_checks),
                "hits": hits,
                "seconds": report["elapsed_seconds"],
            }
        )
    )
    assert not hits, hits


if __name__ == "__main__":
    main()
