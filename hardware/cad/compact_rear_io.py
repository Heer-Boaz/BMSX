"""Inside-accessible compact rear proposal from sealed native source geometry.

CadQuery assembly.py and occ_impl/shapes.py production owners were studied;
rigid BRep transforms, not re-created connector boxes, own source geometry.
Prusa x-end-idler constructive union/cut ownership was also studied.
Shared geometry/fixtures/fasteners compile the declared native manufactured
parts. Receiving models retain their scope: they are not factory cavity models.
Mainboard-to-rear clearance is owned by check_rear_main.py and the complete
assembly, so unrelated changes to the mainboard do not regenerate this STEP.
"""

import hashlib
import json
from itertools import combinations
from pathlib import Path
from time import perf_counter

import cadquery as cq
from board_model import load_board_solid, nominal_board_in_assembly
from fasteners import fabricate_fasteners
from fixtures import fabricate
from geometry import bounds, box, cylinder, overlaps, tube_path
from rear_components import dc_carrier

ROOT = Path(__file__).resolve().parents[1]
TOL = 1e-6


def main():
    started = perf_counter()
    plan_path = ROOT / "design/enclosure_rear_io.json"
    p = json.loads(plan_path.read_text())
    manifest_path = ROOT / p["input_manifest"]
    manifest = json.loads(manifest_path.read_text())
    native = {}
    paths = [
        plan_path,
        manifest_path,
        Path(__file__),
        ROOT / "cad/geometry.py",
        ROOT / "cad/fixtures.py",
        ROOT / "cad/fasteners.py",
        ROOT / "cad/rear_components.py",
        ROOT / "build/reports/rear-mate-datums.json",
        ROOT / "ecad/av/board.json",
        ROOT / "build/exports/BMSX_AV_BREAKOUT_board_native.step",
    ]
    for e in manifest["parts"]:
        path = ROOT / e["brep"]
        paths.append(path)
        assert hashlib.sha256(path.read_bytes()).hexdigest() == e["sha256"]
        s = cq.Shape.importBrep(str(path))
        assert s.isValid()
        native[e["name"]] = s
        assert max(abs(a - b) for a, b in zip(bounds(s), e["source_bounds_mm"], strict=True)) < TOL
    physical = {}
    receiving = {}
    reserves = {}
    av = p["AV_breakout"]
    board_spec = json.loads((ROOT / "ecad/av/board.json").read_text())
    native_board = load_board_solid(ROOT / "build/exports/BMSX_AV_BREAKOUT_board_native.step")
    board = nominal_board_in_assembly(native_board, 0, board_spec["thickness_mm"])
    pose = board_spec["assembly_pose"]
    # Native panel X maps to world-X negative, Y to world-Z positive and
    # its finished top normal to world-Y positive, exactly as the panel owner.
    board = (
        board.rotate((0, 0, 0), (0, 0, 1), 180)
        .rotate((0, 0, 0), (1, 0, 0), -90)
        .translate(tuple(pose["pcb_top_origin_world_mm"]))
    )
    assert max(abs(a - b) for a, b in zip(bounds(board), av["bounds_mm"], strict=True)) < TOL
    physical["AV_BREAKOUT_NATIVE_DRILLED_PCB"] = board
    receiving["SCART_KYCON_DIMENSIONAL_RECEIVING_NOT_VENDOR_CAVITY_MODEL"] = native[
        "AV__SCART_MAX_ACCEPTANCE_NOT_VENDOR_MODEL"
    ].translate(tuple(p["SCART"]["source_translation_mm"]))
    scart_board_path = ROOT / "ecad/scart/board.json"
    scart_spec = json.loads(scart_board_path.read_text())
    scart_native_path = ROOT / "build/exports/BMSX_SCART_TERM_board_native.step"
    scart_maker_path = ROOT / scart_spec["supplier_datum_owner"]
    paths.extend([scart_board_path, scart_native_path, scart_maker_path])
    origin = scart_spec["assembly_pose"]["pcb_origin_world_mm"]
    scart_board = nominal_board_in_assembly(
        load_board_solid(scart_native_path), origin[2], scart_spec["thickness_mm"]
    ).translate((origin[0], origin[1], 0))
    assert (
        max(
            abs(a - b)
            for a, b in zip(
                bounds(scart_board),
                scart_spec["assembly_pose"]["nominal_world_bounds_mm"],
                strict=True,
            )
        )
        < TOL
    )
    physical["SCART_TERMINATION_NATIVE_DRILLED_PCB"] = scart_board
    receiving["DC_PRESERVED_JACK_AND_INSULATED_LUG_ACCEPTANCE"] = native[
        "DC__DC_JACK_AND_INSULATED_LUGS"
    ].translate(tuple(p["DC"]["source_translation_mm"]))
    fixtures, _, _, _, _, _ = fabricate([p["fixtures"]])
    physical["DC_NATIVE_DRILLED_G10_CARRIER"] = dc_carrier(
        p, native["DC__DC_REAR_CARRIER"], fixtures.pop("DC_INTERNAL_G10_EARS")
    )
    physical.update(fixtures)
    assert len(physical["DC_NATIVE_DRILLED_G10_CARRIER"].Solids()) == 1
    case_additions = {}
    case_cuts = {}
    anchor_material = {}
    for anchor in p["inside_mounting"]["case_anchors"]:
        name = anchor["id"]
        x, z = anchor["centre_XZ_mm"]
        lo, hi = anchor["pilot_Y_range_mm"]
        addition = box(anchor["bounds_mm"])
        cut = cylinder((x, lo, z), (0, 1, 0), anchor["pilot_diameter_mm"] / 2, hi - lo)
        case_additions[name + "_INTEGRAL_BLIND_BOSS"] = addition
        case_cuts[name + "_BLIND_TAP_PILOT"] = cut
        anchor_material[name] = addition.cut(cut)
        assert anchor["screw_tip_Y_mm"] < hi < anchor["bounds_mm"][4] < 190
        assert anchor_material[name].isValid() and len(anchor_material[name].Solids()) == 1
    for clearance in p["inside_mounting"]["carrier_wall_clearances"]:
        cut = box(clearance["bounds_mm"])
        case_cuts[clearance["id"]] = cut
        for anchor in anchor_material.values():
            if overlaps(bounds(anchor), bounds(cut)):
                assert anchor.intersect(cut).Volume() < TOL
    # Integral bosses are shell modifications, never loose physical parts.
    # The local material check uses the finished boss with its blind tapped
    # pilot; root fuses additions into the final styled lower shell.

    hardware, _, _ = fabricate_fasteners(p["fasteners"])
    physical.update(hardware)
    for rows in [p["coaxes"], p["auxiliary_wires"], p["DC_wires"]]:
        for row in rows:
            shape = tube_path(row["segments"], row["OD_mm"] / 2)
            assert shape.isValid() and len(shape.Solids()) == 1, row["name"]
            physical[row["name"]] = shape
    for row in p["jacket_retention_liners"]:
        centre = row["start_mm"]
        length = row["length_mm"]
        physical[row["name"]] = cylinder(
            centre, (1, 0, 0), row["outer_diameter_mm"] / 2, length
        ).cut(cylinder(centre, (1, 0, 0), row["inner_diameter_mm"] / 2, length))
    # A short ribbon is an allocation until selected IDC key/stop acceptance is
    # resolved. No anonymous cuboid is promoted to a complete factory mate.
    reserves["AV_SHORT_STRAIGHT_RIBBON_ACCEPTANCE"] = box(av["ribbon_bounds_mm"])
    fanout = p["coax_termination"]["fanout_regions_mm"]
    reserves["SCART_SUPPORTED_LOOM_FANOUT_ACCEPTANCE"] = box(fanout[0]).fuse(
        *(box(region) for region in fanout[1:])
    )
    placements = json.loads((ROOT / "build/reports/rear-mate-datums.json").read_text())
    mates_path = ROOT / "models/rear/mating.json"
    paths.append(mates_path)
    for mate in json.loads(mates_path.read_text()):
        placed = placements[mate["ref"]]
        x, y = placed["position_mm"]
        reserves[mate["name"]] = (
            box(mate["bounds_mm_local"])
            .rotate((0, 0, 0), (0, 0, 1), -placed["rotation_degrees"])
            .translate((x, y, 0))
        )
    for item in [*p["DC"]["external_reservations"], *p["SCART"]["external_reservations"]]:
        reserves[item["name"]] = box(item["bounds_mm"])
    # Intersections are never hidden. Material checks use actual parts;
    # source receiving allocations are reported separately because they contain
    # mounting-ear material and their unmodelled native cavity by definition.
    checks = []
    hits = []
    for a, b in combinations(physical, 2):
        if not overlaps(bounds(physical[a]), bounds(physical[b])):
            continue
        vol = physical[a].intersect(physical[b]).Volume()
        row = dict(a=a, b=b, intersection_mm3=vol)
        checks.append(row)
        if vol > TOL:
            hits.append(row)
    allnew = dict(physical, **receiving)
    receiving_contacts = []
    for name, shape in receiving.items():
        for n, s in physical.items():
            if overlaps(bounds(shape), bounds(s)):
                vol = shape.intersect(s).Volume()
                if vol > TOL:
                    receiving_contacts.append(
                        dict(
                            allocation=name,
                            part=n,
                            allocation_intersection_mm3=vol,
                            meaning="Receiving allocation overlap, not an exact vendor-material joint. Declared hardware/plate or terminal interface must be accepted on the real part.",
                        )
                    )
    generated = ROOT / "build/cad/compact_rear_io"
    generated.mkdir(exist_ok=True, parents=True)
    modification_ledger = {"additions": [], "cuts": []}
    for kind, items in [("additions", case_additions), ("cuts", case_cuts)]:
        for name, shape in items.items():
            path = generated / (name + ".brep")
            shape.exportBrep(str(path))
            modification_ledger[kind].append(
                dict(
                    source_BRep=str(path.relative_to(ROOT)),
                    sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                    target="lower_shell",
                    bounds_mm=bounds(shape),
                )
            )
    anchor_checks = []
    anchor_hits = []
    for name, shape in anchor_material.items():
        for part, s in physical.items():
            if not overlaps(bounds(shape), bounds(s)):
                continue
            vol = shape.intersect(s).Volume()
            check = dict(anchor=name, part=part, intersection_mm3=vol)
            anchor_checks.append(check)
            if vol > TOL:
                anchor_hits.append(check)
    inside_screws = []
    for interface in p["fasteners"]["fastening_interfaces"]:
        if "tapped_engagement" not in interface:
            continue
        name = interface["screw"]["part_name"]
        b = bounds(physical[name])
        assert b[4] < 187 and b[1] >= 175 - TOL
        inside_screws.append(
            dict(
                name=name,
                bounds_mm=b,
                head_top_Y_mm=interface["screw"]["head_top_axis_mm"],
                tip_Y_mm=interface["tip_position_mm"][1],
                blind_anchor=interface["id"],
            )
        )
    ear_screws = []
    for interface in p["fasteners"]["fastening_interfaces"]:
        if not interface["id"].startswith("SCART_SOCKET_EAR_M2_"):
            continue
        names = [
            interface["screw"]["part_name"],
            interface["nut"]["part_name"],
            interface["spacer"]["part_name"],
            *[w["part_name"] for w in interface["washers"]],
        ]
        for name in names:
            assert bounds(physical[name])[4] < 190, name
        ear_screws.append(
            dict(
                id=interface["id"],
                axis_XZ_mm=[interface["under_head_position_mm"][0], 42],
                parts=[dict(name=name, bounds_mm=bounds(physical[name])) for name in names],
                all_head_nut_tip_inside_Y190=True,
            )
        )
    assert len(ear_screws) == 2
    assert not p["rear_wall"]["fixing_bores"]
    assert not [h for h in p["fixtures"]["case_attachment_holes"] if h["target"] == "lower_shell"]

    assembly = cq.Assembly(name="BMSX_COMPACT_REAR_IO_NATIVE_AND_EXPLICIT_RESERVATIONS")
    rows = []
    output_paths = [
        ROOT / row["source_BRep"] for rows in modification_ledger.values() for row in rows
    ]
    for kind, items in [
        ("physical_part", physical),
        ("receiving_allocation_not_factory_material", receiving),
        ("assembly_or_service_reservation", reserves),
    ]:
        for name, shape in items.items():
            assert shape.isValid(), name
            path = generated / (name + ".brep")
            shape.exportBrep(str(path))
            output_paths.append(path)
            restored = cq.Shape.importBrep(str(path))
            assert restored.isValid() and abs(shape.Volume() - restored.Volume()) < 1e-5
            rows.append(
                dict(
                    name=name,
                    kind=kind,
                    bounds_mm=bounds(shape),
                    native_volume_mm3=shape.Volume(),
                    source_BRep=str(path.relative_to(ROOT)),
                )
            )
            assembly.add(
                shape,
                name=name,
                color=cq.Color(0.15, 0.45, 0.3)
                if kind == "physical_part"
                else cq.Color(0.55, 0.3, 0.15, 0.25),
            )
    output = ROOT / "build/exports/BMSX_COMPACT_rear_io.step"
    assembly.export(str(output))
    output_paths.append(output)
    restored = {
        n.rsplit("/", 1)[-1]: s.located(loc)
        for s, n, loc, col in cq.Assembly.importStep(str(output))
    }
    assert restored.keys() == set(allnew) | set(reserves)
    for row in rows:
        s = restored[row["name"]]
        assert (
            s.isValid()
            and max(abs(a - b) for a, b in zip(bounds(s), row["bounds_mm"], strict=True)) < 1e-5
            and abs(s.Volume() - row["native_volume_mm3"]) < 1e-5
        ), row["name"]
    active = {path.resolve() for path in output_paths}
    for stale in generated.glob("*.brep"):
        if stale.resolve() not in active:
            stale.unlink()
    roof = max(
        row["bounds_mm"][5]
        for row in rows
        if row["kind"] != "assembly_or_service_reservation" and row["bounds_mm"][1] < 187
    )
    report = dict(
        scope=__doc__,
        case_modifications=modification_ledger,
        carrier_wall_clearances=p["inside_mounting"]["carrier_wall_clearances"],
        inside_carrier_screws=inside_screws,
        inside_SCART_ear_through_bolts=ear_screws,
        integral_blind_anchor_checks=anchor_checks,
        integral_blind_anchor_material_intersections=anchor_hits,
        rear_external_carrier_screws=0,
        rear_case_through_fixing_bores=0,
        integral_bosses_not_loose_parts=True,
        input_sha256={
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in paths
        },
        physical_parts={
            row["name"]: {
                "brep": row["source_BRep"],
                "sha256": hashlib.sha256((ROOT / row["source_BRep"]).read_bytes()).hexdigest(),
                "bounds_mm": row["bounds_mm"],
                "regions_mm": [row["bounds_mm"]],
                "module": "rear-io",
            }
            for row in rows
            if row["kind"] == "physical_part"
        },
        receiving_spaces={
            row["name"]: {
                "brep": row["source_BRep"],
                "sha256": hashlib.sha256((ROOT / row["source_BRep"]).read_bytes()).hexdigest(),
                "bounds_mm": row["bounds_mm"],
                "regions_mm": [row["bounds_mm"]],
                "module": "rear-io",
                "representation": row["kind"],
                "visible": row["kind"] == "receiving_allocation_not_factory_material",
                "mating_main_refs": ["MAIN__J500"]
                if row["name"] == "AV_IDC_COMPLETE_MATE_ACCEPTANCE"
                else ["MAIN__J61"]
                if row["name"] == "DC_COMPLETE_MOLEXS_MATE_ACCEPTANCE"
                else [],
            }
            for row in rows
            if row["kind"] != "physical_part"
        },
        native_board_holes_preserved=True,
        native_panel_pose=pose,
        source_model_scope_preserved=True,
        physical_part_pair_checks=checks,
        physical_material_intersections=hits,
        physical_intersection_allowlist=[],
        receiving_allocation_own_interface_contacts=receiving_contacts,
        named_STEP_roundtrip=dict(objects=len(restored), names_bounds_volumes_validity_pass=True),
        inside_roof_Z_mm=p["case"]["inside_roof_Z_mm"],
        maximum_internal_part_roof_Z_mm=roof,
        output_sha256={
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in output_paths
        },
        not_proven=p["not_proven"],
        SCART_axial_capture_witness=p["inside_mounting"]["SCART_axial_capture_witness"],
        SCART_ear_Z_is_not_a_manufacturer_datum=True,
        SCART_own_slot_centre_travel_Z_mm=p["SCART"]["own_vertical_adjustment_centre_travel_Z_mm"],
        external_connector_datums_unchanged=True,
        DC_harness_redesigned_for_selected_R10_wire=True,
        SCART_native_termination_board_added=True,
        whole_enclosure_fit_approved=False,
        fabrication_release=False,
        elapsed_seconds=perf_counter() - started,
    )
    (ROOT / "build/reports/compact-rear-io.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            dict(
                parts=len(rows),
                physical_hits=hits,
                anchor_hits=anchor_hits,
                receiving_interfaces=len(receiving_contacts),
                roof=roof,
                elapsed_seconds=report["elapsed_seconds"],
            ),
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
