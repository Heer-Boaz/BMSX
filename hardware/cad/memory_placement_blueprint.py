"""Plot four conservative memory footprints on the unchanged KiCad board.

This is an indicative, non-routed layout study, not an ECO. Coordinates are
in KiCad board millimetres. Compare footprint envelopes and represented 3D
assembly regions before publishing. KiCad's board scripting model is described
at https://github.com/KiCad/kicad-doc/blob/master/src/pcbnew/pcbnew_python_scripting.adoc.
"""

import argparse
import json
from pathlib import Path
from xml.sax.saxutils import escape

import pcbnew

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--grouped', action='store_true', help='Place snapshot SRAMs together by shifting U30 and its underside capacitors')
args = parser.parse_args()

ROOT = Path(__file__).resolve().parents[1]
board = pcbnew.LoadBoard(str(ROOT / 'ecad/mainboard/BMSX.kicad_pcb'))
assembly = json.loads((ROOT / 'build/reports/compact-assembly.json').read_text())
footprints = {}
layers = {}
shifted = {'U30', 'C500', 'C501', 'C502'} if args.grouped else set()
for fp in board.GetFootprints():
    rect = fp.GetBoundingBox(False, False)
    ref = fp.GetReference()
    dx = 4.5 if ref in shifted else 0
    footprints[ref] = (pcbnew.ToMM(rect.GetX()) + dx, pcbnew.ToMM(rect.GetY()),
                       pcbnew.ToMM(rect.GetRight()) + dx, pcbnew.ToMM(rect.GetBottom()))
    layers[ref] = fp.GetLayer()

# Reuse the bounding envelopes of the actual installed device footprints.
# Native package seating spans Z=11.6..15.6 mm for the existing DRAM.
candidates = [
    ('P1', 'private DRAM', 'U10', 65, 50),
    ('P2', 'private DRAM', 'U11', 65, 88),
    ('V1', 'snapshot SRAM', 'U30', 182, 74.5 if args.grouped else 72),
    ('V2', 'snapshot SRAM', 'U31', 187 if args.grouped else 76, 53 if args.grouped else 148),
]
rectangles = []
for name, kind, ref, x, y in candidates:
    bx1, by1, bx2, by2 = footprints[ref]
    w, h = bx2-bx1, by2-by1
    rectangles.append((name, kind, x-w/2, y-h/2, x+w/2, y+h/2))

board_bounds = board.GetBoardEdgesBoundingBox()
board_rect = tuple(pcbnew.ToMM(v) for v in (board_bounds.GetX(),board_bounds.GetY(),board_bounds.GetRight(),board_bounds.GetBottom()))
cool = json.loads((ROOT/'design/enclosure_cooling.json').read_text())['sink']['receiving_bounds_mm']
cool_xy = (cool[0],cool[1],cool[3],cool[4])

def intersects(a,b):
    return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]

def expanded(box, d):
    return (box[0]-d,box[1]-d,box[2]+d,box[3]+d)

for i, (name, kind, x1, y1, x2, y2) in enumerate(rectangles):
    rect = (x1,y1,x2,y2)
    assert board_rect[0]+2 <= x1 and board_rect[1]+2 <= y1
    assert x2 <= board_rect[2]-2 and y2 <= board_rect[3]-2
    assert not intersects(expanded(rect,1),cool_xy), (name, 'cooler')
    for ref, bounds in footprints.items():
        assert not intersects(expanded(rect,1),bounds), (name,ref)
    for other in rectangles[:i]:
        assert not intersects(expanded(rect,1),other[2:]), (name,other[0])
    for key, part in assembly['physical_parts'].items():
        for region in part.get('regions_mm') or [part.get('bounds_mm')]:
            if region and region[2] < 16.0 and region[5] > 11.60001:
                dx = 4.5 if part.get('ref') in shifted else 0
                assert not intersects(expanded(rect,1),(region[0]+dx,region[1],region[3]+dx,region[4])), (name,key)

# Check the proposed shifted footprints against every other footprint on the
# same board side. U30's decouplers are on the opposite side of the board.
for moved in shifted:
    for ref, bounds in footprints.items():
        if ref not in shifted and layers[ref] == layers[moved]:
            assert not intersects(expanded(footprints[moved], 1), bounds), (moved, ref)
    rect = footprints[moved]
    assert board_rect[0] + 2 <= rect[0] and board_rect[1] + 2 <= rect[1]
    assert rect[2] <= board_rect[2] - 2 and rect[3] <= board_rect[3] - 2

# Existing nominal 3D regions of the shifted devices are translated as a
# group; retain Z so bottom-side decouplers are not confused with top parts.
for key, part in assembly['physical_parts'].items():
    if part.get('ref') not in shifted:
        continue
    for region in part.get('regions_mm') or [part.get('bounds_mm')]:
        if not region:
            continue
        xy = (region[0] + 4.5, region[1], region[3] + 4.5, region[4])
        for other_key, other in assembly['physical_parts'].items():
            if other.get('ref') in shifted:
                continue
            for other_region in other.get('regions_mm') or [other.get('bounds_mm')]:
                if other_region and region[2] < other_region[5] and region[5] > other_region[2]:
                    other_xy = (other_region[0], other_region[1], other_region[3], other_region[4])
                    assert not intersects(expanded(xy, 1), other_xy), (key, other_key)

# Native 2D board coordinate map, 5 px/mm, unchanged board origin.
def px(x): return (x-10)*5+45
def py(y): return (y-25)*5+110

def rectangle(x1,y1,x2,y2,cls):
    return f'<rect x="{px(x1):.2f}" y="{py(y1):.2f}" width="{(x2-x1)*5:.2f}" height="{(y2-y1)*5:.2f}" class="{cls}"/>'

svg = ['''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 970" role="img" aria-labelledby="title desc">
<title id="title">Indicative memory placement on the existing mainboard</title>
<desc id="desc">A conservative, unrouted four-device placement concept based on board footprints and assembly envelopes. This does not establish electrical or mechanical qualification.</desc>
<style>text{font-family:Arial,sans-serif;fill:#183044;font-size:20px}.title{font-size:31px;font-weight:bold}.small{font-size:17px}.head{font-size:22px;font-weight:bold}.board{fill:#f9faf9;stroke:#294b68;stroke-width:3}.part{fill:#d9e0df;stroke:#849294;stroke-width:0.8}.asic{fill:#bed2df;stroke:#294b68;stroke-width:1.2}.socket{fill:#c7d0d0;stroke:#455e62;stroke-width:1.5}.sink{fill:#d7a54d;fill-opacity:.18;stroke:#a87828;stroke-width:2;stroke-dasharray:7 5}.dram{fill:#52b6c1;stroke:#125560;stroke-width:2}.sram{fill:#be91d3;stroke:#5d3d73;stroke-width:2}.label{font-weight:bold;font-size:17px;fill:#183044}.line{stroke:#5f6e70;stroke-width:1.2;stroke-dasharray:4 4}</style>
<rect width="1600" height="970" fill="white"/><text x="45" y="47" class="title">Mainboard memory placement — preliminary space study</text>
<text x="45" y="78" class="small">Existing board and case geometry; four added memories are candidates, not routed or installed components.</text>''']
svg.append(rectangle(*board_rect,'board'))
for ref, bounds in footprints.items():
    cls = 'socket' if ref in ('J_CART0','J_CART1') else 'asic' if ref in ('U1','U2','U4','U7','U10','U11','U30','U31') else 'part'
    svg.append(rectangle(*bounds,cls))
svg.append(rectangle(*cool_xy,'sink'))
for ref in ('U1','U2','U10','U11','U30','U31','J_CART0','J_CART1'):
    x1,y1,x2,y2=footprints[ref];svg.append(f'<text x="{px((x1+x2)/2):.2f}" y="{py((y1+y2)/2)+6:.2f}" text-anchor="middle" class="label">{escape(ref)}</text>')
for name,kind,x1,y1,x2,y2 in rectangles:
    svg.append(rectangle(x1,y1,x2,y2,'dram' if name[0]=='P' else 'sram'))
    svg.append(f'<text x="{px((x1+x2)/2):.2f}" y="{py((y1+y2)/2)+6:.2f}" text-anchor="middle" class="label">{name}</text>')
svg.append('''<text x="1190" y="145" class="head">Candidates</text>
<rect x="1190" y="169" width="23" height="23" class="dram"/><text x="1225" y="187" class="small">P1 / P2: private DRAM</text>
<rect x="1190" y="206" width="23" height="23" class="sram"/><text x="1225" y="224" class="small">V1 / V2: snapshot SRAM</text>
<rect x="1190" y="243" width="23" height="23" class="sink"/><text x="1225" y="261" class="small">Cooler XY envelope</text>
<rect x="1190" y="280" width="23" height="23" class="part"/><text x="1225" y="298" class="small">Existing footprint envelope</text>
<text x="1190" y="355" class="head">Reading this view</text>
<text x="1190" y="389" class="small">{placement_line_1}</text>
<text x="1190" y="416" class="small">{placement_line_2}</text>
<text x="1190" y="443" class="small">{placement_line_3}</text>
<text x="1190" y="493" class="small">Nominal footprint and represented</text>
<text x="1190" y="520" class="small">assembly envelopes do not overlap;</text>
<text x="1190" y="547" class="small">routing, fanout, power, tolerances</text>
<text x="1190" y="574" class="small">and signal timing are not shown.</text>
<text x="1190" y="627" class="small">Separate candidate PCB exists;</text>
<text x="1190" y="654" class="small">full assembly fit is not shown.</text>
{text_coordinates}
<text x="45" y="900" class="small">Nominal board 220 × 150 mm. Study uses the existing layout, cooler and represented assembly regions.</text>
<text x="45" y="929" class="small">One millimetre XY margin is used for the candidate-envelope comparison; this is not a design-rule or fit qualification.</text>
</svg>''')
if args.grouped:
    text_lines = ('U30 shifts +4.5 mm in X.', 'C500 / C501 / C502 shift with U30', 'on the underside; P1/P2 retained.')
    name = 'memory-placement-grouped'
    coordinates = '''<text x="1190" y="706" class="small">Candidate centres in board mm:</text>
<text x="1190" y="733" class="small">P1 65,50 · P2 65,88</text>
<text x="1190" y="760" class="small">V1 182,74.5 · V2 187,53</text>
<text x="1190" y="787" class="small">U30 / C500–502: X +4.5 mm</text>'''
else:
    text_lines = ('Candidate V2 is distant from V1.', 'It is not a preferred placement:', 'rearrangement may be needed.')
    name = 'memory-placement-blueprint'
    coordinates = ''
svg[-1] = svg[-1].replace('{placement_line_1}', text_lines[0]).replace('{placement_line_2}', text_lines[1]).replace('{placement_line_3}', text_lines[2]).replace('{text_coordinates}', coordinates)
output=ROOT.parent/f'docs/book4/figures/{name}.svg'
output.write_text('\n'.join(svg)+'\n')
print('Checked',len(footprints),'footprints and',len(assembly['physical_parts']),'assembly parts; wrote',output)
