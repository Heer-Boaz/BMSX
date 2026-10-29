"""Compact fixed controls, native cut tools and connected harness receiving spaces.

The portable control producer owns maker-derived controls, captive mechanics
and hidden inside-up carrier mounts. This owner supplies constructive cable paths;
wire receiving spaces remain separate from fitted component solids.
https://github.com/CadQuery/cadquery/blob/master/cadquery/occ_impl/shapes.py
"""

import hashlib
import json
from itertools import combinations
from pathlib import Path
from time import perf_counter

import cadquery as cq
from control_components import build_controls
from fasteners import fabricate_fasteners
from geometry import bounds, box, cylinder, overlaps

ROOT = Path(__file__).resolve().parents[1]


def main():
    started = perf_counter()
    plan_path = ROOT / "design/enclosure_controls.json"
    plan = json.loads(plan_path.read_text())
    parts, materials, regions, cuts, additions = build_controls(plan)
    generated = ROOT / "build/cad/compact_controls"
    (generated / "cuts").mkdir(parents=True, exist_ok=True)
    (generated / "additions").mkdir(exist_ok=True)
    cutter_rows, addition_rows = [], []
    assert len(cuts) == len(plan["case_cuts"])
    for tool, row in zip(cuts, plan["case_cuts"], strict=True):
        assert tool.isValid(), row["name"]
        path = generated / "cuts" / (row["name"] + ".brep")
        tool.exportBrep(str(path))
        cutter_rows.append(
            dict(
                row,
                source_BRep=str(path.relative_to(ROOT)),
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                bounds_mm=bounds(tool),
            )
        )
    assert len(additions) == len(plan["case_additions"])
    for shape, row in zip(additions, plan["case_additions"], strict=True):
        assert shape.isValid(), row["name"]
        path = generated / "additions" / (row["name"] + ".brep")
        shape.exportBrep(str(path))
        addition_rows.append(
            dict(
                row,
                source_BRep=str(path.relative_to(ROOT)),
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                bounds_mm=bounds(shape),
            )
        )
    case_modifications = {"additions": addition_rows, "cuts": cutter_rows}
    report = {
        "scope": __doc__,
        "case_cuts": cutter_rows,
        "case_modifications": case_modifications,
        "case_attachment_holes_already_covered_by_native_cuts": True,
        "fabrication_release": False,
    }
    fastening_path = ROOT / "design/enclosure_controls_fasteners.json"
    fastening = json.loads(fastening_path.read_text())
    hardware, hardware_materials, hardware_regions = fabricate_fasteners(fastening)
    parts.update(hardware)
    materials.update(hardware_materials)
    spaces = {}
    route_checks = {}
    # The already-decided controls and keyboard routes are receiving tubes,
    # not solid representations of all copper, insulation and empty air.
    routes = [
        (route, None)
        for route in plan["harnesses"]["controls"]["paths"]
        + plan["harnesses"]["keyboard"]["paths"]
    ] + [(plan["harnesses"]["controller"]["bundle_path"], (6.5, 9.5))]
    for route, section in routes:
        edges = []
        for segment in route["segments"]:
            start, end = cq.Vector(*segment["start"]), cq.Vector(*segment["end"])
            if segment["kind"] == "line":
                edge = cq.Edge.makeLine(start, end)
            elif segment["kind"] == "arc":
                edge = cq.Edge.makeThreePointArc(start, cq.Vector(*segment["mid"]), end)
            else:
                edge = cq.Edge.makeBezier(
                    [
                        start,
                        cq.Vector(*segment["control1"]),
                        cq.Vector(*segment["control2"]),
                        end,
                    ]
                )
            edges.append(edge)
        wire = cq.Wire.assembleEdges(edges)
        if section is None:
            plane = cq.Workplane(cq.Plane(origin=edges[0].startPoint(), normal=edges[0].tangentAt(0)))
            profile = plane.circle(route["radius_mm"]).val()
        else:
            plane = cq.Workplane(cq.Plane(origin=edges[0].startPoint(), normal=edges[0].tangentAt(0), xDir=(1, 0, 0)))
            profile = plane.rect(*section).val()
        shape = cq.Solid.sweep(profile, [], wire, makeSolid=True, isFrenet=True)
        name = "RECEIVER__" + route["name"]
        spaces[name] = shape
        joins = [
            first.tangentAt(1).dot(second.tangentAt(0)) for first, second in zip(edges, edges[1:])
        ]
        route_checks[name] = {
            "centreline_length_mm": wire.Length(),
            "minimum_join_tangent_dot": min(joins) if joins else 1,
            "receiving_section_mm": section if section is not None else [2 * route["radius_mm"]],
            "scope": "Receiving space, not finished occupied wire geometry",
        }
    # A shared receiving volume, not twenty automatically routed wire paths.
    # The 20.5 x 4.5 mm exit has 0.5 mm nominal clearance outside the two
    # rows of 1.5 mm wires. R10 gives 7.75 mm on the inside of that volume.
    start, corner = cq.Vector(221, 19, 22.4), cq.Vector(221, 19, 25.4)
    middle = cq.Vector(221, 19 + 10 * (1 - 2**-0.5), 25.4 + 10 * 2**-0.5)
    end = cq.Vector(221, 29, 35.4)
    turn = cq.Wire.assembleEdges([cq.Edge.makeLine(start, corner), cq.Edge.makeThreePointArc(corner, middle, end)])
    profile = cq.Workplane(cq.Plane(origin=start, normal=(0, 0, 1), xDir=(1, 0, 0))).rect(20.5, 4.5).val()
    spaces["RECEIVER__CONTROLLER_J5_R10_EXIT"] = cq.Solid.sweep(profile, [], turn, makeSolid=True, isFrenet=True)
    sections = []
    for x, y, z, width, height in [
        (221, 29, 35.4, 20.5, 4.5),
        (225, 40, 38, 13, 6),
        (229, 57, 41.5, 7.5, 9.5),
        (230, 65, 41.5, 6.5, 9.5),
    ]:
        sections.append(
            cq.Workplane(cq.Plane(origin=(x, y, z), normal=(0, 1, 0), xDir=(1, 0, 0)))
            .rect(width, height)
            .val()
        )
    spaces["RECEIVER__CONTROLLER_J5_GATHER_FANOUT"] = cq.Solid.makeLoft(sections)
    start, end = cq.Vector(230, 65, 41.5), cq.Vector(232.75, 80, 41.5)
    bridge = cq.Edge.makeBezier([start, cq.Vector(230, 70, 41.5), cq.Vector(232.75, 75, 41.5), end])
    profile = cq.Workplane(cq.Plane(origin=start, normal=(0, 1, 0), xDir=(1, 0, 0))).rect(6.5, 9.5).val()
    spaces["RECEIVER__CONTROLLER_FRONT_BRIDGE"] = cq.Solid.sweep(profile, [], cq.Wire.assembleEdges([bridge]), makeSolid=True, isFrenet=True)
    sections = []
    for x, y, z, width, height in [(90, 155, 41.5, 6.5, 9.5), (65, 153, 38, 6, 8), (55, 153, 32, 6, 5), (47, 153, 29, 4, 3)]:
        sections.append(cq.Workplane(cq.Plane(origin=(x, y, z), normal=(-1, 0, 0), xDir=(0, 1, 0))).rect(width, height).val())
    spaces["RECEIVER__CONTROLLER_MAIN_J300_FANOUT"] = cq.Solid.makeLoft(sections).fuse(box([27.5, 149, 20.4, 50.5, 157, 32.4])).clean()
    for entry in (
        plan["harnesses"]["controls"]["terminal_fanouts"] + plan["harnesses"]["keyboard"]["fanouts"]
    ):
        spaces["RECEIVER__" + entry["name"]] = box(entry["bounds_mm"])
    for ref, receiver in plan["fixed_receivers"].items():
        if ref != "heatsink":
            spaces["RECEIVER__" + ref.upper()] = box(receiver)

    # One local analytic fit: actual control parts against each other,
    # the locally constructed roof and the preserved receiving spaces.
    # Whole-case foreign fit remains at the integrating owner.
    roof = box([0, 0, plan["panel_inside_Z_mm"], 240, 40, plan["panel_top_Z_mm"]])
    roof = roof.fuse(*additions).cut(*cuts).clean()
    assert roof.isValid() and len(roof.Solids()) == 1
    local_parts = {**parts, "LOCAL_CONTROL_ROOF": roof}
    local_bounds = {name: bounds(shape) for name, shape in local_parts.items()}
    material_checks, material_hits, receiver_checks, receiver_hits = [], [], [], []
    for (name, shape), (other_name, other_shape) in combinations(local_parts.items(), 2):
        if overlaps(local_bounds[name], local_bounds[other_name]):
            volume = shape.intersect(other_shape).Volume()
            row = {"parts": [name, other_name], "intersection_mm3": volume}
            material_checks.append(row)
            if volume > 1e-6:
                material_hits.append(row)
    mounts = {
        name: shape
        for name, shape in parts.items()
        if name == "TOP_CONTROLS__PA12_SLIDE_CARRIER"
        or name.startswith("FASTENER__TOP_CARRIER_")
        or name.startswith("TOP_CONTROLS__SPIROL_")
    }
    for name, shape in mounts.items():
        for other_name, receiver in spaces.items():
            if overlaps(local_bounds[name], bounds(receiver)):
                volume = shape.intersect(receiver).Volume()
                row = {"part": name, "receiver": other_name, "intersection_mm3": volume}
                receiver_checks.append(row)
                if volume > 1e-6:
                    receiver_hits.append(row)
    mount = plan["power"]["internal_mount"]
    insert = mount["insert"]
    roof_witnesses = []
    for i, (x, y) in enumerate(plan["power"]["carrier_mount_XY_mm"]):
        witness = cylinder(
            [x, y, mount["blind_bore_Z_mm"][1]],
            [0, 0, 1],
            insert["overknurl_diameter_ref_mm"] / 2,
            mount["remaining_roof_skin_mm"],
        )
        volume = roof.intersect(witness).Volume()
        assert abs(volume - witness.Volume()) < 1e-6, i
        roof_witnesses.append(
            {
                "joint": "TOP_CARRIER_" + str(i),
                "closed_skin_Z_mm": [55.2, 56],
                "native_closed_skin_volume_mm3": volume,
                "complete_witness_retained": True,
            }
        )
    report["local_fit"] = {
        "roof_scope_mm": bounds(roof),
        "material_checks": material_checks,
        "material_intersections": material_hits,
        "mount_to_preserved_receiver_checks": receiver_checks,
        "mount_to_preserved_receiver_intersections": receiver_hits,
        "blind_roof_witnesses": roof_witnesses,
        "all_four_screw_heads_inside": all(
            joint["under_head_position_mm"][2] < plan["panel_inside_Z_mm"]
            and joint["screw"]["head_top_axis_mm"] < plan["panel_inside_Z_mm"]
            for joint in fastening["fastening_interfaces"][:4]
        ),
        "nominal_insert_thread_engagement_mm": 3.18,
        "nominal_screw_tip_to_blind_end_mm": 0.5,
        "mount_fit_pass": not (material_hits or receiver_hits),
        "scope": "One local control fit including original functional parts; no foreign PCB/ports/cooling or whole-shell qualification.",
    }
    assembly = cq.Assembly(name="BMSX_COMPACT_FIXED_CONTROLS_AND_SEPARATE_RECEIVERS")
    physical_rows, space_rows = {}, {}
    (generated / "parts").mkdir(exist_ok=True)
    (generated / "receivers").mkdir(exist_ok=True)
    # Removed top-carrier nuts must not linger as current generated hardware.
    for i in range(4):
        (generated / "parts" / ("FASTENER__TOP_CARRIER_" + str(i) + "_NUT.brep")).unlink(
            missing_ok=True
        )
    for collection, ledger, folder, color in [
        (parts, physical_rows, "parts", (0.28, 0.31, 0.34)),
        (spaces, space_rows, "receivers", (0.15, 0.6, 0.85)),
    ]:
        for name, shape in collection.items():
            assert shape.isValid(), name
            path = generated / folder / (name + ".brep")
            shape.exportBrep(str(path))
            ledger[name] = {
                "brep": str(path.relative_to(ROOT)),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "bounds_mm": bounds(shape),
                "regions_mm": [bounds(shape)],
                "module": "controls",
                "volume_mm3": shape.Volume(),
                "solids": len(shape.Solids()),
                "occupied_physical_part": folder == "parts",
            }
            if folder == "receivers":
                ledger[name].update(
                    mating_main_refs=plan["receiving_mating_refs"][name],
                    contained_parts=plan["receiving_contained_parts"][name],
                    visible=False,
                )
            assembly.add(shape, name=name, color=cq.Color(*color))
    target = ROOT / "build/exports/BMSX_COMPACT_controls.step"
    assembly.export(str(target))
    restored = {
        name.rsplit("/", 1)[-1]: shape.located(loc)
        for shape, name, loc, color in cq.Assembly.importStep(str(target))
    }
    expected = {**parts, **spaces}
    assert restored.keys() == expected.keys()
    for name, shape in restored.items():
        assert shape.isValid(), name
        assert len(shape.Solids()) == len(expected[name].Solids()), name
        assert (
            max(abs(a - b) for a, b in zip(bounds(shape), bounds(expected[name]), strict=True))
            < 1e-5
        ), name
        assert abs(shape.Volume() - expected[name].Volume()) < 1e-5, name
    sources = [
        Path(__file__),
        plan_path,
        fastening_path,
        ROOT / "cad/geometry.py",
        ROOT / "cad/fasteners.py",
        ROOT / "cad/fixtures.py",
    ] + [ROOT / "cad/control_components.py", ROOT / "models/controls/references.json"]
    report.update(
        {
            "physical_parts": physical_rows,
            "receiving_spaces": space_rows,
            "route_checks": route_checks,
            "native_named_STEP_roundtrip": {
                "parts": len(restored),
                "valid_names_solids_bounds_volumes_pass": True,
            },
            "input_sha256": {
                str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in sources
            },
            "output_sha256": {
                str(target.relative_to(ROOT)): hashlib.sha256(target.read_bytes()).hexdigest()
            },
            "materials": materials,
            "electrical_maps": plan["electrical_maps"],
            "packing": plan["harnesses"]["controller"]["packing"],
            "open_points": [
                "Receiving spaces and fanouts are constructive enclosure allocations, not finished loom or production crimp qualification.",
                "Individual terminal dressing, insulated switch GND splice, LED470R, relaxed service slack and actual jig cut lengths remain assembly acceptance.",
                "Root owns integrated collisions with the current shell, board, cards, sinks and other modules; no full collider pass was run here.",
            ],
            "elapsed_seconds": perf_counter() - started,
        }
    )
    (ROOT / "build/reports/compact-controls.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                "case_cuts": len(cutter_rows),
                "physical_parts": len(report["physical_parts"]),
                "case_additions": len(addition_rows),
                "receiving_spaces": len(report["receiving_spaces"]),
                "local_fit_pass": report["local_fit"]["mount_fit_pass"],
                "elapsed_seconds": perf_counter() - started,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
