"""Build a separate nominal pad-plug contact and cable-restraint concept.

The original empty-channel plug and socket remain unchanged. Annular terminal
solids are allocated volumes, not spring, crimp, insertion-force or electrical
contact models. STEP import/export follows CadQuery's native assembly API:
https://github.com/CadQuery/cadquery/blob/master/tests/test_assembly.py
"""
import argparse
import hashlib
import json
from pathlib import Path

import cadquery as cq

from geometry import box

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reinforced-nose', action='store_true',
                        help='build the separate 4.8 mm nominal nose candidate')
    args = parser.parse_args()
    spec_path = ROOT / 'design/pad_plug_contacts_candidate.json'
    plug_spec_path = ROOT / 'design/pad_plug_concept.json'
    original_path = ROOT / 'build/exports/BMSX_PAD_PLUG_NOMINAL_CONCEPT.step'
    original_report_path = ROOT / 'build/reports/pad-plug-concept.json'
    spec = json.loads(spec_path.read_text())
    plug_spec = json.loads(plug_spec_path.read_text())
    original_report = json.loads(original_report_path.read_text())
    assert hashlib.sha256(original_path.read_bytes()).hexdigest() == original_report['output_sha256']
    parts = {name.rsplit('/', 1)[-1]: shape.located(loc)
             for shape, name, loc, _ in cq.Assembly.importStep(str(original_path))}
    body = parts['PLUG_BODY_EMPTY_CHANNELS']
    nose = plug_spec['nose_bounds_mm']
    inputs = [Path(__file__), ROOT / 'cad/geometry.py', spec_path, plug_spec_path,
              original_path, original_report_path]
    if args.reinforced_nose:
        reinforced_path = ROOT / 'design/pad_plug_reinforced_nose.json'
        reinforced = json.loads(reinforced_path.read_text())
        inputs.append(reinforced_path)
        nose = reinforced['nose_bounds_mm']
        body = body.fuse(box(nose).cut(box(plug_spec['key_groove_bounds_mm'])))
    retainer = box(spec['retainer_bounds_mm'])
    body = body.cut(box(spec['retainer_slot_bounds_mm']))
    contacts = {}
    for row in original_report['channel_positions']:
        number, x, z = row['contact'], row['x_mm'], row['z_mm']
        axis = cq.Vector(0, 1, 0)
        y0, y1 = spec['rear_cavity_axis_y_mm']
        body = body.cut(cq.Solid.makeCylinder(spec['rear_cavity_radius_mm'], y1-y0, cq.Vector(x, y0, z), axis))
        y0, y1 = spec['nose_cavity_axis_y_mm']
        body = body.cut(cq.Solid.makeCylinder(spec['nose_cavity_radius_mm'], y1-y0, cq.Vector(x, y0, z), axis))
        y0, y1 = spec['retainer_bounds_mm'][1], spec['retainer_bounds_mm'][4]
        retainer = retainer.cut(cq.Solid.makeCylinder(spec['retainer_channel_radius_mm'], y1-y0, cq.Vector(x, y0, z), axis))
        y0, y1 = spec['terminal_axis_y_mm']
        terminal = cq.Solid.makeCylinder(spec['terminal_outer_radius_mm'], y1-y0, cq.Vector(x, y0, z), axis)
        for field in ('terminal_rear', 'terminal_collar'):
            a, b = spec[field + '_axis_y_mm']
            terminal = terminal.fuse(cq.Solid.makeCylinder(spec[field + '_radius_mm'], b-a, cq.Vector(x, a, z), axis))
        terminal = terminal.cut(cq.Solid.makeCylinder(spec['terminal_bore_radius_mm'], y1-y0, cq.Vector(x, y0, z), axis))
        assert terminal.isValid() and len(terminal.Solids()) == 1, number
        contacts[number] = terminal
    assert body.isValid() and len(body.Solids()) == 1
    assert retainer.isValid() and len(retainer.Solids()) == 1
    assert body.intersect(retainer).Volume() < 1e-7

    x, z = spec['boot_centre_xz_mm']
    y0, y1 = spec['boot_axis_y_mm']
    axis = cq.Vector(0, 1, 0)
    boot = cq.Solid.makeCylinder(spec['boot_outer_radius_mm'], y1-y0, cq.Vector(x, y0, z), axis).cut(
        cq.Solid.makeCylinder(spec['boot_inner_radius_mm'], y1-y0, cq.Vector(x, y0, z), axis))
    y0, y1 = spec['cable_axis_y_mm']
    cable = cq.Solid.makeCylinder(spec['cable_radius_mm'], y1-y0, cq.Vector(x, y0, z), axis)
    assert boot.isValid() and boot.intersect(cable).Volume() < 1e-7
    assert body.intersect(boot).Volume() < 1e-7
    assert body.intersect(parts['SOCKET_BODY']).Volume() < 1e-7

    pose_checks = []
    inverted_overlap = None
    if args.reinforced_nose:
        plug = cq.Compound.makeCompound([body, retainer, *contacts.values()])
        socket = cq.Compound.makeCompound([parts['SOCKET_BODY'],
                         *(parts[f'SOCKET_CONTACT_{number}'] for number in contacts)])
        for offset in (-5.0, -2.5, 0.0):
            volume = plug.translate((0, offset, 0)).intersect(socket).Volume()
            assert volume < 1e-7, (offset, volume)
            pose_checks.append({'offset_y_mm': offset, 'intersection_mm3': volume})
        axis_start, axis_end = plug_spec['rotation_axis_mm']
        inverted_overlap = body.rotate(tuple(axis_start), tuple(axis_end), 180).intersect(parts['SOCKET_BODY']).Volume()
        assert inverted_overlap > 1e-7

    checks = {}
    for number, terminal in contacts.items():
        pin = parts[f'SOCKET_CONTACT_{number}']
        checks[str(number)] = {
            'body_intersection_mm3': body.intersect(terminal).Volume(),
            'retainer_intersection_mm3': retainer.intersect(terminal).Volume(),
            'pin_intersection_mm3': pin.intersect(terminal).Volume(),
            'pin_distance_mm': pin.distance(terminal),
            'forward_stop_probe_intersection_mm3': body.intersect(terminal.translate((0, 0.10, 0))).Volume(),
            'rear_stop_probe_intersection_mm3': retainer.intersect(terminal.translate((0, -0.10, 0))).Volume(),
        }
        assert all(checks[str(number)][key] < 1e-7 for key in
                   ('body_intersection_mm3', 'retainer_intersection_mm3', 'pin_intersection_mm3'))
        assert checks[str(number)]['forward_stop_probe_intersection_mm3'] > 1e-7
        assert checks[str(number)]['rear_stop_probe_intersection_mm3'] > 1e-7

    assembly = cq.Assembly(name='BMSX_PAD_PLUG_CONTACTS_CONCEPT')
    assembly.add(parts['SOCKET_BODY'], name='SOCKET_BODY', color=cq.Color(.15, .17, .18))
    assembly.add(body, name='PLUG_BODY_STEPPED_CAVITIES', color=cq.Color(.37, .40, .42))
    assembly.add(retainer, name='RETAINER_PROPOSAL', color=cq.Color(.54, .58, .60))
    assembly.add(boot, name='CABLE_BOOT_CONCEPT', color=cq.Color(.21, .23, .24))
    assembly.add(cable, name='CABLE_JACKET_ENVELOPE', color=cq.Color(.10, .11, .12))
    for number, terminal in contacts.items():
        assembly.add(parts[f'SOCKET_CONTACT_{number}'], name=f'SOCKET_CONTACT_{number}', color=cq.Color(.72, .58, .28))
        assembly.add(terminal, name=f'TERMINAL_ENVELOPE_{number}', color=cq.Color(.72, .58, .28))
    output = ROOT / ('build/exports/BMSX_PAD_PLUG_REINFORCED_NOSE_CONCEPT.step'
                     if args.reinforced_nose else 'build/exports/BMSX_PAD_PLUG_CONTACTS_CONCEPT.step')
    assembly.export(str(output))
    restored = {name.rsplit('/', 1)[-1] for _, name, _, _ in cq.Assembly.importStep(str(output))}
    expected = {'SOCKET_BODY', 'PLUG_BODY_STEPPED_CAVITIES', 'RETAINER_PROPOSAL',
                'CABLE_BOOT_CONCEPT', 'CABLE_JACKET_ENVELOPE'} | {
                    f'{prefix}_{number}' for number in contacts
                    for prefix in ('SOCKET_CONTACT', 'TERMINAL_ENVELOPE')}
    assert restored == expected
    nose_web = min(min(row['x_mm']-nose[0], nose[3]-row['x_mm'],
                       row['z_mm']-nose[2], nose[5]-row['z_mm']) - spec['nose_cavity_radius_mm']
                   for row in original_report['channel_positions'])
    report = {
        'scope': __doc__,
        'input_sha256': {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                         for path in inputs},
        'terminal_checks': checks,
        'retainer_body_intersection_mm3': body.intersect(retainer).Volume(),
        'nominal_minimum_nose_web_mm': nose_web,
        'sampled_insertion_poses': pose_checks,
        'inverted_body_socket_intersection_mm3': inverted_overlap,
        'boot_cable_intersection_mm3': boot.intersect(cable).Volume(),
        'step_names_match': True,
        'output_sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'limitations': ([reinforced['limitation'], *spec['limitations'][1:]]
                        if args.reinforced_nose else spec['limitations']),
    }
    report_path = ROOT / ('build/reports/pad-plug-reinforced-nose.json'
                          if args.reinforced_nose else 'build/reports/pad-plug-contacts-candidate.json')
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'terminal_count': len(contacts), 'nominal_nose_web_mm': nose_web,
                      'step_names_match': True, 'output': str(output)}))


if __name__ == '__main__':
    main()
