"""Focused nominal placement screen for the retained passive console candidate.

The source of component positions is the native board/exchange report; the
screen uses its existing shape allocations. It is not a PCB DRC, a complete
assembly fit check, or a thermal or manufacturing qualification.
"""
import hashlib
import json
from pathlib import Path

import cadquery as cq

from geometry import bounds, box, overlaps

ROOT = Path(__file__).resolve().parents[1]


def main():
    inputs = [
        ROOT / 'build/reports/compact-assembly.json',
        ROOT / 'build/reports/console-exchange-passive-spreader-keyboard.json',
        ROOT / 'build/reports/mainboard.json',
        ROOT / 'build/reports/mainboard-passive-candidate.json',
        ROOT / 'build/reports/keyboard-panel-candidate.json',
        ROOT / 'build/reports/passive-spreader-candidate.json',
        Path(__file__), ROOT / 'cad/geometry.py',
    ]
    assembly, exchange, original, candidate, keyboard, cooling = (
        json.loads(path.read_text()) for path in inputs[:6]
    )
    for path in inputs[:6]:
        key = str(path.relative_to(ROOT))
        if key in exchange['input_sha256']:
            assert hashlib.sha256(path.read_bytes()).hexdigest() == exchange['input_sha256'][key], key
    # The retained placement report predates the pin-metadata correction.
    # Compare its exact native board with the current board without treating
    # the old report as a newly generated placement or assembly result.
    historical_board = ROOT / 'build/exports/BMSX_PASSIVE_CANDIDATE_before_pin_metadata.kicad_pcb'
    current_board = ROOT / candidate['board_source']
    assert hashlib.sha256(historical_board.read_bytes()).hexdigest() == candidate['source_sha256']
    metadata_fields = ('(pinfunction ', '(pintype ', '(property "Value" ')
    old_lines = [line for line in historical_board.read_text().splitlines()
                 if not line.strip().startswith(metadata_fields)]
    current_lines = [line for line in current_board.read_text().splitlines()
                     if not line.strip().startswith(metadata_fields)]
    assert old_lines == current_lines, 'candidate board changed beyond pin metadata and values'
    inputs.extend((historical_board, current_board))
    keyboard_step = ROOT / 'build/exports/BMSX_KEYBOARD_PANEL_CANDIDATE.step'
    cooling_step = ROOT / 'build/exports/BMSX_PASSIVE_SPREADER_CONCEPT.step'
    assert hashlib.sha256(keyboard_step.read_bytes()).hexdigest() == keyboard['export_sha256']
    assert hashlib.sha256(cooling_step.read_bytes()).hexdigest() == cooling['output_sha256']
    inputs.extend((keyboard_step, cooling_step))

    physical = assembly['physical_parts']
    rear_path = ROOT / 'build/reports/compact-rear-io.json'
    rear = json.loads(rear_path.read_text())
    inputs.append(rear_path)
    rear_record_counts = {}
    for section in ('physical_parts', 'receiving_spaces'):
        retained = {name: row for name, row in assembly[section].items()
                    if row['module'] == 'rear-io'}
        assert retained == rear[section], section
        rear_record_counts[section] = len(retained)
        for name, row in retained.items():
            path = ROOT / row['brep']
            assert hashlib.sha256(path.read_bytes()).hexdigest() == row['sha256'], name
            inputs.append(path)
    changed = exchange['candidate_components']
    old_places = {row['ref']: row for row in original['placements']}
    new_places = {row['ref']: row for row in candidate['placements']}
    model_cache = {}

    def original_shape(name):
        if name not in model_cache:
            row = physical[name]
            path = ROOT / row['brep']
            assert hashlib.sha256(path.read_bytes()).hexdigest() == row['sha256'], name
            inputs.append(path)
            model_cache[name] = cq.Shape.importBrep(str(path))
        return model_cache[name]

    def candidate_shape(ref):
        source = changed[ref]['representation_from']
        before, after = old_places[source], new_places[ref]
        assert before['rotation_degrees'] == after['rotation_degrees'], ref
        dx = after['position_mm'][0] - before['position_mm'][0]
        dy = after['position_mm'][1] - before['position_mm'][1]
        return original_shape('MAIN__' + source).translate((dx, dy, 0))

    case = next(shape.located(location) for shape, name, location, _ in
                cq.Assembly.importStep(str(keyboard_step))
                if name.rsplit('/', 1)[-1] == 'CASE__FIXED_BODY_WITH_KEYBOARD_LIP')
    cooler = {name.rsplit('/', 1)[-1]: shape.located(location)
              for shape, name, location, _ in cq.Assembly.importStep(str(cooling_step))}
    plate = cooler['COOLING__LOW_PROFILE_SPREADER_CONCEPT']
    posts = {name: cooler[name] for name in ('COOLING__LEFT_POST', 'COOLING__RIGHT_POST_BRIDGE')}

    # The retained scene already covers its original components. Replace only
    # the moved parts and remove the unused fan header in this candidate view.
    scene_bounds = {name: row['bounds_mm'] for name, row in physical.items()
                    if name != 'MAIN__J70'
                    and not (name.startswith('MAIN__') and name[6:] in changed)}
    scene_bounds['CASE__FIXED_BODY'] = bounds(case)
    scene_bounds.update({'MAIN__' + ref: row['bounds_mm'] for ref, row in changed.items()})
    pairs = set()
    for ref in changed:
        name = 'MAIN__' + ref
        for other, other_bounds in scene_bounds.items():
            if name != other and overlaps(scene_bounds[name], other_bounds):
                pairs.add(tuple(sorted((name, other))))

    # Two containing boxes discharge the 21 broadphase hits against the hollow
    # case in two intersections. Every candidate lies in exactly one box.
    case_groups = {'runtime': [], 'graphics': []}
    for ref, row in changed.items():
        case_groups['runtime' if row['bounds_mm'][0] < 100 else 'graphics'].append(row['bounds_mm'])
    group_volumes = {}
    for group, boxes in case_groups.items():
        envelope = [min(b[i] for b in boxes) for i in range(3)] + [max(b[i+3] for b in boxes) for i in range(3)]
        group_volumes[group] = case.intersect(box(envelope)).Volume()

    # The remaining bounding hits are tested as actual retained CAD shapes;
    # board-contact planes are therefore not treated as physical penetration.
    other_hits = {}
    for a, b in sorted(pairs):
        if 'CASE__FIXED_BODY' in (a, b):
            continue
        ref = a[6:] if a.startswith('MAIN__') and a[6:] in changed else b[6:]
        other = b if a == 'MAIN__' + ref else a
        other_shape = candidate_shape(other[6:]) if other.startswith('MAIN__') and other[6:] in changed else original_shape(other)
        other_hits[f'{ref} / {other}'] = candidate_shape(ref).intersect(other_shape).Volume()

    plate_bounds = bounds(plate)
    candidate_rear_edge = max(plate_bounds[4], *(row['bounds_mm'][4] for row in changed.values()))
    rear_clearance_y = {
        section: min(row['bounds_mm'][1] for row in rear[section].values()) - candidate_rear_edge
        for section in ('physical_parts', 'receiving_spaces')
    }
    plate_hits = [name for name, bb in scene_bounds.items()
                  if not name.startswith('COOLING') and overlaps(plate_bounds, bb)]
    plate_regions = [name for name, row in assembly['receiving_spaces'].items()
                     if overlaps(plate_bounds, row['bounds_mm'])]
    plate_case = plate.intersect(case).Volume()
    post_checks = {}
    for name, post in posts.items():
        post_bounds = bounds(post)
        targets = [(other, candidate_shape(other[6:]) if other[6:] in changed else original_shape(other))
                   for other, bb in scene_bounds.items()
                   if other.startswith('MAIN__') and overlaps(post_bounds, bb)]
        targets.extend((('MAIN_BOARD', original_shape('MAIN_BOARD')), ('CASE__FIXED_BODY', case)))
        post_checks[name] = {other: post.intersect(shape).Volume() for other, shape in targets}

    result = {
        'scope': 'Focused nominal candidate placement screen using retained assembly allocations, not DRC or complete assembly qualification',
        'input_sha256': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in dict.fromkeys(inputs)},
        'candidate_count': len(changed),
        'candidate_board_continuity': 'Historical placement source and current board differ only in pin metadata and component values',
        'rear_records_matching_retained_assembly': rear_record_counts,
        'candidate_and_plate_to_rear_bounding_clearance_y_mm': rear_clearance_y,
        'candidate_bounding_pairs': [list(pair) for pair in sorted(pairs)],
        'case_group_intersections_mm3': group_volumes,
        'other_candidate_intersections_mm3': other_hits,
        'plate_bounding_hits_excluding_own_cooling': plate_hits,
        'plate_receiving_region_hits': plate_regions,
        'plate_case_intersection_mm3': plate_case,
        'post_intersections_mm3': post_checks,
        'assembly_source_inputs_changed': exchange['assembly_source_inputs_changed'],
        'limitations': 'No copper, tolerances, plug mating, complete assembly, thermal, electrical or manufacturing qualification; intended cooling contacts and fasteners are not screened as foreign objects.',
    }
    assert all(v == 0 for v in group_volumes.values())
    assert all(v == 0 for v in other_hits.values())
    assert plate_hits == ['CASE__FIXED_BODY'] and not plate_regions and plate_case == 0
    assert all(v == 0 for entries in post_checks.values() for v in entries.values())
    target = ROOT / 'build/reports/combined-candidate-placement-screen.json'
    target.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
