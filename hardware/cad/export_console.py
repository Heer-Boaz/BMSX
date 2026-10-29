"""Exchange the validated named console bodies through native coloured STEP.

The geometry integrator owns fit. This owner consumes its immutable result;
exporting does not repeat all cross-module Booleans or mutate that report.
"""

import argparse
import hashlib
import json
from pathlib import Path
from time import perf_counter

import cadquery as cq
from enclosure_style import apply_native_colours, face_paints
from geometry import bounds

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    variant = parser.add_mutually_exclusive_group()
    variant.add_argument("--input-candidate", action="store_true",
                         help="Export the INPUT/memory PCB against the retained assembly")
    variant.add_argument("--passive-candidate", action="store_true",
                         help="Export the passive PCB against the retained assembly")
    variant.add_argument("--passive-spreader", action="store_true",
                         help="Export the flat passive spreader in the retained assembly")
    variant.add_argument("--passive-spreader-keyboard", action="store_true",
                         help="Combine the flat spreader and local keyboard front-wall proposal")
    variant.add_argument("--rear-presentation", action="store_true",
                         help="Export a separate illustrative rear-connector presentation")
    variant.add_argument("--protective-skirt", action="store_true",
                         help="Add the candidate frame channels to the retained empty console STEP")
    args = parser.parse_args()
    if args.protective_skirt:
        start = perf_counter()
        console_path = ROOT / "build/exports/BMSX_COMPACT_PASSIVE_SPREADER_KEYBOARD_console.step"
        console_report_path = ROOT / "build/reports/console-exchange-passive-spreader-keyboard.json"
        skirt_path = ROOT / "build/exports/BMSX_CARTRIDGE_PROTECTIVE_SKIRT_CONCEPT.step"
        skirt_report_path = ROOT / "build/reports/cartridge-protective-skirt-concept.json"
        appearance_path = ROOT / "design/enclosure_appearance.json"
        style_path = ROOT / "design/enclosure_styling.json"
        keyboard_report_path = ROOT / "build/reports/keyboard-panel-candidate.json"
        console_report = json.loads(console_report_path.read_text())
        skirt_report = json.loads(skirt_report_path.read_text())
        appearance = json.loads(appearance_path.read_text())
        style = json.loads(style_path.read_text())
        keyboard_report = json.loads(keyboard_report_path.read_text())
        assert hashlib.sha256(console_path.read_bytes()).hexdigest() == console_report["exports"][str(console_path.relative_to(ROOT))]
        assert hashlib.sha256(skirt_path.read_bytes()).hexdigest() == skirt_report["export_sha256"]
        for path, digest in skirt_report["input_sha256"].items():
            assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == digest, path
        frame = next(shape.located(loc) for shape, name, loc, _ in cq.Assembly.importStep(str(skirt_path))
                     if name.rsplit("/", 1)[-1] == "FRAME_WITH_CHANNELS")
        original = list(cq.Assembly.importStep(str(console_path)))
        names = [name.rsplit("/", 1)[-1] for _, name, _, _ in original]
        assert len(names) == len(set(names)) and names.count("COMPACT_FRAME_METAL") == 1
        old_frame = next(shape.located(loc) for shape, name, loc, _ in original
                         if name.rsplit("/", 1)[-1] == "COMPACT_FRAME_METAL")
        assert max(abs(a - b) for a, b in zip(bounds(old_frame), bounds(frame), strict=True)) < 1e-5
        assert abs(old_frame.Volume() - skirt_report["frame_original_volume_mm3"]) < 1e-4
        assert abs(frame.Volume() - skirt_report["frame_candidate_volume_mm3"]) < 1e-4
        assembly = cq.Assembly(name="BMSX_COMPACT_PROTECTIVE_SKIRT_FRAME_CONCEPT")
        for shape, path, loc, color in original:
            name = path.rsplit("/", 1)[-1]
            shape = frame if name == "COMPACT_FRAME_METAL" else shape.located(loc)
            assembly.add(shape, name=name, color=color)
            if name in ("CASE__FIXED_BODY", "CASE__REMOVABLE_LID"):
                paints = face_paints(name, shape, style)
                if name == "CASE__FIXED_BODY":
                    painted = {row["face_index"] for row in paints}
                    b = keyboard_report["panel_lip_bounds_mm"]
                    for index, face in enumerate(shape.Faces()):
                        bb = bounds(face)
                        if index not in painted and all(bb[i] >= b[i] - 1e-6 and bb[i+3] <= b[i+3] + 1e-6 for i in range(3)):
                            paints.append({"face_index": index, "appearance": "fascia"})
                apply_native_colours(assembly, name, shape, paints, appearance)
        target = ROOT / "build/exports/BMSX_COMPACT_PROTECTIVE_SKIRT_FRAME_console.step"
        assembly.export(str(target))
        restored = {name.rsplit("/", 1)[-1]: shape.located(loc)
                    for shape, name, loc, _ in cq.Assembly.importStep(str(target))}
        assert restored.keys() == set(names)
        restored_frame = restored["COMPACT_FRAME_METAL"]
        assert restored_frame.isValid() and len(restored_frame.Solids()) == 1
        assert max(abs(a - b) for a, b in zip(bounds(restored_frame), bounds(frame), strict=True)) < 1e-5
        assert abs(restored_frame.Volume() - frame.Volume()) < 1e-4
        result = {
            "scope": "Separate retained empty console STEP with the candidate frame channels; not a new full assembly, insertion, thermal or manufacturing qualification",
            "input_sha256": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                             for path in (Path(__file__), console_path, console_report_path, skirt_path, skirt_report_path,
                                          appearance_path, style_path, keyboard_report_path, ROOT / "cad/enclosure_style.py")},
            "replacement": "COMPACT_FRAME_METAL from FRAME_WITH_CHANNELS",
            "cartridges": "not included; retained closed dust doors",
            "named_bodies": len(restored),
            "frame_bounds_mm": bounds(restored_frame),
            "frame_volume_mm3": restored_frame.Volume(),
            "export_sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            "elapsed_seconds": perf_counter() - start,
        }
        (ROOT / "build/reports/console-exchange-protective-skirt-frame.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2))
        return
    has_keyboard = args.passive_spreader_keyboard or args.rear_presentation
    start = perf_counter()
    source = ROOT / "build/reports/compact-assembly.json"
    report = json.loads(source.read_text())
    assert report["integration_pass"]
    shapes = {}
    records = report["physical_parts"] | {
        name: row for name, row in report["receiving_spaces"].items() if row["visible"]
    }
    for name, row in records.items():
        path = ROOT / row["brep"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"]
        shapes[name] = cq.Shape.importBrep(str(path))
    candidate_changes = {}
    has_spreader = args.passive_spreader or has_keyboard
    passive_candidate = args.passive_candidate or has_spreader
    is_candidate = args.input_candidate or passive_candidate
    if is_candidate:
        baseline_path = ROOT / "build/reports/mainboard.json"
        candidate_path = ROOT / (
            "build/reports/mainboard-passive-candidate.json" if passive_candidate
            else "build/reports/mainboard-input-candidate.json"
        )
        baseline = json.loads(baseline_path.read_text())
        candidate = json.loads(candidate_path.read_text())
        for board in (baseline, candidate):
            board_path = ROOT / board["board_source"]
            assert hashlib.sha256(board_path.read_bytes()).hexdigest() == board["source_sha256"]
        old = {row["ref"]: row for row in baseline["placements"]}
        new = {row["ref"]: row for row in candidate["placements"]}
        if passive_candidate:
            input_path = ROOT / "build/reports/mainboard-input-candidate.json"
            input_board = json.loads(input_path.read_text())
            input_source = ROOT / input_board["board_source"]
            assert hashlib.sha256(input_source.read_bytes()).hexdigest() == input_board["source_sha256"]
            input_placements = {row["ref"]: row for row in input_board["placements"]}
            assert input_placements.keys() - new.keys() == {"J70"}
            assert new.keys() - input_placements.keys() == set()
            assert all(new[ref] == input_placements[ref] for ref in new)
            del shapes["MAIN__J70"]
        source_refs = {
            "U150": "U10", "U151": "U11", "U152": "U30", "U153": "U31",
            **{f"C{600 + i}": f"C{210 + i}" for i in range(6)},
            **{f"C{610 + i}": f"C{500 + i}" for i in range(6)},
            "R600": "R517",
            **{ref: ref for ref in ("U30", "C500", "C501", "C502")},
        }
        # Reuse the installed component representations, before moving U30 and
        # its capacitors. All paired footprints have the same angle and side.
        original = {ref: shapes["MAIN__" + ref] for ref in source_refs.values()}
        for ref, source_ref in source_refs.items():
            before, after = old[source_ref], new[ref]
            assert before["rotation_degrees"] == after["rotation_degrees"], ref
            expected_layer = "F.Cu" if ref.startswith("U") else "B.Cu"
            assert after["layer"] == expected_layer, ref
            dx = after["position_mm"][0] - before["position_mm"][0]
            dy = after["position_mm"][1] - before["position_mm"][1]
            shape = original[source_ref].translate((dx, dy, 0))
            shapes["MAIN__" + ref] = shape
            candidate_changes[ref] = {
                "representation_from": source_ref,
                "position_mm": after["position_mm"],
                "layer": after["layer"],
                "bounds_mm": bounds(shape),
            }
    if has_spreader:
        spreader_path = ROOT / "build/exports/BMSX_PASSIVE_SPREADER_CONCEPT.step"
        spreader_report_path = ROOT / "build/reports/passive-spreader-candidate.json"
        spreader_report = json.loads(spreader_report_path.read_text())
        assert hashlib.sha256(spreader_path.read_bytes()).hexdigest() == spreader_report["output_sha256"]
        spreader_parts = {
            name.rsplit("/", 1)[-1]: shape.located(loc)
            for shape, name, loc, color in cq.Assembly.importStep(str(spreader_path))
        }
        del shapes["COOLING__SK50875_MACHINED_RECEIVING"]
        shapes["COOLING__LOW_PROFILE_SPREADER_CONCEPT"] = spreader_parts[
            "COOLING__LOW_PROFILE_SPREADER_CONCEPT"
        ]
    if has_keyboard:
        keyboard_path = ROOT / "build/exports/BMSX_KEYBOARD_PANEL_CANDIDATE.step"
        keyboard_report_path = ROOT / "build/reports/keyboard-panel-candidate.json"
        keyboard_report = json.loads(keyboard_report_path.read_text())
        assert hashlib.sha256(keyboard_path.read_bytes()).hexdigest() == keyboard_report["export_sha256"]
        assert hashlib.sha256(source.read_bytes()).hexdigest() == keyboard_report["input_sha256"][str(source.relative_to(ROOT))]
        keyboard_parts = {
            name.rsplit("/", 1)[-1]: shape.located(loc)
            for shape, name, loc, color in cq.Assembly.importStep(str(keyboard_path))
        }
        shapes["CASE__FIXED_BODY"] = keyboard_parts["CASE__FIXED_BODY_WITH_KEYBOARD_LIP"]
    if args.rear_presentation:
        rear_path = ROOT / "build/exports/BMSX_REAR_CONNECTOR_PRESENTATION.step"
        rear_report_path = ROOT / "build/reports/rear-connector-presentation.json"
        rear_report = json.loads(rear_report_path.read_text())
        assert hashlib.sha256(rear_path.read_bytes()).hexdigest() == rear_report["output_sha256"]
        rear_parts = {
            name.rsplit("/", 1)[-1]: shape.located(loc)
            for shape, name, loc, color in cq.Assembly.importStep(str(rear_path))
        }
        assert rear_parts.keys() == set(rear_report["part_names"])
        # Presentation only: replace the two opaque visible receiving bodies
        # in this separate exchange. Their fit owners and reports remain intact.
        del shapes["SCART_KYCON_DIMENSIONAL_RECEIVING_NOT_VENDOR_CAVITY_MODEL"]
        del shapes["DC_PRESERVED_JACK_AND_INSULATED_LUG_ACCEPTANCE"]
        for name, shape in rear_parts.items():
            shapes["REAR_PRESENTATION__" + name] = shape
    exchange = {
        "input_sha256": {
            str(source.relative_to(ROOT)): hashlib.sha256(source.read_bytes()).hexdigest(),
            "cad/export_console.py": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        },
        "exports": {},
    }
    if is_candidate:
        exchange["scope"] = ("Separate INPUT/memory PCB positions against retained assembly geometry; "
                             "not a current complete assembly or manufacturing validation")
        exchange["candidate_components"] = candidate_changes
        exchange["removed_components"] = ["J70"] if passive_candidate else []
        exchange["unrouted_board"] = True
        exchange["assembly_source_inputs_changed"] = [
            path for path, digest in report["input_sha256"].items()
            if not (ROOT / path).is_file()
            or hashlib.sha256((ROOT / path).read_bytes()).hexdigest() != digest
        ]
        exchange["input_sha256"][str(baseline_path.relative_to(ROOT))] = hashlib.sha256(baseline_path.read_bytes()).hexdigest()
        exchange["input_sha256"][str(candidate_path.relative_to(ROOT))] = hashlib.sha256(candidate_path.read_bytes()).hexdigest()
        if passive_candidate:
            exchange["input_sha256"][str(input_path.relative_to(ROOT))] = hashlib.sha256(input_path.read_bytes()).hexdigest()
    if has_spreader:
        exchange["scope"] = ("Flat passive spreader construction proposal and passive PCB positions "
                             "against retained assembly geometry; not a current complete assembly, "
                             "manufacturing validation or thermal guarantee")
        exchange["spreader_component"] = "COOLING__LOW_PROFILE_SPREADER_CONCEPT"
        exchange["replaced_component"] = "COOLING__SK50875_MACHINED_RECEIVING"
        exchange["input_sha256"][str(spreader_path.relative_to(ROOT))] = hashlib.sha256(spreader_path.read_bytes()).hexdigest()
        exchange["input_sha256"][str(spreader_report_path.relative_to(ROOT))] = hashlib.sha256(spreader_report_path.read_bytes()).hexdigest()
    if has_keyboard:
        exchange["scope"] = ("Flat passive spreader and local keyboard front-wall proposals with passive PCB positions "
                             "against retained assembly geometry; not a current complete assembly, plug mating, "
                             "manufacturing validation or thermal guarantee")
        exchange["keyboard_component"] = "CASE__FIXED_BODY"
        exchange["keyboard_limitations"] = keyboard_report["limitations"]
        exchange["input_sha256"][str(keyboard_path.relative_to(ROOT))] = hashlib.sha256(keyboard_path.read_bytes()).hexdigest()
        exchange["input_sha256"][str(keyboard_report_path.relative_to(ROOT))] = hashlib.sha256(keyboard_report_path.read_bytes()).hexdigest()
    if args.rear_presentation:
        exchange["scope"] = ("Separate visual presentation of the retained assembly with flat spreader, "
                             "keyboard-front option and illustrative rear connector faces; not manufacturer CAD, "
                             "full assembly fit, mating, thermal or manufacturing qualification")
        exchange["rear_presentation_limitations"] = rear_report["limitations"]
        exchange["presentation_only_removed_envelopes"] = [
            "SCART_KYCON_DIMENSIONAL_RECEIVING_NOT_VENDOR_CAVITY_MODEL",
            "DC_PRESERVED_JACK_AND_INSULATED_LUG_ACCEPTANCE",
        ]
        exchange["rear_presentation_components"] = ["REAR_PRESENTATION__" + n for n in rear_report["part_names"]]
        exchange["input_sha256"][str(rear_path.relative_to(ROOT))] = hashlib.sha256(rear_path.read_bytes()).hexdigest()
        exchange["input_sha256"][str(rear_report_path.relative_to(ROOT))] = hashlib.sha256(rear_report_path.read_bytes()).hexdigest()
    output = ROOT / (
        "build/reports/console-exchange-rear-presentation.json" if args.rear_presentation else
        "build/reports/console-exchange-passive-spreader-keyboard.json" if args.passive_spreader_keyboard else
        "build/reports/console-exchange-passive-spreader.json" if args.passive_spreader else
        "build/reports/console-exchange-passive-candidate.json" if args.passive_candidate else
        "build/reports/console-exchange-input-candidate.json" if args.input_candidate else
        "build/reports/console-exchange.json"
    )
    appearance_path = ROOT / "design/enclosure_appearance.json"
    appearance = json.loads(appearance_path.read_text())
    exchange["input_sha256"][str(appearance_path.relative_to(ROOT))] = hashlib.sha256(
        appearance_path.read_bytes()
    ).hexdigest()
    exchange["input_sha256"]["cad/enclosure_style.py"] = hashlib.sha256(
        (ROOT / "cad/enclosure_style.py").read_bytes()
    ).hexdigest()
    if has_keyboard:
        style_path = ROOT / "design/enclosure_styling.json"
        style = json.loads(style_path.read_text())
        exchange["input_sha256"][str(style_path.relative_to(ROOT))] = hashlib.sha256(style_path.read_bytes()).hexdigest()
    assembly = cq.Assembly(name=("BMSX_COMPACT_REAR_CONNECTOR_VISUAL_PRESENTATION" if args.rear_presentation else
                                 "BMSX_COMPACT_PASSIVE_SPREADER_KEYBOARD_CONCEPT" if args.passive_spreader_keyboard else
                                 "BMSX_COMPACT_PASSIVE_SPREADER_CONCEPT" if args.passive_spreader else
                                 "BMSX_COMPACT_PASSIVE_CANDIDATE" if args.passive_candidate else
                                 "BMSX_COMPACT_INPUT_CANDIDATE" if args.input_candidate else
                                 "BMSX_COMPACT_CONSOLE_PROPOSAL"))
    for name, shape in shapes.items():
        color = (
            appearance["palette"]["shell"]
            if name in ["CASE__FIXED_BODY", "CASE__REMOVABLE_LID"]
            else [0.65, 0.68, 0.70]
            if name in ("REAR_PRESENTATION__DC_ILLUSTRATIVE_BUSHING", "REAR_PRESENTATION__DC_ILLUSTRATIVE_CENTRE_PIN")
            else appearance["palette"]["plinth"]
            if name == "CASE__BOTTOM_COVER" or name.startswith("CASE__FOOT_")
            else appearance["palette"]["power"]
            if name == "TOP_CONTROLS__BLUE_POWER_SLIDE"
            else appearance["palette"]["fascia"]
            if name.startswith("BANK__SLOT")
            else [0.25, 0.29, 0.31]
        )
        assembly.add(shape, name=name, color=cq.Color(*color))
        if name in ["CASE__FIXED_BODY", "CASE__REMOVABLE_LID"]:
            paints = records[name]["face_paints"]
            if has_keyboard and name == "CASE__FIXED_BODY":
                # The imported revised body has different face ordering. Recalculate
                # the native coatings rather than applying obsolete face indices.
                paints = face_paints(name, shape, style)
                painted = {row["face_index"] for row in paints}
                b = keyboard_report["panel_lip_bounds_mm"]
                for index, face in enumerate(shape.Faces()):
                    bb = bounds(face)
                    if index not in painted and all(bb[i] >= b[i] - 1e-6 and bb[i+3] <= b[i+3] + 1e-6 for i in range(3)):
                        paints.append({"face_index": index, "appearance": "fascia"})
            apply_native_colours(assembly, name, shape, paints, appearance)
    target = ROOT / (
        "build/exports/BMSX_COMPACT_REAR_PRESENTATION_console.step" if args.rear_presentation else
        "build/exports/BMSX_COMPACT_PASSIVE_SPREADER_KEYBOARD_console.step" if args.passive_spreader_keyboard else
        "build/exports/BMSX_COMPACT_PASSIVE_SPREADER_console.step" if args.passive_spreader else
        "build/exports/BMSX_COMPACT_PASSIVE_CANDIDATE_console.step" if args.passive_candidate else
        "build/exports/BMSX_COMPACT_INPUT_CANDIDATE_console.step" if args.input_candidate else
        "build/exports/BMSX_COMPACT_console.step"
    )
    assembly.export(str(target))
    restored = {
        name.rsplit("/", 1)[-1]: shape.located(loc)
        for shape, name, loc, color in cq.Assembly.importStep(str(target))
    }
    assert restored.keys() == shapes.keys()
    checked_names = {"MAIN__" + ref for ref in candidate_changes} if is_candidate else restored.keys()
    if has_spreader:
        checked_names.add("COOLING__LOW_PROFILE_SPREADER_CONCEPT")
    if has_keyboard:
        checked_names.add("CASE__FIXED_BODY")
    if args.rear_presentation:
        checked_names.update("REAR_PRESENTATION__" + n for n in rear_report["part_names"])
    for name in checked_names:
        shape = restored[name]
        assert shape.isValid() and len(shape.Solids()) == len(shapes[name].Solids()), name
        assert (
            max(abs(a - b) for a, b in zip(bounds(shape), bounds(shapes[name]), strict=True)) < 1e-5
        ), name
    exchange["roundtrip_checked_names"] = sorted(checked_names)
    # The assembly owns named bodies, not a fictitious fused solid. OCC's
    # adaptive compound-wide volume integral is not additive at this scale;
    # compare the same per-body mass representation on both sides.
    source_volume = sum(shapes[name].Volume(tol=1e-10) for name in checked_names)
    restored_volume = sum(restored[name].Volume(tol=1e-10) for name in checked_names)
    assert abs(restored_volume - source_volume) < 1e-4
    exchange["native_STEP_roundtrip"] = {
        "named_bodies": len(restored),
        "all_names_match": True,
        "geometry_checked_names": len(checked_names),
        "geometry_validity_solids_bounds_pass": True,
        "source_body_volume_sum_mm3": source_volume,
        "restored_body_volume_sum_mm3": restored_volume,
        "volume_sum_tolerance_mm3": 1e-4,
        "volume_sum_pass": True,
    }
    exchange["exports"][str(target.relative_to(ROOT))] = hashlib.sha256(
        target.read_bytes()
    ).hexdigest()
    if not is_candidate:
        exchange["STEP_roundtrip_valid_solids_volume_pass"] = True
    else:
        exchange["candidate_geometry_roundtrip_pass"] = True
    exchange["elapsed_seconds"] = perf_counter() - start
    output.write_text(json.dumps(exchange, indent=2) + "\n")


if __name__ == "__main__":
    main()
