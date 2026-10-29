"""Export the frame-channel console with both candidate cartridges seated.

The empty console, the cartridge skirt candidate and the door owner remain
unchanged. This exchange uses existing nominal geometry; it is not a complete
assembly, tolerance, insertion, thermal or manufacturing qualification.
CadQuery owns the native STEP assembly roundtrip:
https://github.com/CadQuery/cadquery/blob/master/tests/test_assembly.py
"""
import argparse
import hashlib
import json
from pathlib import Path
from time import perf_counter

import cadquery as cq

from enclosure_style import apply_native_colours, face_paints
from geometry import bounds

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--msx-style', action='store_true',
                        help='Use the separate MSX-style protective-skirt cartridge candidate')
    args = parser.parse_args()
    started = perf_counter()
    console_path = ROOT / 'build/exports/BMSX_COMPACT_PROTECTIVE_SKIRT_FRAME_console.step'
    console_report_path = ROOT / 'build/reports/console-exchange-protective-skirt-frame.json'
    cartridge_path = ROOT / ('build/exports/BMSX_CARTRIDGE_MSX_SKIRT_CONCEPT.step' if args.msx_style
                             else 'build/exports/BMSX_CARTRIDGE_PROTECTIVE_SKIRT_CONCEPT.step')
    cartridge_report_path = ROOT / ('build/reports/cartridge-msx-skirt-concept.json' if args.msx_style
                                    else 'build/reports/cartridge-protective-skirt-concept.json')
    flap_report_path = ROOT / 'build/reports/compact-cartridge-flaps.json'
    hinge_path = ROOT / 'design/cartridge_flaps.json'
    appearance_path = ROOT / 'design/enclosure_appearance.json'
    style_path = ROOT / 'design/enclosure_styling.json'
    keyboard_report_path = ROOT / 'build/reports/keyboard-panel-candidate.json'
    console_report, cartridge_report, flap_report, hinges, appearance, style, keyboard = (
        json.loads(path.read_text()) for path in
        (console_report_path, cartridge_report_path, flap_report_path, hinge_path,
         appearance_path, style_path, keyboard_report_path)
    )
    assert hashlib.sha256(console_path.read_bytes()).hexdigest() == console_report['export_sha256']
    assert hashlib.sha256(cartridge_path.read_bytes()).hexdigest() == cartridge_report['export_sha256']
    assert hashlib.sha256(flap_report_path.read_bytes()).hexdigest() == cartridge_report['input_sha256'][str(flap_report_path.relative_to(ROOT))]
    assert hashlib.sha256(hinge_path.read_bytes()).hexdigest() == cartridge_report['input_sha256'][str(hinge_path.relative_to(ROOT))]
    inputs = [Path(__file__), ROOT / 'cad/geometry.py', ROOT / 'cad/enclosure_style.py',
              console_path, console_report_path, cartridge_path, cartridge_report_path,
              flap_report_path, hinge_path, appearance_path, style_path, keyboard_report_path]
    console = {name.rsplit('/', 1)[-1]: (shape.located(loc), color)
               for shape, name, loc, color in cq.Assembly.importStep(str(console_path))}
    cartridge = {name.rsplit('/', 1)[-1]: (shape.located(loc), color)
                 for shape, name, loc, color in cq.Assembly.importStep(str(cartridge_path))}
    assert len(console) == console_report['named_bodies']
    assert {'BANK__SLOT0__SOCKET', 'BANK__SLOT1__SOCKET', 'COMPACT_FRAME_METAL'} <= console.keys()
    assert abs(console['COMPACT_FRAME_METAL'][0].Volume() - cartridge['FRAME_WITH_CHANNELS'][0].Volume()) < 1e-4

    # The recorded seated state opens slot 0 only. Verify that the two closed
    # native parts actually are translated copies before applying the same
    # translation to the slot-0 seated spring and leaf for slot 1.
    shift = (0, hinges['hinge_axes'][1][0] - hinges['hinge_axes'][0][0],
             hinges['hinge_axes'][1][1] - hinges['hinge_axes'][0][1])
    replacement = {}
    for role in ('LEAF', 'TORSION_SPRING_PROPOSAL'):
        closed = []
        for slot in range(2):
            row = flap_report['states']['closed']['parts'][f'FLAP__SLOT{slot}__{role}']
            path = ROOT / row['brep']
            assert hashlib.sha256(path.read_bytes()).hexdigest() == row['sha256']
            inputs.append(path)
            closed.append(cq.Shape.importBrep(str(path)))
        translated = closed[0].translate(shift)
        assert translated.cut(closed[1]).Volume() < 1e-6
        assert closed[1].cut(translated).Volume() < 1e-6
        row = flap_report['states']['seated']['parts'][f'FLAP__SLOT0__{role}']
        path = ROOT / row['brep']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row['sha256']
        inputs.append(path)
        seated = cq.Shape.importBrep(str(path))
        replacement[f'FLAP__SLOT0__{role}'] = seated
        replacement[f'FLAP__SLOT1__{role}'] = seated.translate(shift)
    assert replacement.keys() <= console.keys()
    for slot in range(2):
        leaf = replacement[f'FLAP__SLOT{slot}__LEAF']
        source_leaf = cartridge[f'SLOT{slot}__LEAF_SEATED'][0]
        assert leaf.cut(source_leaf).Volume() < 1e-6 and source_leaf.cut(leaf).Volume() < 1e-6
        for role in ('PCB', 'FINGERS'):
            assert leaf.distance(cartridge[f'SLOT{slot}__{role}'][0]) > 0

    assembly = cq.Assembly(name=('BMSX_CONSOLE_TWO_MSX_SKIRT_CARTRIDGES_CONCEPT' if args.msx_style
                                 else 'BMSX_CONSOLE_TWO_CARTRIDGES_SKIRT_CONCEPT'))
    for name, (shape, color) in console.items():
        shape = replacement[name] if name in replacement else shape
        assembly.add(shape, name=name, color=color)
        if name in ('CASE__FIXED_BODY', 'CASE__REMOVABLE_LID'):
            paints = face_paints(name, shape, style)
            if name == 'CASE__FIXED_BODY':
                painted = {row['face_index'] for row in paints}
                b = keyboard['panel_lip_bounds_mm']
                for index, face in enumerate(shape.Faces()):
                    bb = bounds(face)
                    if index not in painted and all(bb[i] >= b[i] - 1e-6 and bb[i+3] <= b[i+3] + 1e-6 for i in range(3)):
                        paints.append({'face_index': index, 'appearance': 'fascia'})
            apply_native_colours(assembly, name, shape, paints, appearance)
    added = {}
    for slot in range(2):
        for role in ('SHELL', 'COVER', 'PCB', 'FINGERS', 'ROMS'):
            shape, color = cartridge[f'SLOT{slot}__{role}']
            name = f'CARTRIDGE__SLOT{slot}__{role}'
            assert name not in console
            added[name] = shape
            assembly.add(shape, name=name, color=color)

    output = ROOT / ('build/exports/BMSX_CONSOLE_TWO_MSX_SKIRT_CARTRIDGES_CONCEPT.step' if args.msx_style
                     else 'build/exports/BMSX_CONSOLE_TWO_CARTRIDGES_SKIRT_CONCEPT.step')
    assembly.export(str(output))
    restored = {name.rsplit('/', 1)[-1]: shape.located(loc)
                for shape, name, loc, _ in cq.Assembly.importStep(str(output))}
    assert restored.keys() == console.keys() | added.keys()
    for name, expected in (replacement | added).items():
        actual = restored[name]
        assert actual.isValid(), name
        assert max(abs(a - b) for a, b in zip(bounds(actual), bounds(expected), strict=True)) < 1e-5, name
        assert abs(actual.Volume() - expected.Volume()) < 1e-4, name
    result = {
        'scope': __doc__,
        'cartridge_style': cartridge_report['shell_style'] if args.msx_style else 'retained cartridge bank',
        'input_sha256': {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                         for path in dict.fromkeys(inputs)},
        'replacement': sorted(replacement),
        'added': sorted(added),
        'retained_console_socket_count': 2,
        'slot1_seated_leaf_and_spring_translation_mm': list(shift),
        'both_closed_leaves_and_springs_verified_as_translated_solids': True,
        'seated_leaf_to_pcb_mm': [replacement[f'FLAP__SLOT{slot}__LEAF'].distance(cartridge[f'SLOT{slot}__PCB'][0]) for slot in range(2)],
        'seated_leaf_to_fingers_mm': [replacement[f'FLAP__SLOT{slot}__LEAF'].distance(cartridge[f'SLOT{slot}__FINGERS'][0]) for slot in range(2)],
        'named_bodies': len(restored),
        'new_and_replaced_shapes_checked': len(replacement) + len(added),
        'export_sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'elapsed_seconds': perf_counter() - started,
    }
    report_path = ROOT / ('build/reports/console-exchange-two-msx-skirt-cartridges.json' if args.msx_style
                          else 'build/reports/console-exchange-two-cartridges-skirt.json')
    report_path.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
