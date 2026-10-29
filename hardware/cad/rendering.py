"""Shared CadQuery tessellation into reusable native VTK polydata."""

import numpy as np
import vtk
from vtk.util.numpy_support import numpy_to_vtk, numpy_to_vtkIdTypeArray


def shape_polydata(shape, linear_mm, angular_rad):
    vertices, triangles = shape.tessellate(linear_mm, angular_rad)
    xyz = np.array([v.toTuple() for v in vertices], dtype=np.float64)
    faces = np.asarray(triangles, dtype=np.int64)
    points = vtk.vtkPoints()
    points.SetData(numpy_to_vtk(xyz, deep=True))
    cells = vtk.vtkCellArray()
    offsets = np.arange(0, faces.size + 1, 3, dtype=np.int64)
    cells.SetData(
        numpy_to_vtkIdTypeArray(offsets, deep=True),
        numpy_to_vtkIdTypeArray(faces.ravel(), deep=True),
    )
    mesh = vtk.vtkPolyData()
    mesh.SetPoints(points)
    mesh.SetPolys(cells)
    return mesh
