"""Two views of the checked native cartridge-key detail, without surrogate geometry."""

import hashlib
import json
from pathlib import Path

import cadquery as cq
import vtk
from rendering import shape_polydata

ROOT = Path(__file__).resolve().parents[1]


def main():
    source = ROOT / "build/exports/BMSX_CARTRIDGE_POLARISATION_DETAIL.step"
    ledger = ROOT / "build/reports/cartridge-polarisation.json"
    checked = json.loads(ledger.read_text())
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    assert checked["pass"]
    assert digest == checked["output_sha256"][str(source.relative_to(ROOT))]
    details = checked["detail_STEP_roundtrip"]
    bounds = details["section_bounds_mm"]
    centre = [(bounds[i] + bounds[i + 3]) / 2 for i in range(3)]
    window = vtk.vtkEGLRenderWindow()
    window.SetOffScreenRendering(1)
    window.SetSize(1800, 1100)
    window.SetMultiSamples(4)
    scene = cq.Assembly.importStep(str(source))
    for panel, (state, title) in enumerate(
        [("CORRECT_SEATED", "CORRECT — SEATED"), ("REVERSED_BLOCKED", "REVERSED — BLOCKED")]
    ):
        renderer = vtk.vtkRenderer()
        renderer.SetViewport(panel / 2, 0, (panel + 1) / 2, 1)
        renderer.SetBackground(0.96, 0.96, 0.95)
        for shape, name, location, _ in scene:
            part = name.rsplit("/", 1)[-1]
            if not part.startswith(state + "__"):
                continue
            shape = shape.located(location)
            mapper = vtk.vtkPolyDataMapper()
            mapper.SetInputData(shape_polydata(shape, 0.06, 0.1))
            actor = vtk.vtkActor()
            actor.SetMapper(mapper)
            color = (
                (0.79, 0.74, 0.65)
                if part.endswith(("SHELL", "COVER"))
                else (0.12, 0.36, 0.23)
                if part.endswith(("PCB", "ROMS"))
                else (0.78, 0.55, 0.18)
                if part.endswith("FINGERS")
                else (0.12, 0.14, 0.16)
                if part.endswith("SOCKET")
                else (0.65, 0.58, 0.40)
                if part.endswith("G10")
                else (0.50, 0.55, 0.59)
            )
            actor.GetProperty().SetColor(*color)
            actor.GetProperty().SetInterpolationToPhong()
            actor.GetProperty().SetAmbient(0.3)
            actor.GetProperty().SetDiffuse(0.7)
            renderer.AddActor(actor)
        focus = centre.copy()
        focus[0] += panel * details["second_state_X_shift_mm"]
        camera = renderer.GetActiveCamera()
        camera.SetFocalPoint(*focus)
        camera.SetPosition(*(p + 200 * d for p, d in zip(focus, [-1.1, -1.0, 0.55])))
        camera.SetViewUp(0, 0, 1)
        camera.ParallelProjectionOn()
        camera.SetParallelScale(34)
        renderer.ResetCameraClippingRange()
        heading = vtk.vtkTextActor()
        heading.SetInput(title)
        heading.GetPositionCoordinate().SetCoordinateSystemToNormalizedViewport()
        heading.SetPosition(0.035, 0.94)
        heading.GetTextProperty().SetFontSize(28)
        heading.GetTextProperty().SetColor(0.09, 0.17, 0.23)
        renderer.AddViewProp(heading)
        window.AddRenderer(renderer)
    window.Render()
    capture = vtk.vtkWindowToImageFilter()
    capture.SetInput(window)
    capture.SetInputBufferTypeToRGB()
    capture.ReadFrontBufferOff()
    capture.Update()
    output = ROOT / "build/publication/cartridge-polarisation.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    writer = vtk.vtkPNGWriter()
    writer.SetFileName(str(output))
    writer.SetInputConnection(capture.GetOutputPort())
    writer.Write()
    window.Finalize()
    report = {
        "scope": __doc__,
        "input_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [source, ledger, Path(__file__), ROOT / "cad/rendering.py"]
        },
        "output_sha256": {
            str(output.relative_to(ROOT)): hashlib.sha256(output.read_bytes()).hexdigest()
        },
    }
    (ROOT / "build/reports/polarisation-publication.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )
    print(json.dumps({"output": str(output.relative_to(ROOT))}))


if __name__ == "__main__":
    main()
