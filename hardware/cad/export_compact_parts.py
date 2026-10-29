"""Export the frozen case parts individually for CAD/CAM and prototype meshing.

STEP preserves analytic native surfaces; STL is mm-unit prototype mesh only,
not a source of tolerances, tapped thread geometry or fabrication approval.
CadQuery Shape.exportStl uses explicit absolute mm deflection (not default
edge-relative tolerance): https://cadquery.readthedocs.io/en/latest/importexport.html
CadQuery/OCC exports and VTK's edge topology are the standard format owners.
"""

import hashlib
import json
from pathlib import Path
from time import perf_counter

import cadquery as cq
import vtk

ROOT = Path(__file__).resolve().parents[1]


def main():
    start = perf_counter()
    report_path = ROOT / "build/reports/compact-structure.json"
    report = json.loads(report_path.read_text())
    assert not report["material_intersections"]
    selected = [
        "CASE__FIXED_BODY",
        "CASE__REMOVABLE_LID",
        "CASE__ALUMINIUM_BASE",
        "CASE__BOTTOM_COVER",
        "CASE__LEFT_COMPRESSION_0",
        "CASE__LEFT_COMPRESSION_2",
    ] + ["CASE__FOOT_" + str(i) for i in range(4)]
    mesh_dir = ROOT / "build/exports/stl"
    step_dir = ROOT / "build/exports/parts"
    mesh_dir.mkdir(parents=True, exist_ok=True)
    step_dir.mkdir(parents=True, exist_ok=True)
    rows = {}
    for name in selected:
        row = report["physical_parts"][name]
        source = ROOT / row["brep"]
        assert hashlib.sha256(source.read_bytes()).hexdigest() == row["sha256"]
        shape = cq.Shape.importBrep(str(source))
        assert shape.isValid() and len(shape.Solids()) == 1
        stem = "BMSX_COMPACT_" + name
        step = step_dir / (stem + ".step")
        mesh = mesh_dir / (stem + ".stl")
        cq.exporters.export(shape, str(step))
        native = cq.importers.importStep(str(step)).val()
        assert (
            native.isValid()
            and len(native.Solids()) == 1
            and abs(native.Volume(tol=1e-10) - shape.Volume(tol=1e-10)) < 1e-4
        )
        exports = {str(step.relative_to(ROOT)): hashlib.sha256(step.read_bytes()).hexdigest()}
        result = {
            "source_BRep": row["brep"],
            "source_sha256": row["sha256"],
            "material": row["material"],
            "bounds_mm": row["bounds_mm"],
            "STEP_native_valid_roundtrip": True,
            "STEP_volume_delta_mm3": native.Volume(tol=1e-10) - shape.Volume(tol=1e-10),
            "STEP_volume_tolerance_mm3": 1e-4,
        }
        # The CNC metal deck uses analytic STEP; the printable-prototype
        # mesh set belongs only to polymer parts.
        if name == "CASE__ALUMINIUM_BASE":
            result["STL_status"] = (
                "Not published: CNC metal deck uses analytic STEP; STL set is for polymer prototypes."
            )
        else:
            assert shape.exportStl(str(mesh), tolerance=0.05, angularTolerance=0.08, relative=False)
            reader = vtk.vtkSTLReader()
            reader.SetFileName(str(mesh))
            reader.MergingOn()
            reader.Update()
            edges = vtk.vtkFeatureEdges()
            edges.SetInputConnection(reader.GetOutputPort())
            edges.BoundaryEdgesOn()
            edges.NonManifoldEdgesOn()
            edges.FeatureEdgesOff()
            edges.ManifoldEdgesOff()
            edges.Update()
            assert edges.GetOutput().GetNumberOfCells() == 0, name
            result.update(
                STL_triangles=reader.GetOutput().GetNumberOfCells(),
                STL_boundary_or_nonmanifold_edges=0,
            )
            exports[str(mesh.relative_to(ROOT))] = hashlib.sha256(mesh.read_bytes()).hexdigest()
        rows[name] = {**result, "exports": exports}
    out = {
        "scope": __doc__,
        "input_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [report_path, Path(__file__)]
        },
        "parts": rows,
        "STL_linear_deflection_mm": 0.05,
        "STL_angular_deflection_rad": 0.08,
        "elapsed_seconds": perf_counter() - start,
        "fabrication_release": False,
    }
    (ROOT / "build/reports/compact-parts-export.json").write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps({"parts": len(rows), "seconds": out["elapsed_seconds"]}))


if __name__ == "__main__":
    main()
