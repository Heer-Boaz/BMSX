"""Present native spring-door states without recreating their kinematics.

The mechanical producer owns each state's complete transformed BReps. This
renderer selects views and an explicitly labelled geometric section. The
keyboard socket is shown with a conceptual round opening derived from the
occupied volume, not a manufacturer CAD model or a fit-checking solid.
CadQuery/OCCT own shape intersections and tessellation; VTK owns offscreen
rendering. The shared rendering owner supplies tessellation; VTK owns native viewports
and https://examples.vtk.org/site/Cxx/Utilities/OffScreenRendering/ documents the pipeline.
"""

import argparse
import hashlib
import json
from pathlib import Path
from time import monotonic

import cadquery as cq
import numpy as np
import vtk
from enclosure_style import face_paints
from geometry import bounds, box, overlaps
from rendering import shape_polydata

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--publication-dir", type=Path)
    parser.add_argument("--view", choices=("closed", "closed-keyboard", "insertion", "insertion-keyboard", "mechanism", "rear", "rear-presentation", "underside", "underside-keyboard", "dual", "dual-keyboard", "dual-reference", "open", "open-finned", "open-passive-finned", "open-passive-spreader"))
    args = parser.parse_args()
    publication = args.publication_dir
    if publication:
        publication.mkdir(parents=True, exist_ok=True)
    started = monotonic()
    scene_path = ROOT / "build/reports/compact-assembly.json"
    flap_path = ROOT / "build/reports/compact-cartridge-flaps.json"
    appearance_path = ROOT / "design/enclosure_appearance.json"
    scene = json.loads(scene_path.read_text())
    assert scene["integration_pass"]
    flap = json.loads(flap_path.read_text())
    appearance = json.loads(appearance_path.read_text())
    palette = appearance["palette"]
    inputs = {
        str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in [
            Path(__file__),
            scene_path,
            flap_path,
            appearance_path,
            ROOT / "cad/rendering.py",
            ROOT / "cad/geometry.py",
        ]
    }
    base = {
        name: row
        for name, row in (
            scene["physical_parts"]
            | {n: r for n, r in scene["receiving_spaces"].items() if r["visible"]}
        ).items()
        if row["module"] != "main"
        and not (name.startswith("BANK__SLOT") and not name.endswith("SOCKET"))
        and name not in flap["physical_parts"]
    }
    shapes = {}
    keyboard_presentation = None
    section_shapes = {}
    mappers = {}
    mesh_records = {}
    linear_mm, angular_rad = 0.12, 0.1
    outputs = {}
    cameras = {}
    # The section recipe is a presentation allocation, not a new mechanical
    # envelope or a substitute for the producer's movement/fit checks.
    section_bounds = flap["presentation"]["section_bounds_mm"]
    section = box(section_bounds)
    jobs = [
        ("closed", [("closed", "GESLOTEN STOFKLEPPEN", [0.95, -1.2, 0.95], False)]),
        ("closed-keyboard", [("closed", "KEYBOARDFRONT VOORSTEL", [0.95, -1.2, 0.95], False)]),
        (
            "insertion",
            [("insertion", "CARTRIDGE DRUKT DE KLEP NAAR BINNEN", [0.95, -1.2, 1.05], False)],
        ),
        (
            "insertion-keyboard",
            [("insertion", "CARTRIDGE DRUKT DE KLEP NAAR BINNEN", [0.95, -1.2, 1.05], False)],
        ),
        (
            "mechanism",
            [
                ("insertion", "DOORSNEDE | TIJDENS HET INDUWEN", [1, 0, 0], True),
                ("seated", "DOORSNEDE | CARTRIDGE GEPLAATST", [1, 0, 0], True),
            ],
        ),
    ]
    jobs.extend(
        [
            ("dual", [("seated", "BEIDE CARTRIDGES GEPLAATST", [0.95, -1.2, 1.05], False)]),
            ("dual-keyboard", [("seated", "BEIDE CARTRIDGES GEPLAATST", [0.95, -1.2, 1.05], False)]),
            ("dual-reference", [("seated", "BEIDE REFERENTIECARTRIDGES GEPLAATST", [0.95, -1.2, 1.05], False)]),
            ("open", [("closed", "INTERIEUR: VIERCHIPKANDIDAAT", [0.55, -0.9, 1.65], False)]),
            ("open-finned", [("closed", "INTERIEUR: KOELPROFIEL", [0.55, -0.9, 1.65], False)]),
            ("open-passive-finned", [("closed", "INTERIEUR: PASSIEVE KANDIDAAT", [0.55, -0.9, 1.65], False)]),
            ("open-passive-spreader", [("closed", "INTERIEUR: VLAKKE SPREIDER", [0.55, -0.9, 1.65], False)]),
            ("rear", [("closed", "ACHTERZIJDE", [-0.95, 1.2, 0.85], False)]),
            ("rear-presentation", [("closed", "ACHTERZIJDE: CONNECTORGEZICHTEN CONCEPT", [-0.95, 1.2, 0.85], False)]),
            ("underside", [("closed", "ONDERZIJDE", [0.35, -0.45, -1], False)]),
            ("underside-keyboard", [("closed", "ONDERZIJDE: KEYBOARDFRONT", [0.35, -0.45, -1], False)]),
        ]
    )
    if args.view:
        jobs = [job for job in jobs if job[0] == args.view]
    else:
        jobs = [job for job in jobs if job[0] not in ("dual", "dual-keyboard", "dual-reference", "insertion-keyboard", "underside-keyboard", "open", "open-finned", "open-passive-finned", "open-passive-spreader", "closed-keyboard", "rear-presentation")]
    for view, panels in jobs:
        window = vtk.vtkEGLRenderWindow()
        window.SetOffScreenRendering(1)
        window.SetSize(1800, 1200)
        window.SetMultiSamples(4)
        cameras[view] = {"panels": []}
        for panel_index, (state, title, direction, is_section) in enumerate(panels):
            rows = base | flap["states"][state]["parts"]
            if view == "rear-presentation":
                rear_path = ROOT / "build/exports/BMSX_REAR_CONNECTOR_PRESENTATION.step"
                rear_report_path = ROOT / "build/reports/rear-connector-presentation.json"
                exchange_path = ROOT / "build/reports/console-exchange-rear-presentation.json"
                rear_report = json.loads(rear_report_path.read_text())
                exchange = json.loads(exchange_path.read_text())
                digest = hashlib.sha256(rear_path.read_bytes()).hexdigest()
                assert digest == rear_report["output_sha256"]
                assert digest == exchange["input_sha256"][str(rear_path.relative_to(ROOT))]
                for path in (rear_path, rear_report_path, exchange_path):
                    inputs[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
                for name in exchange["presentation_only_removed_envelopes"]:
                    del rows[name]
                for shape, part_name, location, color in cq.Assembly.importStep(str(rear_path)):
                    name = part_name.rsplit("/", 1)[-1]
                    key = digest + ":" + name
                    shapes[key] = shape.located(location)
                    rows["REAR_PRESENTATION__" + name] = {
                        "brep": str(rear_path.relative_to(ROOT)), "sha256": key,
                        "bounds_mm": bounds(shapes[key]), "module": "rear-presentation",
                        "material": "visual-concept",
                    }
            if view in ("open", "open-finned", "open-passive-finned", "open-passive-spreader"):
                # Show the retained assembly without the removable enclosure
                # and its door parts. The candidate export records the actual
                # KiCad positions and the existing source model for each change.
                exchange_path = ROOT / (
                    "build/reports/console-exchange-passive-candidate.json" if view in ("open-passive-finned", "open-passive-spreader")
                    else "build/reports/console-exchange-input-candidate.json"
                )
                board_path = ROOT / "build/reports/mainboard.json"
                exchange = json.loads(exchange_path.read_text())
                board = json.loads(board_path.read_text())
                for path in (exchange_path, board_path):
                    inputs[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
                positions = {row["ref"]: row["position_mm"] for row in board["placements"]}
                rows = {
                    name: row for name, row in scene["physical_parts"].items()
                    if name not in ("CASE__FIXED_BODY", "CASE__REMOVABLE_LID")
                    and not name.startswith("FLAP__")
                } | {name: row for name, row in scene["receiving_spaces"].items() if row["visible"]}
                if view in ("open-passive-finned", "open-passive-spreader"):
                    for ref in exchange["removed_components"]:
                        del rows["MAIN__" + ref]
                for ref, changed in exchange["candidate_components"].items():
                    source_ref = changed["representation_from"]
                    before = positions[source_ref]
                    after = changed["position_mm"]
                    rows["MAIN__" + ref] = {
                        **scene["physical_parts"]["MAIN__" + source_ref],
                        "render_translation": [after[0] - before[0], after[1] - before[1], 0],
                    }
            if view in ("dual", "dual-keyboard"):
                # Both slots use the same native leaf and spring geometry.  The
                # seated owner supplies slot 0; translate that actual open pose
                # to slot 1 rather than showing its closed state under a card.
                rows = dict(rows)
                centres_path = ROOT / "design/cartridge_polarisation.json"
                candidate_path = ROOT / "build/reports/msx-cartridge-candidate.json"
                centres = json.loads(centres_path.read_text())["slot_centres_XY_mm"]
                candidate = json.loads(candidate_path.read_text())
                for path in (centres_path, candidate_path):
                    inputs[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
                shift = [centres[1][0] - centres[0][0], centres[1][1] - centres[0][1], 0]
                for suffix in ("LEAF", "TORSION_SPRING_PROPOSAL"):
                    rows[f"FLAP__SLOT1__{suffix}"] = {
                        **rows[f"FLAP__SLOT0__{suffix}"], "render_translation": shift
                    }
                for entry in candidate["parts"]:
                    if entry["role"] == "SOCKET":
                        continue
                    path = f"build/cad/msx_cartridge_candidate/{entry['name']}.brep"
                    rows["BANK__" + entry["name"]] = {
                        "brep": path,
                        "sha256": candidate["output_sha256"][path],
                        "bounds_mm": entry["bounds_mm"],
                        "module": "bank",
                        "material": "card_native",
                        "render_translation": [*centres[0], 0],
                    }
            if view == "dual-reference":
                # Render the actual combined native STEP, not a reassembly of
                # the older cartridge and frame BReps. Hidden board components
                # are omitted. As in the other exterior views the keyboard
                # occupancy is cut for an illustrative round socket face below.
                step_path = ROOT / "build/exports/BMSX_CONSOLE_TWO_MSX_SKIRT_CARTRIDGES_CONCEPT.step"
                report_path = ROOT / "build/reports/console-exchange-two-msx-skirt-cartridges.json"
                report = json.loads(report_path.read_text())
                digest = hashlib.sha256(step_path.read_bytes()).hexdigest()
                assert digest == report["export_sha256"]
                inputs[str(step_path.relative_to(ROOT))] = digest
                inputs[str(report_path.relative_to(ROOT))] = hashlib.sha256(report_path.read_bytes()).hexdigest()
                visible_records = scene["physical_parts"] | {
                    n: r for n, r in scene["receiving_spaces"].items() if r["visible"]
                }
                rows = {}
                for part, part_name, location, color in cq.Assembly.importStep(str(step_path)):
                    name = part_name.rsplit("/", 1)[-1]
                    if name.startswith("MAIN__"):
                        continue
                    if name not in visible_records and not name.startswith("CARTRIDGE__"):
                        continue
                    shape = part.located(location)
                    key = digest + ":" + name
                    shapes[key] = shape
                    row = visible_records[name] if name in visible_records else {"module": "bank", "material": "card_native"}
                    rows[name] = {**row, "brep": str(step_path.relative_to(ROOT)), "sha256": key,
                                  "bounds_mm": bounds(shape)}
                keyboard_report_path = ROOT / "build/reports/keyboard-panel-candidate.json"
                style_path = ROOT / "design/enclosure_styling.json"
                keyboard_report = json.loads(keyboard_report_path.read_text())
                for p in (keyboard_report_path, style_path, ROOT / "cad/enclosure_style.py"):
                    inputs[str(p.relative_to(ROOT))] = hashlib.sha256(p.read_bytes()).hexdigest()
            parts = []
            for name, row in rows.items():
                if is_section and not overlaps(row["bounds_mm"], section_bounds):
                    continue
                path = ROOT / row["brep"]
                digest = row["sha256"]
                if digest not in shapes:
                    assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
                    shapes[digest] = cq.Shape.importBrep(str(path))
                    inputs[str(path.relative_to(ROOT))] = digest
                shape = shapes[digest]
                if view in ("closed-keyboard", "rear-presentation", "insertion-keyboard", "dual-keyboard", "underside-keyboard") and name == "CASE__FIXED_BODY":
                    keyboard_path = ROOT / "build/exports/BMSX_KEYBOARD_PANEL_CANDIDATE.step"
                    keyboard_report_path = ROOT / "build/reports/keyboard-panel-candidate.json"
                    exchange_path = ROOT / "build/reports/console-exchange-passive-spreader-keyboard.json"
                    style_path = ROOT / "design/enclosure_styling.json"
                    keyboard_report = json.loads(keyboard_report_path.read_text())
                    exchange = json.loads(exchange_path.read_text())
                    digest = hashlib.sha256(keyboard_path.read_bytes()).hexdigest()
                    assert digest == keyboard_report["export_sha256"]
                    assert digest == exchange["input_sha256"][str(keyboard_path.relative_to(ROOT))]
                    for p in (keyboard_path, keyboard_report_path, exchange_path, style_path, ROOT / "cad/enclosure_style.py"):
                        inputs[str(p.relative_to(ROOT))] = hashlib.sha256(p.read_bytes()).hexdigest()
                    shape = next(part.located(location) for part, part_name, location, _ in
                                 cq.Assembly.importStep(str(keyboard_path))
                                 if part_name.rsplit("/", 1)[-1] == "CASE__FIXED_BODY_WITH_KEYBOARD_LIP")
                    path = keyboard_path
                if view == "open-passive-spreader" and name == "COOLING__SK50875_MACHINED_RECEIVING":
                    # Display the exact alternative STEP plate, not the tall envelope.
                    spreader_path = ROOT / "build/exports/BMSX_PASSIVE_SPREADER_CONCEPT.step"
                    spreader_report_path = ROOT / "build/reports/passive-spreader-candidate.json"
                    spreader_report = json.loads(spreader_report_path.read_text())
                    assert hashlib.sha256(spreader_path.read_bytes()).hexdigest() == spreader_report["output_sha256"]
                    for p in (spreader_path, spreader_report_path):
                        inputs[str(p.relative_to(ROOT))] = hashlib.sha256(p.read_bytes()).hexdigest()
                    shape = next(part.located(location) for part, part_name, location, _ in
                                 cq.Assembly.importStep(str(spreader_path))
                                 if part_name.rsplit("/", 1)[-1] == "COOLING__LOW_PROFILE_SPREADER_CONCEPT")
                    digest = spreader_report["output_sha256"]
                    path = spreader_path
                if view in ("open-finned", "open-passive-finned") and name == "COOLING__SK50875_MACHINED_RECEIVING":
                    # Presentation only: retain the known envelope and base,
                    # then show simplified straight fins from the published profile.
                    # The original solid remains the conservative fit owner.
                    profile_path = ROOT / "design/cooling_presentation.json"
                    cooling_path = ROOT / "design/enclosure_cooling.json"
                    profile = json.loads(profile_path.read_text())
                    cooling = json.loads(cooling_path.read_text())["sink"]
                    for p in (profile_path, cooling_path):
                        inputs[str(p.relative_to(ROOT))] = hashlib.sha256(p.read_bytes()).hexdigest()
                    x0, y0, z0, x1, y1, z1 = cooling["receiving_bounds_mm"]
                    fin = profile["fin_nominal_thickness_mm"]
                    pitch = profile["fin_centre_pitch_mm"]
                    cuts = [box([x0 + fin + i * pitch, y0, z0 + cooling["continuous_base_thickness_mm"],
                                 x0 + (i + 1) * pitch, y1, z1])
                            for i in range(profile["fin_count"] - 1)]
                    shape = shape.cut(*cuts)
                if name == "KEYBOARD__MD60S_MANUFACTURER_MAX_BODY_OCCUPANCY":
                    # The assembly uses the closed maximum occupancy for fit.
                    # Show a separate concept of the 8 mm round receptacle in
                    # views only; do not export this solid or use it for fit.
                    if keyboard_presentation is None:
                        opening = cq.Solid.makeCylinder(
                            4, 5, cq.Vector(24, -1, 23.55), cq.Vector(0, 1, 0)
                        )
                        keyboard_presentation = shape.cut(opening)
                    shape = keyboard_presentation
                if is_section:
                    if digest not in section_shapes:
                        section_shapes[digest] = shape.intersect(section)
                    shape = section_shapes[digest]
                    if not shape.Solids():
                        continue
                if name in ("REAR_PRESENTATION__DC_ILLUSTRATIVE_BUSHING", "REAR_PRESENTATION__DC_ILLUSTRATIVE_CENTRE_PIN"):
                    color = [0.65, 0.68, 0.70]
                elif name in ["CASE__FIXED_BODY", "CASE__REMOVABLE_LID"]:
                    color = palette["shell"]
                elif name == "TOP_CONTROLS__BLUE_POWER_SLIDE":
                    color = palette["power"]
                elif name == "TOP_CONTROLS__GREEN_LED_LENS":
                    color = palette["led"]
                elif name.startswith("CASE_BOTTOM_"):
                    color = [0.48, 0.50, 0.51]
                elif name in ["CASE__ALUMINIUM_BASE", "CASE__BOTTOM_COVER"] or name.startswith(
                    "CASE__FOOT_"
                ):
                    color = palette["plinth"]
                elif name.startswith("FLAP__"):
                    color = (
                        palette["slot_well"] if row["material"] == "polymer" else [0.56, 0.59, 0.61]
                    )
                elif (name.startswith("BANK__SLOT") and not name.endswith("SOCKET")) or name.startswith("CARTRIDGE__"):
                    color = (
                        [0.10, 0.31, 0.24]
                        if name.endswith(("PCB", "ROMS"))
                        else [0.65, 0.47, 0.13]
                        if name.endswith("FINGERS")
                        else palette["cartridge_body"]
                    )
                elif (
                    row["module"] == "board"
                    or name
                    in [
                        "FRONT__COMPACT_NATIVE_DRILLED_BOARD",
                        "KEYBOARD__KEYBOARD_NATIVE_DRILLED_BOARD",
                        "AV_BREAKOUT_NATIVE_DRILLED_PCB",
                    ]
                    or name.endswith("__PCB")
                ):
                    color = [0.10, 0.31, 0.24]
                elif "CONTACT" in name or "FINGER" in name:
                    color = [0.65, 0.47, 0.13]
                elif row["module"] == "cartridge-frame":
                    color = [0.51, 0.55, 0.58]
                else:
                    color = palette["fascia"]
                groups = [("body", shape, color)]
                if name in ["CASE__FIXED_BODY", "CASE__REMOVABLE_LID"] and not is_section:
                    paints = row["face_paints"]
                    if view in ("closed-keyboard", "rear-presentation", "insertion-keyboard", "dual-keyboard", "dual-reference", "underside-keyboard") and name == "CASE__FIXED_BODY":
                        paints = face_paints(name, shape, json.loads(style_path.read_text()))
                        painted = {entry["face_index"] for entry in paints}
                        b = keyboard_report["panel_lip_bounds_mm"]
                        for index, face in enumerate(shape.Faces()):
                            bb = bounds(face)
                            if index not in painted and all(bb[i] >= b[i] - 1e-6 and bb[i + 3] <= b[i + 3] + 1e-6 for i in range(3)):
                                paints.append({"face_index": index, "appearance": "fascia"})
                    faces = shape.Faces()
                    painted = {r["face_index"] for r in paints}
                    groups = [
                        (
                            "body",
                            cq.Compound.makeCompound(
                                [f for i, f in enumerate(faces) if i not in painted]
                            ),
                            color,
                        )
                    ]
                    for tag in sorted({r["appearance"] for r in paints}):
                        groups.append(
                            (
                                tag,
                                cq.Compound.makeCompound(
                                    [
                                        faces[r["face_index"]]
                                        for r in paints
                                        if r["appearance"] == tag
                                    ]
                                ),
                                palette[tag],
                            )
                        )
                for tag, solid, group_color in groups:
                    key = (digest, tag, is_section)
                    if key not in mappers:
                        mesh = shape_polydata(solid, linear_mm, angular_rad)
                        normals = vtk.vtkPolyDataNormals()
                        normals.SetInputData(mesh)
                        normals.SetFeatureAngle(35)
                        normals.SplittingOn()
                        normals.ConsistencyOn()
                        normals.ComputePointNormalsOn()
                        normals.Update()
                        mapper = vtk.vtkPolyDataMapper()
                        mapper.SetInputData(normals.GetOutput())
                        mappers[key] = mapper
                        mesh_records[str(key)] = {
                            "source_BRep": str(path.relative_to(ROOT)),
                            "section": is_section,
                            "points": mesh.GetNumberOfPoints(),
                            "triangles": mesh.GetNumberOfCells(),
                        }
                    parts.append((name, mappers[key], group_color, row.get("render_translation", (0, 0, 0))))
            renderer = vtk.vtkRenderer()
            renderer.SetViewport(panel_index / len(panels), 0, (panel_index + 1) / len(panels), 1)
            renderer.SetBackground(0.97, 0.97, 0.96)
            renderer.SetBackground2(0.87, 0.88, 0.88)
            renderer.GradientBackgroundOn()
            renderer.AutomaticLightCreationOff()
            focus = np.array(
                flap["presentation"]["section_focus_mm"] if is_section else [120, 95, 40]
            )
            for position, intensity in [
                ([-140, -200, 360], 0.95),
                ([400, -50, 220], 0.45),
                ([100, 350, 400], 0.25),
            ]:
                light = vtk.vtkLight()
                light.SetLightTypeToSceneLight()
                light.SetPosition(*position)
                light.SetFocalPoint(*focus)
                light.SetColor(1, 1, 1)
                light.SetIntensity(intensity)
                renderer.AddLight(light)
            if view in ("underside", "underside-keyboard"):
                light = vtk.vtkLight()
                light.SetLightTypeToSceneLight()
                light.SetPosition(120, 95, -350)
                light.SetFocalPoint(*focus)
                light.SetIntensity(0.9)
                renderer.AddLight(light)
            for name, mapper, color, translation in parts:
                actor = vtk.vtkActor()
                actor.SetMapper(mapper)
                actor.SetPosition(*translation)
                prop = actor.GetProperty()
                prop.SetColor(*[c ** (1 / 2.2) for c in color])
                prop.SetInterpolationToPhong()
                prop.SetAmbient(0.23)
                prop.SetDiffuse(0.72)
                prop.SetSpecular(0.14)
                prop.SetSpecularPower(24)
                renderer.AddActor(actor)
            if not is_section and view not in ("open", "open-finned", "open-passive-finned", "open-passive-spreader"):
                for mark in appearance["print_markings"]:
                    vector = vtk.vtkVectorText()
                    vector.SetText(mark["text"])
                    vector.Update()
                    bb = vector.GetOutput().GetBounds()
                    scale = mark["height_mm"] / (bb[3] - bb[2])
                    anchor = (bb[0] + bb[1]) / 2 if mark["align"] == "center" else bb[0]
                    transform = vtk.vtkTransform()
                    transform.PostMultiply()
                    transform.Translate(-anchor, -bb[2], 0)
                    transform.Scale(scale, scale, scale)
                    transform.RotateZ(mark["rotation_deg"])
                    if mark["plane"] == "XZ":
                        transform.RotateX(90)
                    transform.Translate(*mark["world_xyz_mm"])
                    mapper = vtk.vtkPolyDataMapper()
                    mapper.SetInputConnection(vector.GetOutputPort())
                    actor = vtk.vtkActor()
                    actor.SetMapper(mapper)
                    actor.SetUserTransform(transform)
                    actor.GetProperty().SetColor(
                        *[c ** (1 / 2.2) for c in palette[mark["color_key"]]]
                    )
                    actor.GetProperty().LightingOff()
                    renderer.AddActor(actor)
            heading = vtk.vtkTextActor()
            heading.SetInput("BMSX | " + title)
            heading.GetPositionCoordinate().SetCoordinateSystemToNormalizedViewport()
            heading.SetPosition(0.03, 0.95)
            heading.GetTextProperty().SetFontSize(22 if is_section else 26)
            heading.GetTextProperty().SetColor(0.12, 0.18, 0.25)
            if publication is None:
                renderer.AddViewProp(heading)
            if is_section:
                angle_text = vtk.vtkTextActor()
                angle_text.SetInput(
                    f"Klepstand: {flap['states'][state]['angle_degrees']:.1f} graden"
                )
                angle_text.GetPositionCoordinate().SetCoordinateSystemToNormalizedViewport()
                angle_text.SetPosition(0.03, 0.90)
                angle_text.GetTextProperty().SetFontSize(21)
                angle_text.GetTextProperty().SetColor(0.22, 0.28, 0.35)
                if publication is None:
                    renderer.AddViewProp(angle_text)
            note = vtk.vtkTextActor()
            note.SetInput(
                "Native CAD-doorsnede | veer en scharnierlager buiten deze snede"
                if is_section
                else "Native CAD | keyboardaansluiting conceptueel; montage- en veerkwalificatie volgt op prototype"
            )
            note.GetPositionCoordinate().SetCoordinateSystemToNormalizedViewport()
            note.SetPosition(0.03, 0.025)
            note.GetTextProperty().SetFontSize(15 if is_section else 18)
            note.GetTextProperty().SetColor(0.22, 0.28, 0.35)
            if publication is None:
                renderer.AddViewProp(note)
            window.AddRenderer(renderer)
            camera = renderer.GetActiveCamera()
            camera.SetFocalPoint(*focus)
            camera.SetPosition(*(focus + 650 * np.asarray(direction)))
            camera.SetViewUp(0, 1, 0) if view in ("underside", "underside-keyboard") else camera.SetViewUp(0, 0, 1)
            camera.ParallelProjectionOn()
            renderer.ResetCamera()
            camera.Zoom(0.90)
            cameras[view]["panels"].append(
                {
                    "state": state,
                    "section_bounds_mm": section_bounds if is_section else None,
                    "position": list(camera.GetPosition()),
                    "focal_point": list(camera.GetFocalPoint()),
                    "parallel_scale": camera.GetParallelScale(),
                }
            )
        window.Render()
        capture = vtk.vtkWindowToImageFilter()
        capture.SetInput(window)
        capture.SetInputBufferTypeToRGB()
        capture.ReadFrontBufferOff()
        capture.Update()
        if publication:
            output = (
                publication
                / {
                    "closed": "exterior.png",
                    "closed-keyboard": "exterior-keyboard-candidate.png",
                    "insertion": "cartridge-insertion.png",
                    "insertion-keyboard": "cartridge-insertion-keyboard-candidate.png",
                    "mechanism": "cartridge-doors.png",
                    "rear": "exterior-rear.png",
                    "rear-presentation": "exterior-rear-connectors-concept.png",
                    "underside": "exterior-underside.png",
                    "underside-keyboard": "exterior-underside-keyboard-candidate.png",
                    "dual": "cartridges-dual-seated.png",
                    "dual-keyboard": "cartridges-dual-seated-keyboard-candidate.png",
                    "dual-reference": "cartridges-dual-seated-reference.png",
                    "open": "console-interior-candidate.png",
                    "open-finned": "console-interior-finned-concept.png",
                    "open-passive-finned": "console-interior-passive-candidate.png",
                    "open-passive-spreader": "console-interior-passive-spreader.png",
                }[view]
            )
        else:
            output = ROOT / "build/exports" / ("BMSX_CARTRIDGE_KLEPPEN_" + view + ".png")
        writer = vtk.vtkPNGWriter()
        writer.SetFileName(str(output))
        writer.SetInputConnection(capture.GetOutputPort())
        writer.Write()
        outputs[str(output.resolve())] = hashlib.sha256(output.read_bytes()).hexdigest()
        window.Finalize()
    report = {
        "scope": __doc__,
        "input_sha256": inputs,
        "output_sha256": outputs,
        "views": cameras,
        "native_BRep_sources_loaded": len(shapes),
        "native_section_intersections": len(section_shapes),
        "unique_meshes": mesh_records,
        "image_size_px": [1800, 1200],
        "mechanism_composition": (
            "Two native VTK viewports, no PNG stitching" if "mechanism" in cameras else None
        ),
        "dual_slot_composition": (
            "Both MSX-style candidate cards from the combined reference STEP; hidden mainboard components are omitted and the keyboard face is an illustrative cut in its occupancy model."
            if "dual-reference" in cameras else
            "Both MSX-style candidate cards and the native seated slot-0 leaf and spring pose translated to slot 1; nominal presentation, not a new fit check."
            if "dual" in cameras or "dual-keyboard" in cameras else None
        ),
        "open_slot_composition": (
            "Retained assembly with outer body and lid omitted; proposed board components at INPUT-candidate positions, using the candidate STEP export placement records. This is a presentation, not a new fit check."
            if "open" in cameras else None
        ),
        "passive_open_composition": (
            "Retained assembly with the passive board candidate and J70 removed; a placement illustration, not a full fit check."
            if "open-passive-finned" in cameras or "open-passive-spreader" in cameras else None
        ),
        "finned_profile_composition": (
            "Illustrative square-edged fins based on the SK 508 profile drawing; not factory CAD or a fit or thermal calculation."
            if "open-finned" in cameras or "open-passive-finned" in cameras else None
        ),
        "spreader_composition": (
            "Alternative STEP plate at the existing nominal package contacts; no thermal or full assembly fit qualification."
            if "open-passive-spreader" in cameras else None
        ),
        "keyboard_front_composition": (
            "Retained exterior with the keyboard-lip STEP used by the combined candidate; the connector socket is illustrative. No plug mating or whole-assembly qualification."
            if any(view in cameras for view in ("closed-keyboard", "insertion-keyboard", "dual-keyboard", "dual-reference", "underside-keyboard")) else None
        ),
        "rear_connector_composition": (
            "Separate visual faces replace visible rear occupancy shapes; connector cavity and DC bore are illustrative, not manufacturer CAD or a fit check."
            if "rear-presentation" in cameras else None
        ),
        "whole_STEP_read": "open-passive-spreader" in cameras or "dual-reference" in cameras,
        "kinematics_recreated_by_renderer": False,
        "clearance_qualification": False,
        "elapsed_seconds": monotonic() - started,
    }
    (
        ROOT
        / (
            (
                f"build/reports/console-{args.view}-publication.json"
                if args.view
                else "build/reports/console-publication.json"
            )
            if publication
            else (
                f"build/reports/console-{args.view}-render.json"
                if args.view
                else "build/reports/console-render.json"
            )
        )
    ).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"outputs": outputs, "elapsed_seconds": report["elapsed_seconds"]}, indent=2))


if __name__ == "__main__":
    main()
