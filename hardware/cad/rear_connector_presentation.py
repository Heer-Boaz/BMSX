"""Export visual-only SCART and DC connector faces at the console rear datums.

The named native assembly follows CadQuery's documented assembly API:
https://cadquery.readthedocs.io/en/latest/assy.html
These shapes do not replace the manufacturer occupancy allocations.
"""

import hashlib
import json
from pathlib import Path

import cadquery as cq

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / "design/rear_connector_presentation.json"
spec = json.loads(source.read_text())
s = spec["scart"]
x = s["body_centre_X_mm"]
y = s["face_Y_mm"]
z = s["body_bottom_Z_mm"]
left = x - s["face_left_of_centre_mm"]
right = x + s["face_right_of_centre_mm"]
h = s["body_height_mm"]
slope = s["illustrative_profile_slope_mm"]
inset = s["illustrative_opening_inset_mm"]
outline = [(left, z), (right - slope, z), (right, z + h), (left, z + h)]
opening = [(left + inset, z + inset), (right - slope - inset, z + inset),
           (right - inset, z + h - inset), (left + inset, z + h - inset)]
body = cq.Workplane("XZ", origin=(0, y, 0)).polyline(outline).close().extrude(s["body_depth_mm"]).val()
cavity = cq.Workplane("XZ", origin=(0, y + 0.1, 0)).polyline(opening).close().extrude(s["illustrative_opening_depth_mm"] + 0.1).val()
scart = body.cut(cavity)

d = spec["dc"]
dx, dz = d["centre_XZ_mm"]
dy = d["illustrative_face_Y_mm"]
depth = d["illustrative_body_depth_mm"]
outer = cq.Solid.makeCylinder(d["bushing_diameter_mm"] / 2, depth, cq.Vector(dx, dy, dz), cq.Vector(0, -1, 0))
bore = cq.Solid.makeCylinder(d["illustrative_mating_diameter_mm"] / 2, depth + 0.1, cq.Vector(dx, dy + 0.1, dz), cq.Vector(0, -1, 0))
dc = outer.cut(bore)
pin = cq.Solid.makeCylinder(d["centre_pin_diameter_mm"] / 2, d["illustrative_pin_depth_mm"], cq.Vector(dx, dy - 0.5, dz), cq.Vector(0, -1, 0))

assert all(shape.isValid() and shape.Volume() > 0 for shape in (scart, dc, pin))
assembly = cq.Assembly(name="BMSX_REAR_CONNECTOR_PRESENTATION")
assembly.add(scart, name="SCART_ILLUSTRATIVE_FACE", color=cq.Color(0.14, 0.16, 0.17))
assembly.add(dc, name="DC_ILLUSTRATIVE_BUSHING", color=cq.Color(0.65, 0.68, 0.7))
assembly.add(pin, name="DC_ILLUSTRATIVE_CENTRE_PIN", color=cq.Color(0.65, 0.68, 0.7))
target = ROOT / "build/exports/BMSX_REAR_CONNECTOR_PRESENTATION.step"
assembly.save(str(target))
report = {
    "scope": spec["scope"],
    "limitations": spec["limitations"],
    "input_sha256": {str(source.relative_to(ROOT)): hashlib.sha256(source.read_bytes()).hexdigest(),
                     "cad/rear_connector_presentation.py": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},
    "output_sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
    "part_names": ["SCART_ILLUSTRATIVE_FACE", "DC_ILLUSTRATIVE_BUSHING", "DC_ILLUSTRATIVE_CENTRE_PIN"],
}
(ROOT / "build/reports/rear-connector-presentation.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
