"""Update the separate memory-candidate PCB from its KiCad XML netlist.

Only the four studied component moves and new schematic components are applied.
Existing copper tracks, zones, other footprints and board edges are retained.
This is an unrouted concept, not a DRC, electrical or fabrication qualification.
KiCad's PCB scripting API: https://github.com/KiCad/kicad-doc/blob/master/src/pcbnew/pcbnew_python_scripting.adoc
"""
from pathlib import Path
from xml.etree import ElementTree

import pcbnew

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'ecad/mainboard/BMSX.kicad_pcb'
CANDIDATE = ROOT / 'ecad/mainboard_memory_candidate/BMSX.kicad_pcb'
NETLIST = ROOT / 'build/exports/BMSX_MEMORY_CANDIDATE_netlist.xml'
STAGED = ROOT / 'build/BMSX_MEMORY_CANDIDATE_unrouted.kicad_pcb'

# Generate a separate candidate from the untouched baseline, never modifying it.
board = pcbnew.LoadBoard(str(BASE))
root = ElementTree.parse(NETLIST).getroot()
components = {item.get('ref'): item for item in root.findall('./components/comp')}
net_by_pad = {}
pin_by_pad = {}
for net in root.findall('./nets/net'):
    for node in net.findall('node'):
        net_by_pad[(node.get('ref'), node.get('pin'))] = net.get('name')
        pin_by_pad[(node.get('ref'), node.get('pin'))] = (node.get('pinfunction', ''), node.get('pintype', ''))

original = {fp.GetReference(): fp for fp in board.GetFootprints()}
original_positions = {ref: (fp.GetPosition().x, fp.GetPosition().y) for ref, fp in original.items()}
original_zones = {(zone.m_Uuid.AsString(), zone.GetNetname(), zone.GetBoundingBox().GetX(),
                   zone.GetBoundingBox().GetY(), zone.GetBoundingBox().GetWidth(),
                   zone.GetBoundingBox().GetHeight()) for zone in board.Zones()}
original_tracks = len(board.GetTracks())
assert all(not zone.IsFilled() for zone in board.Zones())
root_uuid = original['U10'].GetPath().AsString().split('/')[1]

# Check the old component pad mappings against the authoritative netlist.
changed = {('U1', '50'), ('U1', '101'), ('U2', '102')}
for ref, fp in original.items():
    if ref not in components:
        continue  # baseline mechanical footprint, not a schematic component
    for pad in fp.Pads():
        key = (ref, pad.GetNumber())
        target = net_by_pad.get(key, '')
        if key in changed:
            continue
        assert pad.GetNetname() == target or (
            pad.GetNetname().startswith('unconnected-') and target.startswith('unconnected-')
        ), (key, pad.GetNetname(), target)

# Place the grouped alternative, retaining all original copper and geometry.
for ref in ('U30', 'C500', 'C501', 'C502'):
    item = original[ref]
    pos = item.GetPosition()
    item.SetPosition(pcbnew.VECTOR2I(pos.x + pcbnew.FromMM(4.5), pos.y))

# IC and adjacent backside-bypass locations, in native board millimetres.
positions = {
    'U150': (65, 50, 'U10'), 'U151': (65, 88, 'U11'),
    'U152': (182, 74.5, 'U30'), 'U153': (187, 53, 'U31'),
    'C600': (65, 38, 'C210'), 'C601': (65, 50, 'C211'), 'C602': (65, 62, 'C212'),
    'C603': (65, 76, 'C213'), 'C604': (65, 88, 'C214'), 'C605': (65, 100, 'C215'),
    'C610': (182, 72.5, 'C500'), 'C611': (182, 76.5, 'C501'), 'C612': (182, 80.5, 'C502'),
    'C613': (187, 51, 'C503'), 'C614': (187, 55, 'C504'), 'C615': (187, 59, 'C505'),
    'R600': (166, 100, 'R500'),
}
for ref, (x, y, template_ref) in positions.items():
    component = components[ref]
    library, name = component.findtext('footprint').split(':', 1)
    fp = pcbnew.FootprintLoad(str(CANDIDATE.parent / (library + '.pretty')), name)
    board.Add(fp)
    fp.SetFPIDAsString(component.findtext('footprint'))
    fp.SetReference(ref)
    fp.SetValue(component.findtext('value'))
    template = original[template_ref]
    if template.GetLayer() == pcbnew.B_Cu:
        fp.Flip(fp.GetPosition(), False)
    if ref == 'R600':
        fp.Flip(fp.GetPosition(), False)
    fp.SetOrientationDegrees(template.GetOrientationDegrees())
    fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y)))
    path = '/' + root_uuid + component.find('sheetpath').get('tstamps') + component.findtext('tstamps').split()[0]
    fp.SetPath(pcbnew.KIID_PATH(path))
    original[ref] = fp

# Only three pre-existing pad connections change. All added pad connections
# come directly from the schematic's native KiCad XML netlist.
net_items = board.GetNetInfo().NetsByName()
for ref, fp in original.items():
    if ref not in positions and ref not in ('U1', 'U2'):
        continue
    for pad in fp.Pads():
        key = (ref, pad.GetNumber())
        if ref not in positions and key not in changed:
            continue
        name = net_by_pad.get(key, '')
        if not name:
            continue
        if name not in net_items:
            board.Add(pcbnew.NETINFO_ITEM(board, name))
            net_items = board.GetNetInfo().NetsByName()
        pad.SetNet(net_items[name])

# KiCad carries the schematic's pin name/type and component value in the PCB
# as well as its net assignment. Synchronize them for every schematic pad,
# including newly fitted parts and the changed ASIC pins.
for ref, component in components.items():
    fp = original[ref]
    fp.SetValue(component.findtext('value'))
    for pad in fp.Pads():
        key = (ref, pad.GetNumber())
        if key in pin_by_pad:
            function, pin_type = pin_by_pad[key]
            pad.SetPinFunction(function)
            pad.SetPinType(pin_type)

# Verify same-side footprint envelopes with a 0.5 mm local clearance. This
# focused screen is not full DRC, routing, 3D fit or power qualification.
all_fps = list(board.GetFootprints())
new = set(positions)
for fp in all_fps:
    if fp.GetReference() not in new:
        continue
    r = fp.GetBoundingBox(False, False)
    expanded = (r.GetX()-pcbnew.FromMM(.5), r.GetY()-pcbnew.FromMM(.5),
                r.GetRight()+pcbnew.FromMM(.5), r.GetBottom()+pcbnew.FromMM(.5))
    for other in all_fps:
        if other.GetReference() == fp.GetReference() or other.GetLayer() != fp.GetLayer():
            continue
        o = other.GetBoundingBox(False, False)
        assert not (expanded[0] < o.GetRight() and expanded[2] > o.GetX() and
                    expanded[1] < o.GetBottom() and expanded[3] > o.GetY()), (fp.GetReference(), other.GetReference())

assert len(board.GetTracks()) == original_tracks
assert len(board.Zones()) == len(original_zones)
for ref, pos in original_positions.items():
    item = original[ref]
    dx = pcbnew.FromMM(4.5) if ref in ('U30', 'C500', 'C501', 'C502') else 0
    assert (item.GetPosition().x, item.GetPosition().y) == (pos[0] + dx, pos[1]), ref
pcbnew.SaveBoard(str(STAGED), board)
restored = pcbnew.LoadBoard(str(STAGED))
assert len(restored.GetFootprints()) == len(original_positions) + len(positions)
assert len(restored.GetTracks()) == original_tracks
assert all(not zone.IsFilled() for zone in restored.Zones())
assert {(zone.m_Uuid.AsString(), zone.GetNetname(), zone.GetBoundingBox().GetX(),
         zone.GetBoundingBox().GetY(), zone.GetBoundingBox().GetWidth(),
         zone.GetBoundingBox().GetHeight()) for zone in restored.Zones()} == original_zones
for component in components.values():
    ref = component.get('ref')
    fp = restored.FindFootprintByReference(ref)
    assert fp, ref
    assert fp.GetValue() == component.findtext('value'), ref
    path = '/' + root_uuid + component.find('sheetpath').get('tstamps') + component.findtext('tstamps').split()[0]
    assert fp.GetPath().AsString() == path, (ref, fp.GetPath().AsString(), path)
    for pad in fp.Pads():
        key = (ref, pad.GetNumber())
        if key in pin_by_pad:
            assert (pad.GetPinFunction(), pad.GetPinType()) == pin_by_pad[key], key
        target = net_by_pad.get((ref, pad.GetNumber()), '')
        assert pad.GetNetname() == target or (
            pad.GetNetname().startswith('unconnected-') and target.startswith('unconnected-')
        ), (ref, pad.GetNumber(), pad.GetNetname(), target)
print(f'Checked {len(components)} schematic components, {len(positions)} new footprints, '
      f'{original_tracks} unchanged tracks, {len(original_zones)} unchanged zone envelopes; staged {STAGED}')
