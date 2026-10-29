"""Add an illustrative keyboard face to the retained console presentation.

The existing cartridge/console presentation and keyboard occupancy are unchanged.
Front and rear connector faces are visual approximations, not manufacturer
CAD, working contacts, mating geometry or an assembly qualification.
CadQuery owns the native STEP roundtrip:
https://github.com/CadQuery/cadquery/blob/master/tests/test_assembly.py
"""
import hashlib
import json
from pathlib import Path
from time import perf_counter

import cadquery as cq

from enclosure_style import apply_native_colours, face_paints
from geometry import bounds

ROOT = Path(__file__).resolve().parents[1]


def main():
    started = perf_counter()
    console_path = ROOT / 'build/exports/BMSX_CONSOLE_COMPLETE_VISUAL_PRESENTATION.step'
    console_report_path = ROOT / 'build/reports/console-complete-visual-presentation.json'
    face_path = ROOT / 'build/exports/BMSX_KEYBOARD_SOCKET_FACE_ILLUSTRATION.step'
    face_report_path = ROOT / 'build/reports/keyboard-socket-face-illustration.json'
    appearance_path = ROOT / 'design/enclosure_appearance.json'
    style_path = ROOT / 'design/enclosure_styling.json'
    panel_path = ROOT / 'build/reports/keyboard-panel-candidate.json'
    console_report, face_report, appearance, style, panel = (
        json.loads(path.read_text()) for path in
        (console_report_path, face_report_path, appearance_path, style_path, panel_path)
    )
    assert hashlib.sha256(console_path.read_bytes()).hexdigest() == console_report['export_sha256']
    assert hashlib.sha256(face_path.read_bytes()).hexdigest() == face_report['export_sha256']
    console = {name.rsplit('/', 1)[-1]: (shape.located(loc), color)
               for shape, name, loc, color in cq.Assembly.importStep(str(console_path))}
    face = {name.rsplit('/', 1)[-1]: (shape.located(loc), color)
            for shape, name, loc, color in cq.Assembly.importStep(str(face_path))}
    assert len(console) == console_report['named_bodies']
    assert face.keys() == {'KEYBOARD_FACE_ILLUSTRATION'} | {
        'CONTACT_INDICATION_' + number for number in face_report['contact_indications']
    }
    targets = ('CASE__FIXED_BODY', 'KEYBOARD__MD60S_MANUFACTURER_MAX_BODY_OCCUPANCY',
               'KEYBOARD__KEYBOARD_NATIVE_DRILLED_BOARD')
    contact_volumes = {name: {target: shape.intersect(console[target][0]).Volume()
                              for target in targets}
                       for name, (shape, _) in face.items()}
    assert all(volume < 1e-7 for results in contact_volumes.values() for volume in results.values())

    assembly = cq.Assembly(name='BMSX_CONSOLE_ALL_FACES_VISUAL_PRESENTATION')
    for name, (shape, color) in console.items():
        assembly.add(shape, name=name, color=color)
        if name in ('CASE__FIXED_BODY', 'CASE__REMOVABLE_LID'):
            paints = face_paints(name, shape, style)
            if name == 'CASE__FIXED_BODY':
                painted = {entry['face_index'] for entry in paints}
                b = panel['panel_lip_bounds_mm']
                for index, item in enumerate(shape.Faces()):
                    bb = bounds(item)
                    if index not in painted and all(bb[i] >= b[i] - 1e-6 and bb[i+3] <= b[i+3] + 1e-6 for i in range(3)):
                        paints.append({'face_index': index, 'appearance': 'fascia'})
            apply_native_colours(assembly, name, shape, paints, appearance)
    added = {}
    for name, (shape, color) in face.items():
        ref = 'KEYBOARD_PRESENTATION__' + name
        assert ref not in console
        assembly.add(shape, name=ref, color=color)
        added[ref] = shape

    output = ROOT / 'build/exports/BMSX_CONSOLE_ALL_FACES_VISUAL_PRESENTATION.step'
    assembly.export(str(output))
    restored = {name.rsplit('/', 1)[-1]: shape.located(loc)
                for shape, name, loc, _ in cq.Assembly.importStep(str(output))}
    assert restored.keys() == console.keys() | added.keys()
    for name, expected in added.items():
        actual = restored[name]
        assert actual.isValid(), name
        assert max(abs(a-b) for a, b in zip(bounds(actual), bounds(expected), strict=True)) < 1e-5, name
        assert abs(actual.Volume() - expected.Volume()) < 1e-4, name
    inputs = (Path(__file__), ROOT / 'cad/geometry.py', ROOT / 'cad/enclosure_style.py',
              console_path, console_report_path, face_path, face_report_path,
              appearance_path, style_path, panel_path)
    report = {
        'scope': __doc__,
        'input_sha256': {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                         for path in inputs},
        'added_illustrative_keyboard_parts': sorted(added),
        'keyboard_face_to_retained_case_occupancy_board_intersections_mm3': contact_volumes,
        'named_bodies': len(restored),
        'new_face_roundtrip_bounds_and_volumes_checked': len(added),
        'keyboard_face_limitations': face_report['scope'],
        'keyboard_face_interpretation': face_report['interpretation'],
        'rear_face_limitations': console_report['rear_face_limitations'],
        'export_sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'elapsed_seconds': perf_counter() - started,
    }
    (ROOT / 'build/reports/console-all-faces-visual-presentation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'named_bodies': len(restored), 'keyboard_parts': len(added),
                      'export': str(output), 'elapsed_seconds': report['elapsed_seconds']}))


if __name__ == '__main__':
    main()
