"""Build a nominal cable-plug concept around the existing pad-socket models.

The material body has nine empty channels; the actual spring contacts,
retention and cable are not modelled. The existing socket and its contacts are
unchanged. The two pose checks are geometric screens, not a tolerance,
insertion, contact-force or electrical qualification.
"""

import hashlib
import json
from pathlib import Path

import cadquery as cq
from geometry import box

ROOT = Path(__file__).resolve().parents[1]


def main():
    spec_path = ROOT / "design/pad_plug_concept.json"
    manifest_path = ROOT / "models/front/manifest.json"
    spec = json.loads(spec_path.read_text())
    manifest = json.loads(manifest_path.read_text())
    records = manifest["parts"]
    names = [spec["socket_reference"] + "_HOUSING_PROPOSAL"] + [
        spec["socket_reference"] + f"_CONTACT_{n}" for n in range(1, 10)
    ]
    sources = {}
    for name in names:
        entry = records[name]
        source = ROOT / entry["brep"]
        assert hashlib.sha256(source.read_bytes()).hexdigest() == entry["sha256"]
        sources[name] = cq.Shape.importBrep(str(source))

    socket = sources[names[0]]
    nose = box(spec["nose_bounds_mm"]).cut(box(spec["key_groove_bounds_mm"]))
    plug = box(spec["body_bounds_mm"]).fuse(nose)
    channel_positions = []
    y0, y1 = spec["channel_axis_y_mm"]
    for number, name in enumerate(names[1:], 1):
        bounds = sources[name].BoundingBox()
        x = (bounds.xmin + bounds.xmax) / 2
        z = bounds.zmax - (bounds.xmax - bounds.xmin) / 2
        channel_positions.append({"contact": number, "x_mm": x, "z_mm": z})
        channel = cq.Solid.makeCylinder(
            spec["contact_channel_radius_mm"], y1 - y0,
            cq.Vector(x, y0, z), cq.Vector(0, 1, 0),
        )
        plug = plug.cut(channel)
    assert plug.isValid() and len(plug.Solids()) == 1
    contacts = {name: plug.intersect(sources[name]).Volume() for name in names[1:]}
    housing = plug.intersect(socket).Volume()
    axis_start, axis_end = spec["rotation_axis_mm"]
    upside_down = plug.rotate(tuple(axis_start), tuple(axis_end), 180)
    reversed_housing = upside_down.intersect(socket).Volume()
    assert housing < 1e-5 and all(v < 1e-5 for v in contacts.values())
    assert reversed_housing > 1e-5
    insertion_samples = []
    for offset in (-5.0, -2.5, 0.0):
        moved = plug.translate((0, offset, 0))
        volumes = [moved.intersect(sources[name]).Volume() for name in names]
        insertion_samples.append({"offset_y_mm": offset, "intersections_mm3": volumes})
        assert all(v < 1e-5 for v in volumes)

    assembly = cq.Assembly(name="BMSX_PAD_PLUG_NOMINAL_CONCEPT")
    assembly.add(socket, name="SOCKET_BODY", color=cq.Color(0.15, 0.17, 0.18))
    for number, name in enumerate(names[1:], 1):
        assembly.add(sources[name], name=f"SOCKET_CONTACT_{number}", color=cq.Color(0.72, 0.58, 0.28))
    assembly.add(plug, name="PLUG_BODY_EMPTY_CHANNELS", color=cq.Color(0.37, 0.40, 0.42))
    output = ROOT / "build/exports/BMSX_PAD_PLUG_NOMINAL_CONCEPT.step"
    output.parent.mkdir(parents=True, exist_ok=True)
    assembly.export(str(output))
    restored = {name.rsplit("/", 1)[-1] for _, name, _, _ in cq.Assembly.importStep(str(output))}
    expected = {"SOCKET_BODY", "PLUG_BODY_EMPTY_CHANNELS"} | {f"SOCKET_CONTACT_{n}" for n in range(1, 10)}
    assert restored == expected
    report = {
        "scope": __doc__,
        "source_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (Path(__file__), ROOT / "cad/geometry.py", spec_path, manifest_path)
        },
        "source_parts_sha256": {name: records[name]["sha256"] for name in names},
        "output_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "channel_positions": channel_positions,
        "seated_socket_body_intersection_mm3": housing,
        "seated_contact_intersections_mm3": contacts,
        "upside_down_socket_body_intersection_mm3": reversed_housing,
        "insertion_pose_samples": insertion_samples,
        "step_names_match": True,
        "limitations": [
            "Nominal rigid bodies at three insertion positions and a 180-degree inverted pose only",
            "Channels are empty; spring contacts, retention and cable are not modelled",
            "Sampled positions do not prove continuous insertion, tolerances, wear, electrical or manufacturing performance",
        ],
    }
    (ROOT / "build/reports/pad-plug-concept.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"seated_overlap_mm3": housing, "inverted_overlap_mm3": reversed_housing, "contacts": len(contacts), "export": str(output)}))


if __name__ == "__main__":
    main()
