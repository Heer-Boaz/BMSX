"""Apply the INPUT candidate netlist to a separate, unrouted PCB copy.

The memory-candidate board is the untouched input. Pad-net assignments move
between U7 and U2; schematic pin metadata and component values are synced too.
No copper is routed or filled.
KiCad PCB scripting: https://github.com/KiCad/kicad-doc/blob/master/src/pcbnew/pcbnew_python_scripting.adoc
"""
from pathlib import Path
from xml.etree import ElementTree

import pcbnew

ROOT = Path(__file__).resolve().parents[1]
board = pcbnew.LoadBoard(str(ROOT / 'ecad/mainboard_memory_candidate/BMSX.kicad_pcb'))
netlist = ElementTree.parse(ROOT / 'build/exports/BMSX_INPUT_CANDIDATE_netlist.xml').getroot()
components = {comp.get('ref'): comp for comp in netlist.findall('./components/comp')}
net_by_pad = {}
pin_by_pad = {}
for net in netlist.findall('./nets/net'):
    for node in net.findall('node'):
        net_by_pad[(node.get('ref'), node.get('pin'))] = net.get('name')
        pin_by_pad[(node.get('ref'), node.get('pin'))] = (node.get('pinfunction', ''), node.get('pintype', ''))

expected = {('U2', str(n)) for n in (*range(97, 102), *range(159, 171), 173, 174)}
expected |= {('U7', str(n)) for n in (*range(42, 58), *range(59, 63))}
changed = set()
assert len(board.GetTracks()) == 0 and all(not zone.IsFilled() for zone in board.Zones())
for ref in sorted(components):
    fp = board.FindFootprintByReference(ref)
    assert fp, ref
    fp.SetValue(components[ref].findtext('value'))
    for pad in fp.Pads():
        key = (ref, pad.GetNumber())
        if key in pin_by_pad:
            function, pin_type = pin_by_pad[key]
            pad.SetPinFunction(function)
            pad.SetPinType(pin_type)
        target = net_by_pad.get(key, '')
        current = pad.GetNetname()
        if current == target or current.startswith('unconnected-') and target.startswith('unconnected-') and key not in expected:
            continue
        assert key in expected, (key, current, target)
        nets = board.GetNetInfo().NetsByName()
        if target not in nets:
            board.Add(pcbnew.NETINFO_ITEM(board, target))
            nets = board.GetNetInfo().NetsByName()
        pad.SetNet(nets[target])
        changed.add(key)
assert changed == expected, (expected - changed, changed - expected)
staged = ROOT / 'build/BMSX_INPUT_CANDIDATE_unrouted.kicad_pcb'
pcbnew.SaveBoard(str(staged), board)
restored = pcbnew.LoadBoard(str(staged))
assert len(restored.GetFootprints()) == len(board.GetFootprints())
assert len(restored.GetTracks()) == 0 and len(restored.Zones()) == 19
assert all(not zone.IsFilled() for zone in restored.Zones())
for ref in sorted(components):
    fp = restored.FindFootprintByReference(ref)
    assert fp, ref
    assert fp.GetValue() == components[ref].findtext('value'), ref
    for pad in fp.Pads():
        key = (ref, pad.GetNumber())
        if key in pin_by_pad:
            assert (pad.GetPinFunction(), pad.GetPinType()) == pin_by_pad[key], key
        target = net_by_pad.get((ref, pad.GetNumber()), '')
        current = pad.GetNetname()
        assert current == target or current.startswith('unconnected-') and target.startswith('unconnected-'), (ref, pad.GetNumber(), current, target)
board_pads = {(fp.GetReference(), pad.GetNumber()) for fp in restored.GetFootprints() for pad in fp.Pads()}
assert net_by_pad.keys() <= board_pads
print(f'INPUT PCB: {len(components)} schematic components, {len(changed)} changed pad nets, 0 tracks, 19 unfilled zones')
