"""Render the native cartridge shell with illustrative game-image overlays.

The planes are presentation only; they do not modify or qualify the STEP model.
Texture mapping follows https://examples.vtk.org/site/Python/Texture/TexturePlane/.
"""

import argparse
import hashlib
import json
from pathlib import Path

import cadquery as cq
import vtk
from rendering import shape_polydata

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--msx-style", action="store_true")
    parser.add_argument("--reference", action="store_true",
                        help="render the MSX-styled skirt candidate from its native STEP")
    args = parser.parse_args()
    if args.reference:
        step = ROOT / 'build/exports/BMSX_CARTRIDGE_MSX_SKIRT_CONCEPT.step'
        ledger = ROOT / 'build/reports/cartridge-msx-skirt-concept.json'
        checked = json.loads(ledger.read_text())
        assert hashlib.sha256(step.read_bytes()).hexdigest() == checked['export_sha256']
        shapes = {name.rsplit('/', 1)[-1]: shape.located(location)
                  for shape, name, location, _ in cq.Assembly.importStep(str(step))}
        colors = {'SHELL': (0.18, 0.19, 0.21), 'COVER': (0.18, 0.19, 0.21),
                  'PCB': (0.12, 0.36, 0.23), 'FINGERS': (0.78, 0.55, 0.18)}
        meshes = {part: shape_polydata(shapes['SLOT0__' + part], 0.08, 0.12)
                  for part in colors}
        window = vtk.vtkEGLRenderWindow()
        window.SetOffScreenRendering(1)
        window.SetSize(1800, 1050)
        window.SetMultiSamples(4)
        for panel, (heading, position) in enumerate((
            ('FRONT: SHELL AND PROTECTIVE SKIRT', (295, -190, 155)),
            ('REAR: BOARD AND CONTACT EDGE', (45, 410, 105)),
        )):
            renderer = vtk.vtkRenderer()
            renderer.SetViewport(panel / 2, 0, (panel + 1) / 2, 1)
            renderer.SetBackground(0.94, 0.94, 0.92)
            for part, color in colors.items():
                mapper = vtk.vtkPolyDataMapper()
                mapper.SetInputData(meshes[part])
                actor = vtk.vtkActor()
                actor.SetMapper(mapper)
                actor.GetProperty().SetColor(*color)
                actor.GetProperty().SetInterpolationToPhong()
                actor.GetProperty().SetAmbient(0.3)
                actor.GetProperty().SetDiffuse(0.7)
                renderer.AddActor(actor)
            camera = renderer.GetActiveCamera()
            camera.SetFocalPoint(170, 110, 65)
            camera.SetPosition(*position)
            camera.SetViewUp(0, 0, 1)
            camera.ParallelProjectionOn()
            camera.SetParallelScale(70)
            renderer.ResetCameraClippingRange()
            title = vtk.vtkTextActor()
            title.SetInput(heading)
            title.GetPositionCoordinate().SetCoordinateSystemToNormalizedViewport()
            title.SetPosition(0.04, 0.94)
            title.GetTextProperty().SetFontSize(23)
            title.GetTextProperty().SetColor(0.09, 0.17, 0.23)
            renderer.AddViewProp(title)
            window.AddRenderer(renderer)
        window.Render()
        capture = vtk.vtkWindowToImageFilter()
        capture.SetInput(window)
        capture.SetInputBufferTypeToRGB()
        capture.ReadFrontBufferOff()
        capture.Update()
        output = ROOT / 'build/publication/cartridge-reference-msx-skirt.png'
        output.parent.mkdir(parents=True, exist_ok=True)
        writer = vtk.vtkPNGWriter()
        writer.SetFileName(str(output))
        writer.SetInputConnection(capture.GetOutputPort())
        writer.Write()
        window.Finalize()
        inputs = (Path(__file__), ROOT / 'cad/rendering.py', ledger, step)
        report = {
            'scope': 'Two exterior views of the proposed cartridge STEP; not a fit or manufacturing check.',
            'input_sha256': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs},
            'output_sha256': {str(output.relative_to(ROOT)): hashlib.sha256(output.read_bytes()).hexdigest()},
        }
        (ROOT / 'build/reports/cartridge-reference-msx-skirt-publication.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'output': str(output.relative_to(ROOT))}))
        return
    variant = "msx-cartridge-candidate" if args.msx_style else "compact-cartridge-bank"
    model_dir = "msx_cartridge_candidate" if args.msx_style else "compact_cartridge_bank"
    ledger = ROOT / f"build/reports/{variant}.json"
    palette = ROOT / "design/enclosure_appearance.json"
    checked = json.loads(ledger.read_text())
    shell_color = json.loads(palette.read_text())["palette"]["cartridge_body"]
    shapes = {}
    inputs = [ledger, palette, Path(__file__), ROOT / "cad/rendering.py"]
    for part in ("SHELL", "COVER", "PCB", "FINGERS"):
        source = ROOT / f"build/cad/{model_dir}/SLOT0__{part}.brep"
        assert (
            hashlib.sha256(source.read_bytes()).hexdigest()
            == checked["output_sha256"][str(source.relative_to(ROOT))]
        )
        inputs.append(source)
        shapes[part] = shape_polydata(cq.Shape.importBrep(str(source)), 0.08, 0.12)

    window = vtk.vtkEGLRenderWindow()
    window.SetOffScreenRendering(1)
    window.SetSize(1800, 1050)
    window.SetMultiSamples(4)
    for panel, (title, filename) in enumerate(
        [
            ("MIST OVER DE MINUTEN", "pietsona_title.png"),
            ("THE MAZE OF PIETIOUS", "pietious_title.png"),
        ]
    ):
        renderer = vtk.vtkRenderer()
        renderer.SetViewport(panel / 2, 0, (panel + 1) / 2, 1)
        renderer.SetBackground(0.94, 0.94, 0.92)
        for part, polydata in shapes.items():
            mapper = vtk.vtkPolyDataMapper()
            mapper.SetInputData(polydata)
            actor = vtk.vtkActor()
            actor.SetMapper(mapper)
            color = (
                shell_color
                if part in ("SHELL", "COVER")
                else ((0.12, 0.36, 0.23) if part == "PCB" else (0.78, 0.55, 0.18))
            )
            actor.GetProperty().SetColor(*color)
            actor.GetProperty().SetInterpolationToPhong()
            actor.GetProperty().SetAmbient(0.3)
            actor.GetProperty().SetDiffuse(0.7)
            renderer.AddActor(actor)

        artwork = ROOT / "reference/accessories-a04/research/game_art" / filename
        inputs.append(artwork)
        reader = vtk.vtkPNGReader()
        reader.SetFileName(str(artwork))
        texture = vtk.vtkTexture()
        texture.SetInputConnection(reader.GetOutputPort())
        texture.InterpolateOn()
        # A rendering plane in front of the native shell, not a material layer.
        plane = vtk.vtkPlaneSource()
        if args.msx_style:
            plane.SetOrigin(-42.5, -8.76, 44)
            plane.SetPoint1(42.5, -8.76, 44)
            plane.SetPoint2(-42.5, -8.76, 99)
        else:
            plane.SetOrigin(-40, -9.02, 40)
            plane.SetPoint1(40, -9.02, 40)
            plane.SetPoint2(-40, -9.02, 100)
        mapper = vtk.vtkPolyDataMapper()
        mapper.SetInputConnection(plane.GetOutputPort())
        actor = vtk.vtkActor()
        actor.SetMapper(mapper)
        actor.SetTexture(texture)
        actor.GetProperty().SetAmbient(1)
        actor.GetProperty().SetDiffuse(0)
        renderer.AddActor(actor)

        camera = renderer.GetActiveCamera()
        camera.SetFocalPoint(0, 0, 65)
        camera.SetPosition(125, -300, 155)
        camera.SetViewUp(0, 0, 1)
        camera.ParallelProjectionOn()
        camera.SetParallelScale(70)
        renderer.ResetCameraClippingRange()
        heading = vtk.vtkTextActor()
        heading.SetInput(title)
        heading.GetPositionCoordinate().SetCoordinateSystemToNormalizedViewport()
        heading.SetPosition(0.04, 0.94)
        heading.GetTextProperty().SetFontSize(25)
        heading.GetTextProperty().SetColor(0.09, 0.17, 0.23)
        renderer.AddViewProp(heading)
        window.AddRenderer(renderer)

    window.Render()
    capture = vtk.vtkWindowToImageFilter()
    capture.SetInput(window)
    capture.SetInputBufferTypeToRGB()
    capture.ReadFrontBufferOff()
    capture.Update()
    stem = "cartridge-editions-msx-native" if args.msx_style else "cartridge-editions-native"
    output = ROOT / f"build/publication/{stem}.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    writer = vtk.vtkPNGWriter()
    writer.SetFileName(str(output))
    writer.SetInputConnection(capture.GetOutputPort())
    writer.Write()
    window.Finalize()
    report = {
        "scope": __doc__,
        "input_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs
        },
        "output_sha256": {
            str(output.relative_to(ROOT)): hashlib.sha256(output.read_bytes()).hexdigest()
        },
    }
    report_name = (
        "cartridge-editions-msx-publication" if args.msx_style else "cartridge-editions-publication"
    )
    (ROOT / f"build/reports/{report_name}.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"output": str(output.relative_to(ROOT))}))


if __name__ == "__main__":
    main()
