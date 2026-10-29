"""MSX-inspired appearance variant of the retained BMSX cartridge bank.

The existing shell and cover remain the constructive starting point. Shallow
label and grip details remove material only from the exposed front; connector,
seating, polarity channels and the other parts remain unchanged. This is a
nominal industrial-design study, not a manufacturing or wear qualification.
"""

import hashlib
import json
from pathlib import Path

import cadquery as cq

ROOT = Path(__file__).resolve().parents[1]


def main():
    source_report = json.loads((ROOT / "build/reports/compact-cartridge-bank.json").read_text())
    appearance = json.loads((ROOT / "design/enclosure_appearance.json").read_text())
    palette = {
        "SOCKET": (0.19, 0.20, 0.21),
        "SHELL": appearance["palette"]["cartridge_body"],
        "COVER": appearance["palette"]["cartridge_body"],
        "PCB": (0.12, 0.37, 0.23),
        "FINGERS": (0.78, 0.61, 0.18),
        "ROMS": (0.12, 0.12, 0.13),
    }
    output = ROOT / "build/cad/msx_cartridge_candidate"
    output.mkdir(parents=True, exist_ok=True)
    assembly = cq.Assembly(name="BMSX_MSX_STYLE_CARTRIDGE_CANDIDATE")
    hashes = {}
    rows = []
    for item in source_report["parts"]:
        path = ROOT / item["brep"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"]
        shape = cq.Shape.importBrep(str(path))
        original = shape
        if item["role"] == "SHELL":
            # The broad label field has a 1.5 mm corner radius and is inset
            # 0.25 mm. Both fine horizontal grips are shallow molded details.
            y = 30 * item["slot"]
            label = (
                cq.Workplane("XY")
                .box(88, 0.35, 57)
                .edges("|Y")
                .fillet(1.5)
                .translate((0, y - 8.925, 71.5))
                .val()
            )
            shape = shape.cut(label)
            for z in (102.6, 105.0):
                detail = cq.Solid.makeBox(92, 0.35, 0.65, cq.Vector(-46, y - 9.1, z))
                shape = shape.cut(detail)
            assert shape.isValid() and len(shape.Solids()) == 1
            assert shape.Volume() < original.Volume()
        b = shape.BoundingBox()
        bounds = [b.xmin, b.ymin, b.zmin, b.xmax, b.ymax, b.zmax]
        assert max(abs(a - b) for a, b in zip(bounds, item["bounds_mm"], strict=True)) < 1e-6
        out = output / f"{item['name']}.brep"
        assert shape.exportBrep(str(out))
        hashes[str(out.relative_to(ROOT))] = hashlib.sha256(out.read_bytes()).hexdigest()
        rows.append(
            {
                "name": item["name"],
                "role": item["role"],
                "slot": item["slot"],
                "bounds_mm": bounds,
                "volume_mm3": shape.Volume(),
                "removed_mm3": original.Volume() - shape.Volume(),
            }
        )
        assembly.add(shape, name=item["name"], color=cq.Color(*palette[item["role"]]))
    export = ROOT / "build/exports/BMSX_MSX_STYLE_cartridge_bank.step"
    assembly.export(str(export))
    restored = {
        n.rsplit("/", 1)[-1]: shape.located(loc)
        for shape, n, loc, color in cq.Assembly.importStep(str(export))
    }
    assert restored.keys() == {item["name"] for item in rows}
    assert all(shape.isValid() for shape in restored.values())
    hashes[str(export.relative_to(ROOT))] = hashlib.sha256(export.read_bytes()).hexdigest()
    report = {
        "scope": __doc__,
        "parts": rows,
        "output_sha256": hashes,
        "label_recess_mm": {"width": 88, "height": 57, "corner_radius": 1.5, "depth": 0.25},
        "not_proven": [
            "shell wall-strength and manufacturability",
            "insertion, extraction and flap motion with tolerances",
            "actual MSX compatibility",
        ],
        "fabrication_release": False,
    }
    (ROOT / "build/reports/msx-cartridge-candidate.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )
    print(
        json.dumps(
            {
                "export": str(export.relative_to(ROOT)),
                "styled_shells": 2,
                "nominal_bounds_preserved": True,
                "assembly_roundtrip_names_and_validity": True,
            }
        )
    )


if __name__ == "__main__":
    main()
