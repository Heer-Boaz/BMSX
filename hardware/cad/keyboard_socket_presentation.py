"""Export an illustrative socket face separate from the mechanical occupancy.

The manufacturer drawing owns the 8 mm face and six-contact orientation.
Contact markers are graphical approximations; they do not model the actual
socket, its contacts, a mating plug or tolerance stack. CadQuery owns STEP
assembly import/export: https://github.com/CadQuery/cadquery/blob/master/tests/test_assembly.py
"""

import hashlib
import json
from pathlib import Path

import cadquery as cq

from geometry import bounds, box

ROOT = Path(__file__).resolve().parents[1]


def main():
    spec_path = ROOT / 'design/keyboard_socket_presentation.json'
    panel_path = ROOT / 'build/reports/keyboard-panel-candidate.json'
    assembly_path = ROOT / 'build/reports/compact-assembly.json'
    spec = json.loads(spec_path.read_text())
    panel = json.loads(panel_path.read_text())
    scene = json.loads(assembly_path.read_text())
    row = scene['physical_parts']['KEYBOARD__MD60S_MANUFACTURER_MAX_BODY_OCCUPANCY']
    body_path = ROOT / row['brep']
    assert hashlib.sha256(body_path.read_bytes()).hexdigest() == row['sha256']
    body = cq.Shape.importBrep(str(body_path))
    x, z = spec['face_centre_xz_mm']
    y0, y1 = spec['face_y_mm']
    radius = spec['nominal_aperture_diameter_mm'] / 2
    face = cq.Solid.makeCylinder(radius, y1 - y0, cq.Vector(x, y0, z), cq.Vector(0, 1, 0))
    face = face.cut(box(spec['notch_bounds_mm']))
    contact_size = spec['contact_indication_size_mm']
    markers = {}
    for number, (cx, cz) in spec['contact_centres_xz_mm'].items():
        sx, sy, sz = contact_size
        cy = spec['contact_indication_y_mm']
        marker = box([cx - sx / 2, cy, cz - sz / 2,
                      cx + sx / 2, cy + sy, cz + sz / 2])
        face = face.cut(box([cx - sx / 2, y0 - .01, cz - sz / 2,
                             cx + sx / 2, y1 + .01, cz + sz / 2]))
        markers[number] = marker
    assert face.isValid() and len(face.Solids()) == 1
    assert face.intersect(body).Volume() < 1e-7
    assert radius < panel['opening_diameter_mm'] / 2
    assert all(face.intersect(marker).Volume() < 1e-7 for marker in markers.values())

    model = cq.Assembly(name='BMSX_KEYBOARD_SOCKET_FACE_ILLUSTRATION')
    model.add(face, name='KEYBOARD_FACE_ILLUSTRATION', color=cq.Color(.12, .13, .14))
    for number, marker in markers.items():
        model.add(marker, name='CONTACT_INDICATION_' + number, color=cq.Color(.68, .69, .68))
    output = ROOT / 'build/exports/BMSX_KEYBOARD_SOCKET_FACE_ILLUSTRATION.step'
    model.export(str(output))
    restored = {name.rsplit('/', 1)[-1] for _, name, _, _ in cq.Assembly.importStep(str(output))}
    assert restored == {'KEYBOARD_FACE_ILLUSTRATION'} | {'CONTACT_INDICATION_' + n for n in markers}
    inputs = (Path(__file__), ROOT / 'cad/geometry.py', spec_path, panel_path, assembly_path, body_path)
    report = {
        'scope': spec['scope'],
        'input_sha256': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs},
        'face_bounds_mm': bounds(face),
        'body_intersection_mm3': face.intersect(body).Volume(),
        'contact_indications': list(markers),
        'step_names_match': True,
        'export_sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'interpretation': spec['interpretation'],
    }
    (ROOT / 'build/reports/keyboard-socket-face-illustration.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'contact_indications': len(markers), 'export': str(output)}))


if __name__ == '__main__':
    main()
