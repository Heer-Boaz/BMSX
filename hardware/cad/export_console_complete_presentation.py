"""Combine the seated reference console with illustrative rear socket faces.

This is a visual exchange, not a physical connector, fit or fabrication
qualification. The receiving-volume originals and both input STEPs remain
unchanged. STEP assembly exchange follows CadQuery's native assembly API:
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
    console_path = ROOT / 'build/exports/BMSX_CONSOLE_TWO_MSX_SKIRT_CARTRIDGES_CONCEPT.step'
    console_report_path = ROOT / 'build/reports/console-exchange-two-msx-skirt-cartridges.json'
    rear_path = ROOT / 'build/exports/BMSX_REAR_CONNECTOR_PRESENTATION.step'
    rear_report_path = ROOT / 'build/reports/rear-connector-presentation.json'
    rear_exchange_path = ROOT / 'build/reports/console-exchange-rear-presentation.json'
    appearance_path = ROOT / 'design/enclosure_appearance.json'
    style_path = ROOT / 'design/enclosure_styling.json'
    keyboard_path = ROOT / 'build/reports/keyboard-panel-candidate.json'
    console_report, rear_report, rear_exchange, appearance, style, keyboard = (
        json.loads(p.read_text()) for p in (console_report_path, rear_report_path,
            rear_exchange_path, appearance_path, style_path, keyboard_path)
    )
    assert hashlib.sha256(console_path.read_bytes()).hexdigest() == console_report['export_sha256']
    assert hashlib.sha256(rear_path.read_bytes()).hexdigest() == rear_report['output_sha256']
    assert rear_report['output_sha256'] == rear_exchange['input_sha256'][str(rear_path.relative_to(ROOT))]
    console = {name.rsplit('/', 1)[-1]: (shape.located(loc), color)
               for shape, name, loc, color in cq.Assembly.importStep(str(console_path))}
    rear = {name.rsplit('/', 1)[-1]: (shape.located(loc), color)
            for shape, name, loc, color in cq.Assembly.importStep(str(rear_path))}
    assert len(console) == console_report['named_bodies']
    assert rear.keys() == set(rear_report['part_names'])
    removed = set(rear_exchange['presentation_only_removed_envelopes'])
    assert removed <= console.keys()
    for name in removed:
        del console[name]
    assembly = cq.Assembly(name='BMSX_COMPLETE_CONSOLE_VISUAL_PRESENTATION')
    for name, (shape, color) in console.items():
        assembly.add(shape, name=name, color=color)
        if name in ('CASE__FIXED_BODY', 'CASE__REMOVABLE_LID'):
            paints = face_paints(name, shape, style)
            if name == 'CASE__FIXED_BODY':
                painted = {entry['face_index'] for entry in paints}
                b = keyboard['panel_lip_bounds_mm']
                for index, face in enumerate(shape.Faces()):
                    bb = bounds(face)
                    if index not in painted and all(bb[i] >= b[i] - 1e-6 and bb[i+3] <= b[i+3] + 1e-6 for i in range(3)):
                        paints.append({'face_index': index, 'appearance': 'fascia'})
            apply_native_colours(assembly, name, shape, paints, appearance)
    added = {}
    for name, (shape, _) in rear.items():
        ref = 'REAR_PRESENTATION__' + name
        assert ref not in console
        color = (.65, .68, .70) if name.startswith('DC_') else (.25, .29, .31)
        assembly.add(shape, name=ref, color=cq.Color(*color))
        added[ref] = shape
    output = ROOT / 'build/exports/BMSX_CONSOLE_COMPLETE_VISUAL_PRESENTATION.step'
    assembly.export(str(output))
    restored = {name.rsplit('/', 1)[-1]: shape.located(loc)
                for shape, name, loc, _ in cq.Assembly.importStep(str(output))}
    assert restored.keys() == console.keys() | added.keys()
    for name, expected in added.items():
        actual = restored[name]
        assert actual.isValid(), name
        assert max(abs(a - b) for a, b in zip(bounds(actual), bounds(expected), strict=True)) < 1e-5, name
        assert abs(actual.Volume() - expected.Volume()) < 1e-4, name
    inputs = (Path(__file__), ROOT / 'cad/geometry.py', ROOT / 'cad/enclosure_style.py',
              console_path, console_report_path, rear_path, rear_report_path,
              rear_exchange_path, appearance_path, style_path, keyboard_path)
    report = {
        'scope': __doc__,
        'input_sha256': {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                         for path in inputs},
        'removed_receiving_volumes_for_presentation_only': sorted(removed),
        'added_illustrative_faces': sorted(added),
        'named_bodies': len(restored),
        'new_face_roundtrip_bounds_and_volumes_checked': len(added),
        'rear_face_limitations': rear_report['limitations'],
        'console_source_scope': console_report['scope'],
        'export_sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'elapsed_seconds': perf_counter() - started,
    }
    (ROOT / 'build/reports/console-complete-visual-presentation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'named_bodies': len(restored), 'illustrative_faces': len(added),
                      'export': str(output), 'elapsed_seconds': report['elapsed_seconds']}))


if __name__ == '__main__':
    main()
