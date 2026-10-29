"""A low-profile passive spreader based on the retained cooling assembly.

This alternative keeps the represented package pads, posts and fasteners. It
replaces the tall receiving envelope with the lower continuous base only; it
is not a manufacturer part, thermal prediction or manufacturing design.
CadQuery assemblies retain separate component bodies:
https://github.com/CadQuery/cadquery/blob/master/cadquery/assembly.py
"""

import hashlib
import json
from pathlib import Path

import cadquery as cq
from geometry import box

ROOT = Path(__file__).resolve().parents[1]


def main():
    report_path = ROOT / "build/reports/compact-cooling.json"
    design_path = ROOT / "design/enclosure_cooling.json"
    report = json.loads(report_path.read_text())
    design = json.loads(design_path.read_text())
    rows = report["physical_parts"]
    shapes = {}
    for name, entry in rows.items():
        source = ROOT / entry["brep"]
        assert hashlib.sha256(source.read_bytes()).hexdigest() == entry["sha256"]
        shapes[name] = cq.Shape.importBrep(str(source))

    name = "COOLING__SK50875_MACHINED_RECEIVING"
    envelope = shapes.pop(name)
    x0, y0, z0, x1, y1, _ = design["sink"]["receiving_bounds_mm"]
    thickness = design["sink"]["continuous_base_thickness_mm"]
    plate = envelope.intersect(box([x0, y0, z0, x1, y1, z0 + thickness]))
    assert plate.isValid() and len(plate.Solids()) == 1
    assert plate.cut(envelope).Volume() < 1e-5
    for pad in ("COOLING__TIM_U1", "COOLING__TIM_U2"):
        assert plate.distance(shapes[pad]) < 1e-6
    shapes["COOLING__LOW_PROFILE_SPREADER_CONCEPT"] = plate

    assembly = cq.Assembly(name="BMSX_LOW_PROFILE_PASSIVE_SPREADER_CONCEPT")
    for part, shape in shapes.items():
        assembly.add(shape, name=part)
    target = ROOT / "build/exports/BMSX_PASSIVE_SPREADER_CONCEPT.step"
    target.parent.mkdir(parents=True, exist_ok=True)
    assembly.export(str(target))
    restored = {n.rsplit("/", 1)[-1] for _, n, _, _ in cq.Assembly.importStep(str(target))}
    assert restored == shapes.keys()
    summary = {
        "scope": __doc__,
        "inputs_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (Path(__file__), report_path, design_path)
        },
        "source_breps_sha256": {name: row["sha256"] for name, row in rows.items()},
        "output_sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "plate_bounds_mm": [x0, y0, z0, x1, y1, z0 + thickness],
        "contact_pad_names": ["COOLING__TIM_U1", "COOLING__TIM_U2"],
        "inside_retained_envelope": True,
        "nominal_pad_contact": True,
        "step_names_match": True,
        "limitations": [
            "Illustrative passive alternative only; no thermal or surface-temperature guarantee",
            "Exact thermal interfaces, mounting pressure, material and electrical bonding remain choices",
            "Full enclosure and manufacturing fit are not established by this alternative model",
        ],
    }
    (ROOT / "build/reports/passive-spreader-candidate.json").write_text(
        json.dumps(summary, indent=2) + "\n"
    )
    print(json.dumps({"plate_mm": [x1-x0, y1-y0, thickness], "pads": 2, "export": str(target)}))


if __name__ == "__main__":
    main()
