"""Native compact chassis and cable-free service lid.

CadQuery/OCC boolean, fillet and named-assembly owners are used directly:
https://github.com/CadQuery/cadquery/blob/master/cadquery/occ_impl/shapes.py
https://github.com/CadQuery/cadquery/blob/master/cadquery/assembly.py
Port/fixture producers own their real cut geometry; this owner consumes it.
No enclosure-fit waiver, old-case stock, or inferred missing supplier part.
"""

import hashlib
import json
from pathlib import Path
from time import perf_counter

import cadquery as cq
from case_closure import build_closure, service_envelopes
from enclosure_style import apply_native_colours, face_paints, outer_shell_stock
from fasteners import fabricate_fasteners
from fixtures import hole_shape
from geometry import bounds, box, cylinder, overlaps, rounded_prism, rounded_top_prism

ROOT = Path(__file__).resolve().parents[1]


def main():
    start = perf_counter()
    source_paths = [
        ROOT / "design" / name
        for name in [
            "enclosure_structure.json",
            "enclosure_front_io.json",
            "enclosure_rear_io.json",
            "enclosure_controls.json",
            "enclosure_cartridge_frame.json",
            "enclosure_cooling.json",
        ]
    ]
    spec, front, rear, controls, frame, cooling = [json.loads(p.read_text()) for p in source_paths]
    style_path = ROOT / "design/enclosure_styling.json"
    style = json.loads(style_path.read_text())
    source_paths.append(style_path)
    appearance_path = ROOT / "design/enclosure_appearance.json"
    appearance = json.loads(appearance_path.read_text())
    source_paths.append(appearance_path)
    case = spec["case"]
    base_spec = spec["base"]
    parts = {}
    materials = {}
    shell = outer_shell_stock(style).cut(
        rounded_top_prism(
            case["inner_bounds_mm"], case["inner_plan_radius_mm"], case["inner_top_radius_mm"]
        )
    )
    shell = shell.cut(rounded_prism(case["lid_opening_mm"], case["lid_opening_radius_mm"]))
    lid = rounded_prism(case["lid_bounds_mm"], case["lid_plan_radius_mm"])
    well = style["cartridge_well"]
    lid = lid.cut(rounded_prism(well["bounds_mm"], well["radius_mm"]))
    base = rounded_prism(base_spec["bounds_mm"], base_spec["plan_radius_mm"])
    for row in base_spec["local_ribs"]:
        base = base.fuse(box(row["bounds_mm"]))
    pads = base_spec["rear_screw_seating_pads"]
    for x, y in pads["axes_XY_mm"]:
        base = base.fuse(
            cylinder(
                (x, y, pads["lower_Z_mm"]),
                (0, 0, 1),
                pads["OD_mm"] / 2,
                pads["upper_Z_mm"] - pads["lower_Z_mm"],
            )
        )
    for row in base_spec["rear_screw_seating_bridges"]:
        base = base.fuse(box(row["bounds_mm"]))
    for row in spec["cartridge_roof_apertures"]:
        x, y = row["centre_XY_mm"]
        w, h = row["size_XY_mm"]
        lid = lid.cut(
            rounded_prism(
                [x - w / 2, y - h / 2, 52.9, x + w / 2, y + h / 2, 56.1], row["radius_mm"]
            )
        )
    for row in front["case_apertures"]:
        shell = shell.cut(box(row["bounds_mm"]))
    for row in rear["rear_wall"]["clearance_cutboxes"]:
        shell = shell.cut(box(row["bounds_mm"]))
    for owner in [front, rear["fixtures"]]:
        for hole in owner["case_attachment_holes"]:
            if hole["target"] == "lower_shell":
                shell = shell.cut(hole_shape(hole))
            else:
                base = base.cut(hole_shape(hole))
        for row in owner["case_clearance_cutboxes"]:
            shell = shell.cut(box(row["bounds_mm"]))
    for row in spec["vents"]["base_intake_slots"]:
        base = base.cut(rounded_prism(row["bounds_mm"], row["radius_mm"]))
    for row in spec["vents"]["rear_outlet_slots"]:
        shell = shell.cut(rounded_prism(row["bounds_mm"], row["radius_mm"], row["axis"]))
    stands = spec["mainboard_stands"]
    for i, (x, y) in enumerate(stands["axes_XY_mm"]):
        for label, key in [
            ("G10_STAND", "stand_range_Z_mm"),
            ("G10_TOP_WASHER", "top_insulator_range_Z_mm"),
        ]:
            lo, hi = stands[key]
            shape = cylinder((x, y, lo), (0, 0, 1), stands["OD_mm"] / 2, hi - lo).cut(
                cylinder((x, y, lo - 0.1), (0, 0, 1), stands["bore_mm"] / 2, hi - lo + 0.2)
            )
            name = "MAIN__" + label + "_" + str(i)
            parts[name] = shape
            materials[name] = "G10"
        base = base.cut(cylinder((x, y, 0.9), (0, 0, 1), stands["bore_mm"] / 2, 2.2))
    # The frame owns its exact lug stack and mounting cuts. No guessed holes.
    for row in frame["base_additions"]:
        base = base.fuse(
            cylinder(row["origin_mm"], row["direction"], row["diameter_mm"] / 2, row["length_mm"])
        )
    for row in frame["base_holes"] + cooling["base_holes"]:
        base = base.cut(hole_shape(row))
    # All stock additions precede the final base drilling. Foot bosses are
    # machined with access counterbores for nearby board/case screw heads.
    for key in ["mainboard_stands"]:
        for x, y in spec[key]["axes_XY_mm"]:
            base = base.cut(cylinder((x, y, 0.9), (0, 0, 1), 1.7, 2.2))
    for row in base_spec["fastener_head_access"]:
        base = base.cut(hole_shape(row))
    shell, lid, base, closure_parts, closure_materials, case_regions = build_closure(
        shell, lid, base, spec
    )
    parts.update(closure_parts)
    materials.update(closure_materials)
    workpieces = {"lower_shell": shell, "chassis": base, "removable_lid": lid}
    for module in ["front-io", "rear-io", "controls", "cartridge-flaps"]:
        report_path = ROOT / ("build/reports/compact-" + module + ".json")
        source_paths.append(report_path)
        owner = json.loads(report_path.read_text())
        for operation in ["additions", "cuts"]:
            for row in owner["case_modifications"][operation]:
                path = ROOT / row["source_BRep"]
                source_paths.append(path)
                assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"]
                tool = cq.Shape.importBrep(str(path))
                target = row["target"]
                workpieces[target] = (
                    workpieces[target].fuse(tool)
                    if operation == "additions"
                    else workpieces[target].cut(tool)
                )
                if operation == "additions" and target == "lower_shell":
                    case_regions.append(bounds(tool))
    shell = workpieces["lower_shell"]
    base = workpieces["chassis"]
    lid = workpieces["removable_lid"]
    parts.update(
        {
            "CASE__FIXED_BODY": shell.clean(),
            "CASE__REMOVABLE_LID": lid.clean(),
            "CASE__ALUMINIUM_BASE": base.clean(),
        }
    )
    materials.update(
        {
            "CASE__FIXED_BODY": "PC-ABS proposal, prototype printed PA12",
            "CASE__REMOVABLE_LID": "PC-ABS proposal, prototype printed PA12",
            "CASE__ALUMINIUM_BASE": "6061-T6 aluminium",
        }
    )
    hardware, hwmaterials, _ = fabricate_fasteners(spec["fastener_plan"])
    parts.update(hardware)
    materials.update(hwmaterials)
    names = list(parts)
    boxes = {n: bounds(s) for n, s in parts.items()}
    checks = []
    hits = []
    for i, a in enumerate(names):
        assert parts[a].isValid() and len(parts[a].Solids()) == 1, (a, len(parts[a].Solids()))
        for b in names[i + 1 :]:
            if not overlaps(boxes[a], boxes[b]):
                continue
            v = parts[a].intersect(parts[b]).Volume()
            row = {"parts": [a, b], "intersection_mm3": v}
            checks.append(row)
            if v > 1e-5:
                hits.append(row)
    out = ROOT / "build/cad/compact_structure"
    out.mkdir(parents=True, exist_ok=True)
    assembly = cq.Assembly(name="BMSX_COMPACT_STRUCTURE")
    rows = {}
    for name, shape in parts.items():
        path = out / (name + ".brep")
        assert shape.exportBrep(str(path))
        assembly.add(
            shape,
            name=name,
            color=cq.Color(*appearance["palette"]["shell"])
            if name in ["CASE__FIXED_BODY", "CASE__REMOVABLE_LID"]
            else None,
        )
        paints = face_paints(name, shape, style)
        apply_native_colours(assembly, name, shape, paints, appearance)
        rows[name] = {
            "brep": str(path.relative_to(ROOT)),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bounds_mm": boxes[name],
            "regions_mm": [boxes[name]],
            "module": "structure",
            "volume_mm3": shape.Volume(),
            "valid": True,
            "solids": 1,
            "material": materials[name],
            "face_paints": paints,
        }
        if name == "CASE__FIXED_BODY":
            # Positive stock coverage, including the inner plan corner and
            # rolled shoulder. Cutouts can remove stock, never add an obstacle.
            rows[name]["regions_mm"] = (
                [
                    [-5, -5, 3, 3.5, 195, 56],
                    [236.5, -5, 3, 245, 195, 56],
                    [-5, -5, 3, 245, 3.5, 56],
                    [-5, 186.5, 3, 245, 195, 56],
                    [-5, -5, 52.5, 245, 36.4, 56],
                    [-5, 178.6, 52.5, 245, 195, 56],
                    [-5, -5, 52.5, 4.9, 195, 56],
                    [235.1, -5, 52.5, 245, 195, 56],
                ]
                + [[x, y, 3, x + 15, y + 15, 56] for x in [-5, 230] for y in [-5, 180]]
                + case_regions
            )
    flap_path = ROOT / "build/reports/compact-cartridge-flaps.json"
    flaps = json.loads(flap_path.read_text())
    service_shapes = service_envelopes(spec)
    for name, row in flaps["physical_parts"].items():
        x, y, z, X, Y, Z = row["bounds_mm"]
        service_shapes["LID_" + name] = box([x, y, z, X, Y, 131])
        if name.endswith("__LEAF"):
            sweep = flaps["lid_leaf_service_envelopes"][name]
            path = ROOT / sweep["brep"]
            assert hashlib.sha256(path.read_bytes()).hexdigest() == sweep["sha256"]
            service_shapes["LID_" + name] = cq.Shape.importBrep(str(path))
    service_rows = {}
    for name, shape in service_shapes.items():
        path = out / ("SERVICE__" + name + ".brep")
        assert shape.exportBrep(str(path))
        service_rows[name] = {
            "source_BRep": str(path.relative_to(ROOT)),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bounds_mm": bounds(shape),
        }
    target = ROOT / "build/exports/BMSX_COMPACT_structure.step"
    assembly.export(str(target))
    back = cq.importers.importStep(str(target)).val()
    assert back.isValid() and len(back.Solids()) == len(parts)
    assert (
        abs(
            sum(s.Volume(tol=1e-10) for s in back.Solids())
            - sum(s.Volume(tol=1e-10) for s in parts.values())
        )
        < 1e-4
    )
    report = {
        "scope": __doc__,
        "receiving_spaces": {},
        "physical_parts": rows,
        "input_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in source_paths
            + [
                Path(__file__),
                ROOT / "cad/geometry.py",
                ROOT / "cad/fixtures.py",
                ROOT / "cad/fasteners.py",
                ROOT / "cad/enclosure_style.py",
                ROOT / "cad/case_closure.py",
            ]
        },
        "service_envelopes": service_rows,
        "lid_carried_parts": spec["closure"]["lid_carried_parts"] + list(flaps["physical_parts"]),
        "release_screws": spec["closure"]["release_screws"],
        "bottom_carried_parts": spec["bottom_cover"]["carried_parts"],
        "checks": checks,
        "material_intersections": hits,
        "overlap_allowlist": [],
        "STEP_roundtrip": {"valid": True, "solids": len(parts), "volume_sum_pass": True},
        "exports": {str(target.relative_to(ROOT)): hashlib.sha256(target.read_bytes()).hexdigest()},
        "elapsed_seconds": perf_counter() - start,
        "fabrication_release": False,
    }
    (ROOT / "build/reports/compact-structure.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                "parts": len(parts),
                "checks": len(checks),
                "hits": hits,
                "elapsed_seconds": report["elapsed_seconds"],
            }
        )
    )
    assert not hits, hits


if __name__ == "__main__":
    main()
