"""Export a separate keyboard front-wall proposal against the retained assembly.

CadQuery named assemblies and STEP export follow the upstream assembly owner:
https://github.com/CadQuery/cadquery/blob/master/cadquery/assembly.py
The connector is its original maximum occupied envelope, not a hollow model.
"""

import hashlib
import json
from pathlib import Path

import cadquery as cq
from geometry import bounds, box

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    inputs = [ROOT / 'design/keyboard_panel_candidate.json',
              ROOT / 'build/reports/compact-assembly.json',
              Path(__file__).resolve(), ROOT / 'cad/geometry.py']
    spec = json.loads(inputs[0].read_text())
    assembly = json.loads(inputs[1].read_text())
    names = ['CASE__FIXED_BODY', 'KEYBOARD__MD60S_MANUFACTURER_MAX_BODY_OCCUPANCY',
             'KEYBOARD__KEYBOARD_NATIVE_DRILLED_BOARD', 'KEYBOARD_FRONT_CRADLE']
    shapes = {}
    for name in names:
        record = assembly['physical_parts'][name]
        path = ROOT / record['brep']
        assert digest(path) == record['sha256']
        inputs.append(path)
        shapes[name] = cq.Shape.importBrep(str(path))

    x, z = spec['opening_axis_XZ_mm']
    b = spec['front_lip_bounds_mm']
    opening = cq.Solid.makeCylinder(spec['opening_diameter_mm'] / 2,
                                    b[4] - b[1] + 0.2,
                                    cq.Vector(x, b[1] - 0.1, z), cq.Vector(0, 1, 0))
    lip = box(b).cut(opening)
    # The shoulder sweep covers the added front lip only; the body envelope
    # cannot represent the connector's hollow mouth or prove electrical mating.
    shoulder = cq.Solid.makeCylinder(spec['plug_shoulder_clearance_model_diameter_mm'] / 2,
                                     b[4] - b[1], cq.Vector(x, b[1], z), cq.Vector(0, 1, 0))
    shoulder_overlap = lip.intersect(shoulder).Volume()
    connector_overlap = lip.intersect(shapes[names[1]]).Volume()
    assert shoulder_overlap < 1e-6 and connector_overlap < 1e-6
    revised_case = shapes[names[0]].fuse(lip)
    assert revised_case.isValid()
    assert len(revised_case.Solids()) == 1
    assert abs(revised_case.Volume() - shapes[names[0]].Volume() - lip.Volume()) < 0.005
    model = cq.Assembly(name='BMSX_KEYBOARD_PANEL_CANDIDATE')
    model.add(revised_case, name='CASE__FIXED_BODY_WITH_KEYBOARD_LIP', color=cq.Color(0.8, 0.79, 0.75))
    model.add(shapes[names[1]], name=names[1], color=cq.Color(0.3, 0.3, 0.3))
    model.add(shapes[names[2]], name=names[2], color=cq.Color(0.15, 0.38, 0.27))
    model.add(shapes[names[3]], name=names[3], color=cq.Color(0.22, 0.22, 0.22))
    out = ROOT / 'build/exports/BMSX_KEYBOARD_PANEL_CANDIDATE.step'
    out.parent.mkdir(parents=True, exist_ok=True)
    model.save(str(out))
    report = {
        'scope': spec['scope'], 'limitations': spec['limitations'],
        'input_sha256': {str(p.relative_to(ROOT)): digest(p) for p in inputs},
        'export_sha256': digest(out), 'panel_lip_bounds_mm': bounds(lip),
        'opening_diameter_mm': spec['opening_diameter_mm'],
        'shoulder_clearance_model_diameter_mm': spec['plug_shoulder_clearance_model_diameter_mm'],
        'lip_shoulder_intersection_mm3': shoulder_overlap,
        'lip_connector_envelope_intersection_mm3': connector_overlap,
        'case_is_valid': revised_case.isValid(),
        'case_solid_count': len(revised_case.Solids()),
        'note': 'The case is the retained reference body with an added lip. No other assembly, plug or mating-surface clearance is verified.'
    }
    output = ROOT / 'build/reports/keyboard-panel-candidate.json'
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
