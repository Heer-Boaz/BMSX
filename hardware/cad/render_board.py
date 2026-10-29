"""Render the native mainboard and its scoped component models without fake copper."""

import argparse
import hashlib
import json
from pathlib import Path
from time import perf_counter

import cadquery as cq
import numpy as np
import vtk
from rendering import shape_polydata

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--publication-dir", type=Path)
    parser.add_argument("--annotate", action="store_true")
    candidate_choice = parser.add_mutually_exclusive_group()
    candidate_choice.add_argument("--input-candidate", action="store_true")
    candidate_choice.add_argument("--passive-candidate", action="store_true")
    args = parser.parse_args()
    start = perf_counter()
    output_dir = args.publication_dir if args.publication_dir else ROOT / "build/exports"
    output_dir.mkdir(parents=True, exist_ok=True)
    source = ROOT / "build/reports/compact-main-scene.json"
    body_path = ROOT / "build/reports/compact-board-body.json"
    bank_path = ROOT / "build/reports/compact-packaging-fit.json"
    scene = json.loads(source.read_text())
    board = json.loads(body_path.read_text())
    bank = json.loads(bank_path.read_text())
    assert (
        not scene["missing_required_main_bindings"]
        and not scene["new_main_component_pair_checks"]["material_intersections"]
    )
    rows = board["physical_parts"] | scene["physical_parts"] | bank["physical_parts"]
    objects = []
    inputs = {
        str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in [Path(__file__), source, body_path, bank_path, ROOT / "cad/rendering.py"]
    }
    candidate_names = set()
    is_candidate = args.input_candidate or args.passive_candidate
    if is_candidate:
        candidate_path = ROOT / "build/reports/console-exchange-input-candidate.json"
        baseline_path = ROOT / "build/reports/mainboard.json"
        candidate_board_path = ROOT / "build/reports/mainboard-input-candidate.json"
        candidate = json.loads(candidate_path.read_text())
        baseline = json.loads(baseline_path.read_text())
        candidate_board = json.loads(candidate_board_path.read_text())
        assert hashlib.sha256(baseline_path.read_bytes()).hexdigest() == candidate["input_sha256"][str(baseline_path.relative_to(ROOT))]
        assert hashlib.sha256(candidate_board_path.read_bytes()).hexdigest() == candidate["input_sha256"][str(candidate_board_path.relative_to(ROOT))]
        for board_data in (baseline, candidate_board):
            board_file = ROOT / board_data["board_source"]
            assert hashlib.sha256(board_file.read_bytes()).hexdigest() == board_data["source_sha256"]
            inputs[str(board_file.relative_to(ROOT))] = board_data["source_sha256"]
        inputs[str(candidate_path.relative_to(ROOT))] = hashlib.sha256(candidate_path.read_bytes()).hexdigest()
        inputs[str(baseline_path.relative_to(ROOT))] = hashlib.sha256(baseline_path.read_bytes()).hexdigest()
        inputs[str(candidate_board_path.relative_to(ROOT))] = hashlib.sha256(candidate_board_path.read_bytes()).hexdigest()
        if args.passive_candidate:
            passive_path = ROOT / "build/reports/mainboard-passive-candidate.json"
            passive = json.loads(passive_path.read_text())
            passive_board = ROOT / passive["board_source"]
            assert hashlib.sha256(passive_board.read_bytes()).hexdigest() == passive["source_sha256"]
            earlier_positions = {row["ref"]: row for row in candidate_board["placements"]}
            passive_positions = {row["ref"]: row for row in passive["placements"]}
            assert earlier_positions.keys() - passive_positions.keys() == {"J70"}
            assert passive_positions.keys() <= earlier_positions.keys()
            assert all(passive_positions[ref] == earlier_positions[ref] for ref in passive_positions)
            del rows["MAIN__J70"]
            inputs[str(passive_path.relative_to(ROOT))] = hashlib.sha256(passive_path.read_bytes()).hexdigest()
            inputs[str(passive_board.relative_to(ROOT))] = passive["source_sha256"]
        positions = {row["ref"]: row["position_mm"] for row in baseline["placements"]}
        original_rows = dict(rows)
        for ref, change in candidate["candidate_components"].items():
            source_ref = change["representation_from"]
            x, y = positions[source_ref]
            target_x, target_y = change["position_mm"]
            rows["MAIN__" + ref] = {
                **original_rows["MAIN__" + source_ref],
                "bounds_mm": change["bounds_mm"],
                "translation": [target_x - x, target_y - y, 0],
            }
            candidate_names.add("MAIN__" + ref)
    asics = {"MAIN__U1", "MAIN__U2", "MAIN__U4", "MAIN__U7"}
    labels = {
        "BANK__SLOT0__SOCKET": "SLOT 1",
        "BANK__SLOT1__SOCKET": "SLOT 2",
        **{"MAIN__" + ref: ref for ref in ("U1", "U2", "U4", "U7", "U150", "U151", "U152", "U153")},
    } if is_candidate else {name: name.removeprefix("MAIN__") for name in asics}
    for name, row in rows.items():
        path = ROOT / row["brep"]
        inputs[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
        shape = cq.Shape.importBrep(str(path))
        if name in candidate_names:
            shape = shape.translate(tuple(row["translation"]))
        mesh = shape_polydata(shape, 0.10, 0.10)
        normals = vtk.vtkPolyDataNormals()
        normals.SetInputData(mesh)
        normals.SetFeatureAngle(35)
        normals.SplittingOn()
        normals.ConsistencyOn()
        normals.Update()
        mapper = vtk.vtkPolyDataMapper()
        mapper.SetInputData(normals.GetOutput())
        objects.append((name, row, mapper))
    outputs = {}
    views = [("top", [0, 0, 1])] if is_candidate else [("top", [0, 0, 1]), ("iso", [0.85, -1.2, 1.4])]
    for view, direction in views:
        renderer = vtk.vtkRenderer()
        renderer.SetBackground(0.96, 0.96, 0.95)
        renderer.SetBackground2(0.86, 0.88, 0.88)
        renderer.GradientBackgroundOn()
        renderer.AutomaticLightCreationOff()
        for position, intensity in [
            ([-140, -200, 360], 0.95),
            ([400, -50, 220], 0.45),
            ([100, 350, 400], 0.25),
        ]:
            light = vtk.vtkLight()
            light.SetLightTypeToSceneLight()
            light.SetPosition(*position)
            light.SetFocalPoint(120, 100, 15)
            light.SetIntensity(intensity)
            renderer.AddLight(light)
        for name, row, mapper in objects:
            actor = vtk.vtkActor()
            actor.SetMapper(mapper)
            color = (
                [0.07, 0.26, 0.15]
                if name == "MAIN_BOARD"
                else [0.025, 0.030, 0.035]
                if name in asics
                else [0.045, 0.050, 0.055]
            )
            prop = actor.GetProperty()
            prop.SetColor(*[c ** (1 / 2.2) for c in color])
            prop.SetInterpolationToPhong()
            prop.SetAmbient(0.25)
            prop.SetDiffuse(0.70)
            prop.SetSpecular(0.17)
            prop.SetSpecularPower(24)
            renderer.AddActor(actor)
            if args.annotate and name in labels:
                x, y, z, X, Y, Z = row["bounds_mm"]
                label = vtk.vtkBillboardTextActor3D()
                label.SetInput(labels[name])
                label.SetPosition((x + X) / 2, (y + Y) / 2, Z + 0.2)
                label.GetTextProperty().SetFontSize(20 if is_candidate else 23)
                label.GetTextProperty().SetColor(0.95, 0.96, 0.94)
                label.GetTextProperty().SetJustificationToCentered()
                renderer.AddActor(label)
        camera = renderer.GetActiveCamera()
        focus = np.array([120, 100, 17])
        camera.SetFocalPoint(*focus)
        camera.SetPosition(*(focus + 650 * np.array(direction)))
        camera.SetViewUp(0, 1, 0) if view == "top" else camera.SetViewUp(0, 0, 1)
        camera.ParallelProjectionOn()
        renderer.ResetCamera()
        camera.Zoom(0.94)
        window = vtk.vtkEGLRenderWindow()
        window.SetOffScreenRendering(1)
        window.SetSize(1800, 1200)
        window.SetMultiSamples(4)
        window.AddRenderer(renderer)
        window.Render()
        capture = vtk.vtkWindowToImageFilter()
        capture.SetInput(window)
        capture.SetInputBufferTypeToRGB()
        capture.ReadFrontBufferOff()
        capture.Update()
        output = output_dir / ("motherboard-passive-candidate-top.png" if args.passive_candidate else "motherboard-input-candidate-top.png" if args.input_candidate else "motherboard-" + view + ".png")
        writer = vtk.vtkPNGWriter()
        writer.SetFileName(str(output))
        writer.SetInputConnection(capture.GetOutputPort())
        writer.Write()
        window.Finalize()
        outputs[str(output.resolve())] = hashlib.sha256(output.read_bytes()).hexdigest()
    result = {
        "scope": __doc__,
        "input_sha256": inputs,
        "output_sha256": outputs,
        "annotation_refs": sorted(labels) if args.annotate else [],
        "geometry_owners": [
            "Native KiCad bareboard",
            "Current footprint-local component catalogue",
        ],
        "copper_tracks_invented": False,
        "parts": len(rows),
        "same_polydata_reused_for_all_views": True,
        "elapsed_seconds": perf_counter() - start,
    }
    if is_candidate:
        result["scope"] = "Candidate placements over the retained board and component models; unrouted, not a full assembly fit."
    if args.passive_candidate:
        result["scope"] += " Passive candidate has no J70 fan-supply connector."
    report = ROOT / (
        "build/reports/board-passive-candidate-publication.json" if args.passive_candidate
        else "build/reports/board-input-candidate-publication.json" if args.input_candidate
        else "build/reports/board-publication.json"
        if args.publication_dir
        else "build/reports/board-render.json"
    )
    report.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"outputs": list(outputs), "elapsed_seconds": result["elapsed_seconds"]}))


if __name__ == "__main__":
    main()
