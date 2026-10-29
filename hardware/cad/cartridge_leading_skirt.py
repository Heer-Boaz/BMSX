"""Build a separate cartridge-leading-skirt and frame-channel concept.

The original cartridge, frame, connector and board are retained as inputs.
The candidate is a nominal assembly and a focused rigid-pose screen, not a
continuous insertion, tolerancing, strength or manufacturing qualification.
CadQuery native solids and assembly STEP export follow the existing cartridge
bank owner and CadQuery's public assembly API:
https://github.com/CadQuery/cadquery/blob/master/tests/test_assembly.py
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import cadquery as cq

from geometry import box, bounds

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--msx-style', action='store_true',
                        help='Apply the protective skirt to the retained MSX-style shell candidate')
    args = parser.parse_args()
    plan_path = ROOT / 'design/cartridge_leading_skirt.json'
    bank_path = ROOT / 'build/reports/compact-cartridge-bank.json'
    scene_path = ROOT / 'build/reports/compact-assembly.json'
    flap_path = ROOT / 'build/reports/compact-cartridge-flaps.json'
    board_path = ROOT / 'build/reports/mainboard.json'
    hinge_path = ROOT / 'design/cartridge_flaps.json'
    plan, bank, scene, flaps, board, hinges = (
        json.loads(p.read_text()) for p in
        (plan_path, bank_path, scene_path, flap_path, board_path, hinge_path)
    )
    inputs = [Path(__file__), ROOT / 'cad/geometry.py', plan_path, bank_path,
              scene_path, flap_path, board_path, hinge_path]
    if args.msx_style:
        style_path = ROOT / 'build/reports/msx-cartridge-candidate.json'
        style = json.loads(style_path.read_text())
        inputs.append(style_path)
    frame_row = scene['physical_parts']['COMPACT_FRAME_METAL']
    frame_path = ROOT / frame_row['brep']
    assert hashlib.sha256(frame_path.read_bytes()).hexdigest() == frame_row['sha256']
    inputs.append(frame_path)
    frame = cq.Shape.importBrep(str(frame_path))
    original_frame_volume = frame.Volume()
    case_parts = {}
    for name in ('CASE__FIXED_BODY', 'CASE__REMOVABLE_LID'):
        row = scene['physical_parts'][name]
        path = ROOT / row['brep']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row['sha256'], name
        inputs.append(path)
        case_parts[name] = cq.Shape.importBrep(str(path))
    centres = [next(p['position_mm'] for p in board['placements'] if p['ref'] == f'J_CART{slot}')
               for slot in range(2)]
    anchor = centres[0]
    channels, skirts = [], []
    for x, y in centres:
        translate = (x, y, 0)
        channel = box(plan['frame_channel_bounds']).translate(translate)
        skirt = box(plan['skirt_bounds']).translate(translate)
        frame = frame.cut(channel)
        channels.append(channel)
        skirts.append(skirt)
    assert frame.isValid() and len(frame.Solids()) == 1

    assembly = cq.Assembly(name='BMSX_CARTRIDGE_SKIRT_CONCEPT')
    assembly.add(frame, name='FRAME_WITH_CHANNELS', color=cq.Color(.62, .64, .66))
    samples, slot_results = [], []
    colors = {'SOCKET': (.18, .19, .20), 'PCB': (.10, .36, .22),
              'FINGERS': (.76, .59, .20), 'SHELL': (.18, .19, .21),
              'COVER': (.18, .19, .21), 'ROMS': (.10, .10, .10)}
    for slot in range(2):
        cards = {}
        for row in bank['parts']:
            if row['slot'] != slot:
                continue
            if args.msx_style and row['role'] == 'SHELL':
                path = ROOT / 'build/cad/msx_cartridge_candidate' / (row['name'] + '.brep')
                assert hashlib.sha256(path.read_bytes()).hexdigest() == style['output_sha256'][str(path.relative_to(ROOT))]
            else:
                path = ROOT / row['brep']
                assert hashlib.sha256(path.read_bytes()).hexdigest() == row['sha256']
            inputs.append(path)
            cards[row['role']] = cq.Shape.importBrep(str(path)).translate((*anchor, 0))
        skirt = skirts[slot]
        shell = cards['SHELL'].fuse(skirt)
        assert shell.isValid() and len(shell.Solids()) == 1
        seated_checks = {
            role: {'intersection_mm3': skirt.intersect(cards[role]).Volume(),
                   'distance_mm': skirt.distance(cards[role])}
            for role in ('SOCKET', 'PCB', 'FINGERS', 'COVER', 'ROMS')
        }
        for result in seated_checks.values():
            assert result['intersection_mm3'] < 1e-7
        # The channel extends above the frame, so the entire vertical skirt
        # sweep through that frame can be checked in one exact intersection.
        sweep_bounds = bounds(skirt)
        sweep_bounds[5] = plan['frame_channel_bounds'][5]
        swept = box(sweep_bounds)
        frame_overlap = swept.intersect(frame).Volume()
        assert frame_overlap < 1e-7
        # The straight swept volume extends past the top of each retained case
        # part; it does not model the moving flap or an off-axis insertion.
        case_sweep_bounds = bounds(skirt)
        case_sweep_bounds[5] = max(part.BoundingBox().zmax for part in case_parts.values())
        case_swept = box(case_sweep_bounds)
        case_overlaps = {name: case_swept.intersect(part).Volume()
                         for name, part in case_parts.items()}
        assert all(volume < 1e-7 for volume in case_overlaps.values())
        slot_results.append({
            'slot': slot, 'skirt_bounds_mm': bounds(skirt),
            'frame_channel_bounds_mm': bounds(channels[slot]),
            'seated_skirt_distances': seated_checks,
            'seated_frame_clearance_mm': skirt.distance(frame),
            'vertical_skirt_sweep_frame_intersection_mm3': frame_overlap,
            'vertical_skirt_sweep_retained_case_intersections_mm3': case_overlaps,
        })
        for role, shape in cards.items():
            assembly.add(shell if role == 'SHELL' else shape,
                         name=f'SLOT{slot}__{role}', color=cq.Color(*colors[role]))
        leaf_row = flaps['physical_parts'][f'FLAP__SLOT{slot}__LEAF']
        leaf_path = ROOT / leaf_row['brep']
        assert hashlib.sha256(leaf_path.read_bytes()).hexdigest() == leaf_row['sha256']
        inputs.append(leaf_path)
        leaf = cq.Shape.importBrep(str(leaf_path))
        hinge_y, hinge_z = hinges['hinge_axes'][slot]
        angles = plan['sample_angles_degrees'] + [flaps['states']['seated']['angle_degrees']]
        for angle in angles:
            theta = math.radians(angle)
            # Keep the skirt separate: the combined shell bounding box has a
            # fictitious low front corner and would produce the wrong lift.
            pieces = [skirt, *(shape for role, shape in cards.items() if role != 'SOCKET')]
            lift = max(0, *(hinge_z - (shape.BoundingBox().ymin - hinge_y) * math.tan(theta)
                            + .4 / math.cos(theta) - shape.BoundingBox().zmin
                            for shape in pieces))
            moved_leaf = leaf.rotate((0, hinge_y, hinge_z), (1, hinge_y, hinge_z), -angle)
            distances = {role: moved_leaf.distance(shape.translate((0, 0, lift)))
                         for role, shape in {'SKIRT': skirt, 'SHELL': cards['SHELL'],
                                             'PCB': cards['PCB'], 'FINGERS': cards['FINGERS']}.items()}
            assert distances['PCB'] > 0 and distances['FINGERS'] > 0
            samples.append({'slot': slot, 'angle_degrees': angle, 'cartridge_lift_mm': lift,
                            'leaf_distance_mm': distances})
        assembly.add(moved_leaf, name=f'SLOT{slot}__LEAF_SEATED', color=cq.Color(.28, .29, .31))

    output = ROOT / ('build/exports/BMSX_CARTRIDGE_MSX_SKIRT_CONCEPT.step' if args.msx_style
                     else 'build/exports/BMSX_CARTRIDGE_PROTECTIVE_SKIRT_CONCEPT.step')
    assembly.export(str(output))
    restored = {name.rsplit('/', 1)[-1] for _, name, _, _ in cq.Assembly.importStep(str(output))}
    expected = {'FRAME_WITH_CHANNELS'} | {
        f'SLOT{slot}__{role}' for slot in range(2)
        for role in (*colors, 'LEAF_SEATED')
    }
    assert restored == expected
    report = {
        'scope': __doc__, 'input_sha256': {
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in dict.fromkeys(inputs)},
        'shell_style': 'MSX-style appearance candidate' if args.msx_style else 'retained cartridge bank',
        'frame_original_volume_mm3': original_frame_volume,
        'frame_candidate_volume_mm3': frame.Volume(),
        'frame_solids': len(frame.Solids()), 'slots': slot_results,
        'insertion_samples': samples,
        'min_sampled_leaf_to_pcb_mm': min(s['leaf_distance_mm']['PCB'] for s in samples),
        'min_sampled_leaf_to_fingers_mm': min(s['leaf_distance_mm']['FINGERS'] for s in samples),
        'step_names_match': True, 'export_sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'limitations': plan['limitations'],
    }
    target = ROOT / ('build/reports/cartridge-msx-skirt-concept.json' if args.msx_style
                     else 'build/reports/cartridge-protective-skirt-concept.json')
    target.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'slots': len(slot_results), 'samples': len(samples),
                      'min_pcb_mm': report['min_sampled_leaf_to_pcb_mm'],
                      'min_fingers_mm': report['min_sampled_leaf_to_fingers_mm'],
                      'frame_solids': len(frame.Solids()), 'export': str(output)}))


if __name__ == '__main__':
    main()
