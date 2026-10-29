"""Native front receiving models and inside-only blind case-boss mounting.

Inputs are portable sealed R4 BReps with hashes; no substitution model. The
frontboard is the real new KiCad drilled contour, nominal1.60mm via board_model.
Complete-mate receiving envelopes are exported separately from physical parts.
CadQuery production import/export: https://github.com/CadQuery/cadquery/blob/master/cadquery/occ_impl/importers/__init__.py
"""

import hashlib
import json
from pathlib import Path
from time import monotonic

import cadquery as cq
from board_model import load_board_solid, nominal_board_in_assembly
from fasteners import fabricate_fasteners, screw_shape
from fixtures import fabricate
from geometry import bounds, box, cylinder, overlaps

ROOT = Path(__file__).resolve().parents[1]


def main():
    started = monotonic()
    spec_path = ROOT / "design/enclosure_front_io.json"
    spec = json.loads(spec_path.read_text())
    manifest_path = ROOT / spec["source_manifest"]
    manifest = json.loads(manifest_path.read_text())
    generated = ROOT / "build/cad/compact_front_io"
    generated.mkdir(parents=True, exist_ok=True)
    # Integral case stock is a construction ledger, never an extra physical part.
    # The structure owner fuses stock before applying these blind pilot cuts.
    case_modifications = {"additions": [], "cuts": []}
    case_mount_solids = {}
    for mount in spec["blind_front_mounts"]:
        name = mount["id"]
        x, _, z = mount["centre_mm"]
        lo, hi = mount["boss_stock_range_mm"]
        stock = cylinder((x, lo, z), (0, 1, 0), mount["boss_diameter_mm"] / 2, hi - lo)
        lo, hi = mount["pilot_range_mm"]
        pilot = cylinder((x, lo, z), (0, 1, 0), mount["pilot_diameter_mm"] / 2, hi - lo)
        for kind, shape in [("additions", stock), ("cuts", pilot)]:
            path = generated / ("CASE_" + kind.upper() + "__" + name + ".brep")
            assert shape.isValid() and len(shape.Solids()) == 1
            assert shape.exportBrep(str(path))
            case_modifications[kind].append(
                {
                    "source_BRep": str(path.relative_to(ROOT)),
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "target": "lower_shell",
                    "bounds_mm": bounds(shape),
                    "regions_mm": [bounds(shape)],
                    "module": "front-io",
                    "mating_main_refs": [],
                    "visible": False,
                }
            )
        case_mount_solids[name] = (stock, pilot)
    physical = {}
    materials = {}
    records = {}
    for name, row in manifest["parts"].items():
        path = ROOT / row["brep"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"]
        shape = cq.Shape.importBrep(str(path))
        if name == "FRONT__J5_JST_PHD_BODY":
            material = "manufacturer_nominal_body_envelope"
        elif name.startswith("FRONT__PAD_"):
            original_x = int(name.split("_")[3])
            transform = next(t for t in spec["pad_transforms"] if t["original_x_mm"] == original_x)
            shape = shape.translate(tuple(transform["translation_mm"]))
            material = "brass" if "_CONTACT_" in name else "pad_proposal_insulator"
        else:
            transform = spec["keyboard_transform"]
            shape = shape.rotate((0, 0, 0), (0, 0, 1), transform["rotation_Z_deg"]).translate(
                tuple(transform["translation_mm"])
            )
            material = "fr4" if name.endswith("_BOARD") else "manufacturer_max_body"
        assert shape.isValid() and len(shape.Solids()) == 1
        physical[name] = shape
        materials[name] = material
    native_path = ROOT / "build/exports/BMSX_FRONT_board_native.step"
    board_report = {
        "native_step": str(native_path.relative_to(ROOT)),
        "sha256": hashlib.sha256(native_path.read_bytes()).hexdigest(),
        "pose": spec["board_pose"],
    }
    native = load_board_solid(native_path)
    board = nominal_board_in_assembly(
        native, spec["board_pose"]["top_z_mm"], spec["board_pose"]["thickness_mm"]
    )
    board_bounds = bounds(board)
    expected_bounds = [35, 7, 12, 237, 25, 13.6]
    assert max(abs(a - b) for a, b in zip(board_bounds, expected_bounds)) < 1e-6
    area = next(
        face.Area()
        for face in board.Faces()
        if face.geomType() == "PLANE" and face.normalAt().z > 0.99
    )
    # KiCad PTH dielectricholes include its0.025mmplating allowance: compare
    # actual cylindricalwalls rather than claiming finisheddrill equalscore.
    cylinders = [face for face in board.Faces() if face.geomType() == "CYLINDER"]
    assert len(cylinders) == 64
    assert len(board.Solids()) == 1 and board.isValid()
    physical["FRONT__COMPACT_NATIVE_DRILLED_BOARD"] = board
    materials["FRONT__COMPACT_NATIVE_DRILLED_BOARD"] = "fr4"
    fixture_parts, fixture_materials, fixture_regions, _, _, _ = fabricate([spec])
    fastener_parts, fastener_materials, _ = fabricate_fasteners(spec["fastener_plan"])
    physical.update(fixture_parts)
    materials.update(fixture_materials)
    physical.update(fastener_parts)
    materials.update(fastener_materials)
    mount_witnesses = []
    for mount in spec["blind_front_mounts"]:
        name = mount["id"]
        x, _, z = mount["centre_mm"]
        stock, pilot = case_mount_solids[name]
        wall = box([x - 4, 0, z - 4, x + 4, 3, z + 4])
        for aperture in spec["case_apertures"]:
            wall = wall.cut(box(aperture["bounds_mm"]))
        case_section = wall.fuse(stock).cut(pilot).clean()
        assert case_section.isValid() and len(case_section.Solids()) == 1
        group = mount["retainer_group"]
        retainer = physical[group]
        inner_washer = physical["FASTENER__" + name + "_INNER_WASHER"]
        screw = physical["FASTENER__" + name + "_SCREW"]
        boss_retainer = case_section.intersect(retainer).Volume()
        screw_case = case_section.intersect(screw).Volume()
        # Thin material sections witness actual bearing faces, not proximity.
        foot_area = retainer.intersect(box([x - 3, 3, z - 4, x + 3, 3.001, z + 4])).Volume() / 0.001
        washer_seat_area = (
            retainer.intersect(inner_washer.translate((0, -0.001, 0))).Volume() / 0.001
        )
        assert boss_retainer < 1e-5 and screw_case < 1e-5, (name, boss_retainer, screw_case)
        assert foot_area > 1 and washer_seat_area > 1, (name, foot_area, washer_seat_area)
        assert bounds(screw)[1] >= 1.8 - 1e-6 and bounds(inner_washer)[1] >= 6.5 - 1e-6
        interface = next(
            a for a in spec["fastener_plan"]["fastening_interfaces"] if a["id"] == name
        )
        extremes = []
        for label, under, tip in [
            ("short_screw_thick_washer", 6.85, 1.95),
            ("long_screw_thin_washer", 6.75, 1.65),
        ]:
            placement = {
                **interface,
                "under_head_position_mm": [x, under, z],
                "tip_position_mm": [x, tip, z],
                "screw": {**interface["screw"], "head_top_axis_mm": under + 2},
            }
            extreme = screw_shape(placement, spec["fastener_plan"]["components"]["M2_CAP_5"])
            volume = extreme.intersect(case_section).Volume()
            assert extreme.isValid() and volume < 1e-5, (name, label, volume)
            assert tip >= interface["tapped_engagement"]["axis_range_mm"][0]
            extremes.append(
                {
                    "receiving_case": label,
                    "screw_bounds_mm": bounds(extreme),
                    "screw_case_material_intersection_mm3": volume,
                    "tip_to_pilot_bottom_mm": tip - mount["pilot_range_mm"][0],
                }
            )
        mount_witnesses.append(
            {
                "id": name,
                "case_section_valid": True,
                "case_section_solids": len(case_section.Solids()),
                "boss_retainer_material_intersection_mm3": boss_retainer,
                "screw_case_material_intersection_mm3": screw_case,
                "retainer_wall_bearing_area_mm2": foot_area,
                "retainer_rear_seat_material_area_mm2": washer_seat_area,
                "screw_bounds_mm": bounds(screw),
                "inside_washer_bounds_mm": bounds(inner_washer),
                "minimum_front_skin_mm": mount["front_skin_minimum_mm"],
                "minimum_thread_engagement_mm": mount[
                    "minimum_thread_engagement_at_shortest_screw_mm"
                ],
                "maximum_length_tip_bottom_clearance_mm": mount[
                    "minimum_screw_tip_to_pilot_bottom_at_longest_screw_mm"
                ],
                "boss_end_to_retainer_counterbore_end_mm": 0.1,
                "receiving_extreme_checks": extremes,
                "load_path": mount["load_path"],
            }
        )
    mates = {row["name"]: box(row["bounds_mm"]) for row in spec["connector_mate_envelopes"]}
    checks = []
    collisions = []
    # One focused broadphase+narrowphase of this smallsubassembly only. It
    # includes actual shafts/nuts/washers, not whitelist/suppression pairs.
    names = list(physical)
    boxes = {name: bounds(shape) for name, shape in physical.items()}
    for index, name in enumerate(names):
        shape = physical[name]
        assert shape.isValid() and len(shape.Solids()) == 1, name
        for peer in names[index + 1 :]:
            if not overlaps(boxes[name], boxes[peer]):
                continue
            volume = shape.intersect(physical[peer]).Volume()
            checks.append({"parts": [name, peer], "intersection_mm3": volume})
            if volume > 1e-5:
                collisions.append(checks[-1])
    # The keyboard header is a deliberately contained part of its own
    # mating volume, not a collision with that volume. Check actual containment;
    # all other parts remain obstacles and are checked as before.
    contained_parts = {row["name"]: row["contained_parts"] for row in spec["connector_mate_envelopes"]}
    assert contained_parts["FRONT_J5_COMPLETE_MATE_ACCEPTANCE"] == ["FRONT__J5_JST_PHD_BODY"]
    assert contained_parts["KEYBOARD_J2_COMPLETE_MATE_ACCEPTANCE"] == ["KEYBOARD__J2_JST_PH_BODY"]
    mate_checks = []
    mate_containment = []
    for name, envelope in mates.items():
        for peer, shape in physical.items():
            if not overlaps(bounds(envelope), boxes[peer]):
                continue
            volume = envelope.intersect(shape).Volume()
            if peer in contained_parts[name]:
                assert abs(volume - shape.Volume()) < 1e-5, (name, peer, volume, shape.Volume())
                mate_containment.append({"envelope": name, "part": peer, "intersection_mm3": volume})
                continue
            # The associated board is the matingdatum, not an obstacle; its
            # actual volume ends at theenvelopebottomplane in both cases.
            mate_checks.append({"envelope": name, "part": peer, "intersection_mm3": volume})
    main_report_path = ROOT / "build/reports/compact-main-scene.json"
    main_report = json.loads(main_report_path.read_text())
    main_checks = []
    for main_name, row in main_report["physical_parts"].items():
        candidates = [name for name in names if overlaps(boxes[name], row["bounds_mm"])]
        mate_candidates = [
            name for name, shape in mates.items() if overlaps(bounds(shape), row["bounds_mm"])
        ]
        if not candidates and not mate_candidates:
            continue
        path = ROOT / row["brep"]
        assert (
            hashlib.sha256(path.read_bytes()).hexdigest()
            == main_report["output_sha256"][row["brep"]]
        )
        shape = cq.Shape.importBrep(str(path))
        for name in candidates:
            main_checks.append(
                {
                    "parts": [name, main_name],
                    "intersection_mm3": physical[name].intersect(shape).Volume(),
                }
            )
        for name in mate_candidates:
            main_checks.append(
                {
                    "parts": [name, main_name],
                    "intersection_mm3": mates[name].intersect(shape).Volume(),
                }
            )
    assert len(mate_containment) == 2, mate_containment
    assert not collisions, collisions
    assert all(row["intersection_mm3"] < 1e-5 for row in mate_checks), mate_checks
    assert all(row["intersection_mm3"] < 1e-5 for row in main_checks), main_checks
    assembly = cq.Assembly(name="BMSX_COMPACT_FRONT_IO")
    for name, shape in physical.items():
        path = generated / (name + ".brep")
        assert shape.exportBrep(str(path))
        assembly.add(shape, name=name)
        records[name] = {
            "brep": str(path.relative_to(ROOT)),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "material": materials[name],
            "bounds_mm": boxes[name],
            "regions_mm": [boxes[name]],
            "module": "front-io",
            "volume_mm3": shape.Volume(),
            "valid": True,
            "solids": len(shape.Solids()),
        }
    mate_assembly = cq.Assembly(name="BMSX_COMPACT_FRONT_MATES_NOT_PHYSICAL_PARTS")
    mate_records = {}
    for name, shape in mates.items():
        path = generated / (name + ".brep")
        assert shape.exportBrep(str(path))
        mate_assembly.add(shape, name=name)
        mate_records[name] = {
            "brep": str(path.relative_to(ROOT)),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bounds_mm": bounds(shape),
            "regions_mm": [bounds(shape)],
            "module": "front-io",
            "mating_main_refs": [],
            "visible": False,
        }
    target = ROOT / "build/exports/BMSX_COMPACT_front_io.step"
    assembly.export(str(target))
    written = cq.importers.importStep(str(target)).val()
    assert written.isValid() and len(written.Solids()) == len(physical)
    assert abs(written.Volume() - sum(s.Volume() for s in physical.values())) < 1e-5
    mate_assembly.export(str(generated / "complete_mate_envelopes.step"))
    report = {
        "scope": __doc__,
        "spec_sha256": hashlib.sha256(spec_path.read_bytes()).hexdigest(),
        "manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        "producer_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "physical_parts": records,
        "receiving_spaces": mate_records,
        "native_front_board": board_report,
        "board_checks": {
            "bounds_mm": board_bounds,
            "cylindrical_holes": len(cylinders),
            "native_top_face_area_mm2": area,
            "volume_mm3": board.Volume(),
            "nominal_finished_thickness_mm": 1.6,
            "native_KiCad_dielectric_hole_contour_retained": True,
        },
        "targeted_material_checks": checks,
        "material_interferences": collisions,
        "complete_mate_material_checks": mate_checks,
        "complete_mate_owned_containment": mate_containment,
        "main_component_checks": main_checks,
        "main_component_report_sha256": hashlib.sha256(main_report_path.read_bytes()).hexdigest(),
        "STEP_roundtrip": {
            "valid": True,
            "solids": len(written.Solids()),
            "volume_mm3": written.Volume(),
            "volume_sum_pass": True,
        },
        "case_apertures": spec["case_apertures"],
        "case_attachment_holes": spec["case_attachment_holes"],
        "case_modifications": case_modifications,
        "inside_blind_mount_witnesses": mount_witnesses,
        "front_PCB_mount_stack": spec["front_PCB_mount_stack"],
        "positive_regions_mm": fixture_regions,
        "mounting_sequence": spec["mounting_sequence"],
        "mount_axes": spec["mount_axes"],
        "not_proven": spec["not_proven"],
        "exports": {str(target.relative_to(ROOT)): hashlib.sha256(target.read_bytes()).hexdigest()},
        "elapsed_seconds": monotonic() - started,
        "fabrication_release": False,
    }
    (ROOT / "build/reports/compact-front-io.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                "physical_parts": len(physical),
                "native_holes": len(cylinders),
                "checks": len(checks),
                "interferences": collisions,
                "mate_nonzero": [r for r in mate_checks if r["intersection_mm3"] > 1e-5],
                "main_component_checks": len(main_checks),
                "elapsed_seconds": report["elapsed_seconds"],
            }
        )
    )


if __name__ == "__main__":
    main()
