"""BMSX A04: mechanical enclosure and common cartridge load frame.

Run with CadQuery 2.7.0.  This is solid BRep CAD, not a reconstruction of a
rendered product image or an electrical implementation of the fantasy CPU.
"""
from __future__ import annotations
import json
import math
from pathlib import Path
import cadquery as cq

ROOT = Path(__file__).resolve().parents[1]
PARAMS = json.loads((Path(__file__).parent / "parameters.json").read_text())
COLORS = {
    "abs":(0.23,0.25,0.28), "lower":(0.16,0.18,0.21), "steel":(0.65,0.70,0.75),
    "pcb":(0.13,0.45,0.31), "chip":(0.12,0.15,0.18), "aluminium":(0.71,0.76,0.80),
    "gold":(0.80,0.60,0.23), "blue":(0.12,0.28,0.61), "cart":(0.71,0.72,0.73),
    "rubber":(0.10,0.12,0.13), "tim":(0.63,0.72,0.78), "led":(0.25,0.85,0.20),
    "wire":(0.78,0.39,0.19), "keepout":(0.96,0.64,0.18),
}

def box(x,y,z,w,d,h):
    return cq.Workplane("XY").box(w,d,h,centered=(False,False,False)).translate((x,y,z)).val()

def rounded(x,y,z,w,d,h,r):
    return (cq.Workplane("XY").box(w,d,h,centered=(False,False,False))
            .edges("|Z").fillet(r).translate((x,y,z)).val())

def cylinder(x,y,z,r,h):
    return cq.Solid.makeCylinder(r,h,cq.Vector(x,y,z),cq.Vector(0,0,1))

def cylinder_y(x,y,z,r,length):
    return cq.Solid.makeCylinder(r,length,cq.Vector(x,y,z),cq.Vector(0,1,0))

def nut_z(x,y,z,flat=5.5,height=2.4):
    n=cq.Workplane('XY').polygon(6,flat/math.cos(math.pi/6)).extrude(height).translate((x,y,z)).val()
    return n.cut(cylinder(x,y,z-0.1,1.3,height+0.2))

def fuse(shapes):
    shapes=list(shapes)
    return shapes[0].fuse(*shapes[1:]).clean() if len(shapes)>1 else shapes[0]

def cut(shape, tools):
    tools=list(tools)
    # Each cutter must enter the Boolean as its own tool. A compound containing
    # overlapping solids is not a regularised union and can leave phantom material.
    return shape.cut(*tools).clean() if tools else shape

def ring(x,y,z,w,d,h,r,t):
    return rounded(x,y,z,w,d,h,r).cut(rounded(x+t,y+t,z-0.1,w-2*t,d-2*t,h+0.2,max(0.2,r-t))).clean()

def capsule_xy(cx,cy,z,width,length,height):
    # Long axis Y; exact capsule area width*(length-width)+pi*(width/2)^2.
    r=width/2
    return fuse([box(cx-r,cy-(length-width)/2,z,width,length-width,height),
                 cylinder(cx,cy-(length-width)/2,z,r,height),
                 cylinder(cx,cy+(length-width)/2,z,r,height)])

def capsule_yz(x,cy,cz,width,length,depth):
    # Long axis Z, through side wall X.
    s=capsule_xy(0,0,0,width,length,depth)
    return s.rotate((0,0,0),(0,1,0),90).rotate((0,0,0),(1,0,0),90).translate((x,cy,cz))

def port_prism(cx,y,cz,w,h,depth,r):
    # Rounded rectangular front, extrusion towards rear (+Y).
    return rounded(-w/2,-h/2,0,w,h,depth,r).rotate((0,0,0),(1,0,0),90).translate((cx,y+depth,cz))

class Model:
    def __init__(self):
        self.parts={}
        self.keepouts={}
        self.vents=[]
        self.known_contacts=[]

    def add(self,name,shape,color,group,material="",basis="design",**metadata):
        if not shape.isValid():
            raise ValueError(f"Invalid BRep: {name}")
        self.parts[name]={"shape":shape,"color":COLORS.get(color,color),"group":group,
                          "material":material,"basis":basis,**metadata}
        return shape

    def keepout(self,name,shape,description,allowed=()):
        self.keepouts[name]={"shape":shape,"description":description,"allowed":list(allowed)}

    def assembly(self,exclude=(),explode=False):
        a=cq.Assembly(name=PARAMS['revision'])
        offsets={"lid":90,"lid_controls":90,"carrier":55,"guides":55,"cart":55,
                 "cartridge_screws":30,"mainboard":22,"components":22,"heatsink":40,
                 "thermal":40,"rear_io":22,"front_io":22,"pcb_screws":22}
        for n,p in self.parts.items():
            if n in exclude or p["group"] in exclude: continue
            dz=offsets.get(p['group'],0) if explode else 0
            a.add(p['shape'],name=n,color=cq.Color(*p['color']),loc=cq.Location(cq.Vector(0,0,dz)))
        return a

    def manifest(self):
        output={}
        for name,p in self.parts.items():
            bb=p['shape'].BoundingBox()
            output[name]={k:v for k,v in p.items() if k!='shape'}
            output[name].update(bbox_min=[bb.xmin,bb.ymin,bb.zmin],bbox_max=[bb.xmax,bb.ymax,bb.zmax],
                                volume_mm3=p['shape'].Volume(),solid_count=len(p['shape'].Solids()),valid=p['shape'].isValid())
        return output

def build():
    m=Model(); p=PARAMS; c=p['case']; board=p['pcb']; cart=p['cartridges']; cool=p['cooling']
    W,D= c['width'],c['depth']; wall=c['wall']; pz=board['bottom_z']; pt=pz+board['thickness']
    # ---------- Lower tray, joint registration, structural bosses ----------
    bottom=rounded(0,0,0,W,D,c['split_z'],c['corner_radius'])
    bottom=bottom.cut(rounded(wall,wall,wall,W-2*wall,D-2*wall,30,c['corner_radius']-wall))
    ledge=ring(2.0,2.0,14.8,W-4,D-4,1.0,8.0,1.8)
    tongue=ring(2.8,2.8,15.7,W-5.6,D-5.6,3.3,7.2,1.0)
    bottom=fuse([bottom,ledge,tongue])
    support_bosses=[]; floor_holes=[]
    for x,y in p['case_screws']:
        support_bosses.append(cylinder(x,y,wall,3.6,12.4))
        floor_holes.append(cylinder(x,y,-1,1.7,20))
    for x,y in p['pcb_mounts']:
        support_bosses.append(cylinder(x,y,wall,3.2,pz-wall))
        floor_holes.append(cylinder(x,y,wall,1.3,pz-wall+1))
    for x,y in p['frame_posts']:
        support_bosses.append(cylinder(x,y,wall,4,5.5-wall))
        floor_holes.append(cylinder(x,y,-1,1.7,8))
    front_mounts=[(x,21) for x in [40,150,260]]
    rear_mounts=[(x,184) for x in [24,142,266]]
    for x,y in front_mounts:
        support_bosses.append(cylinder(x,y,wall,3.2,12-wall))
        floor_holes.append(cylinder(x,y,wall,1.3,11))
    for x,y in rear_mounts:
        support_bosses.append(cylinder(x,y,wall,3.2,12.4-wall))
        floor_holes.append(cylinder(x,y,wall,1.3,11))
    for x in p['front_port_x']:
        support_bosses.append(cylinder(x,18,wall,2.5,12-wall))
        floor_holes.append(cylinder(x,18,wall,0.8,11))
    for x in [186,256]:
        for y in [192,200]:
            support_bosses.append(cylinder(x,y,wall,3.2,11.6-wall))
            floor_holes.append(cylinder(x,y,wall,1.3,11))
    connector_mounts=[]
    for x in cart['centers_x']:
        for xx in (x-46.675,x+46.675):
            connector_mounts.append((xx,cart['center_y']))
            # A03 socket fasteners terminate in metal nuts on the common frame.
            # No connector screw is anchored in ABS or compresses the main PCB.
    bottom=fuse([bottom,*support_bosses])
    # Integral 1.2 mm ribs are joined to the bottom rather than floating.
    ribs=[box(8,18,wall,1.2,163,3.1),box(290.8,18,wall,1.2,163,3.1)]
    for x,y in p['case_screws']:
        if y<30: ribs.append(box(x-0.6,wall,wall,1.2,y-wall,8))
        else: ribs.append(box(x-0.6,y,wall,1.2,D-wall-y,8))
    # Broad lower frame bears on four wall-connected transverse ribs and two
    # longitudinal webs. The front rib is between the existing side apertures.
    # These are real plastic webs, not an assertion of qualified ABS strength.
    for yy in (130.5,145.5,155.5,166.0):
        ribs.append(box(wall,yy-.6,wall,W-2*wall,1.2,5.5-wall))
    for xx in cart['centers_x']:
        ribs.append(box(xx-.6,124,wall,1.2,50,5.5-wall))
    bottom=fuse([bottom,*ribs])
    # A04 direct bidirectional socket anchors. The floor admits a metal barrel;
    # an interior flange and exterior washer capture the floor without an ABS
    # thread. Grip length is nominally equal to floor thickness; production
    # tolerances must resolve possible preload/gap, never assumed away.
    for xx,yy in connector_mounts:
        floor_holes += [cylinder(xx,yy,-1,3.4,8),
                        cylinder(xx,yy,2.4,7.2,1.3),
                        cylinder(xx,yy,3.6,3.45,2.0)]
    for i in range(cool['floor_slots']):
        x=42+6*i
        floor_holes.append(capsule_xy(x,80,-1,cool['floor_slot_width'],cool['floor_slot_length'],5))
        m.vents.append({"bank":"floor_intake","width":cool['floor_slot_width'],"length":cool['floor_slot_length'],"center":[x,80,1.2],"normal":[0,0,-1]})
    for side,x in [('left',-1),('right',W-wall-1)]:
        for i in range(cool['side_slots_each']):
            y=38+5*i
            floor_holes.append(capsule_yz(x,y,8.5,cool['side_slot_width'],cool['side_slot_length'],wall+2))
            m.vents.append({"bank":side+"_intake","width":cool['side_slot_width'],"length":cool['side_slot_length'],"center":[1.2 if side=='left' else W-1.2,y,8.5],"normal":[-1 if side=='left' else 1,0,0]})
    # Panel cutouts must cut both halves where they cross the assembly seam.
    front_holes=[port_prism(x,-2,20,19.0,10.2,7,2.0) for x in p['front_port_x']]
    rear_holes=[box(193.4,205,13.5,55.2,8,17.5)]
    # Clearance to the whole connector face, not merely to its inner contact hole.
    for x in [62,88]: rear_holes.append(box(x-7.3,205,13.7,14.6,8,13.6))
    rear_holes.append(box(25.2,205,13.7,9.6,8,11.6))
    # Local registration-tongue recesses for the SCART ear retaining clips.
    rear_holes += [box(186.8,205.8,16.05,3.4,1.6,8),box(251.8,205.8,16.05,3.4,1.6,8)]
    bottom=cut(bottom,[*floor_holes,*front_holes,*rear_holes])
    m.add('lower_shell',bottom,'lower','base','ABS','nominal prototype geometry')

    # ---------- Removable top shell with genuinely open cooling apertures ----------
    z0=c['split_z']+c['seam_gap']
    top=rounded(0,0,z0,W,D,c['body_top']-z0,10)
    deck=rounded(18,117,54,264,64,6,8)
    top=fuse([top,deck])
    cavities=[rounded(wall,wall,z0-1,W-2*wall,D-2*wall,51.6-z0+1,7.6),
              rounded(20.4,119.4,50.6,259.2,59.2,7.0,5.6)]
    top=cut(top,cavities)
    top_bosses=[]; top_holes=[]
    for x,y in p['case_screws']:
        # Cylindrical boss + radial wall, with nominal pilot for M3 screw.
        # The six boss faces meet the lower bosses at z14.8: a real hard stop.
        top_bosses.append(cylinder(x,y,14.8,3.1,51.6-14.8))
        top_holes.append(cylinder(x,y,14.7,1.3,16.0))
        if y<30: top_bosses.append(box(x-0.6,2.0,z0,1.2,y-2.0,35.3))
        else: top_bosses.append(box(x-0.6,y,z0,1.2,D-2-y,35.3))
    for x,y in [(42,46),(112,64)]:
        top_bosses.append(cylinder(x,y,40,3.2,11.6))
        top_holes.append(cylinder(x,y,39.8,1.3,10))
    top=fuse([top,*top_bosses])
    top_holes.append(ring(2.5,2.5,15.8,W-5,D-5,3.5,7.5,1.6))
    for x in cart['centers_x']:
        top_holes.append(rounded(x-59.0,149-13.0,30,118.0,26.0,45,2.0))
    for i in range(cool['front_exhaust_slots']):
        x=32.5+5*i
        top_holes.append(capsule_xy(x,cool.get('front_exhaust_center_y',93),48,cool['front_exhaust_width'],cool['front_exhaust_length'],10))
        m.vents.append({"bank":"front_exhaust","width":cool['front_exhaust_width'],"length":cool['front_exhaust_length'],"center":[x,cool.get('front_exhaust_center_y',93),52.8],"normal":[0,0,1]})
    for i in range(cool['rear_exhaust_slots']):
        x=52.5+5*i
        top_holes.append(capsule_xy(x,193,48,cool['rear_exhaust_width'],cool['rear_exhaust_length'],10))
        m.vents.append({"bank":"rear_exhaust","width":cool['rear_exhaust_width'],"length":cool['rear_exhaust_length'],"center":[x,193,52.8],"normal":[0,0,1]})
    top_holes += [box(59,48.5,40,22,13,25),cylinder(105,55,40,6.3,25),cylinder(45,55,45,1.65,20)]
    top=cut(top,[*top_holes,*front_holes,*rear_holes])
    m.add('upper_shell',top,'abs','lid','ABS','nominal prototype geometry')

    for i,(x,y) in enumerate([(31,17),(269,17),(31,193),(269,193)]):
        m.add(f'foot_{i+1}',cylinder(x,y,-6,8,6),'rubber','base','rubber','design')
    # Lid screws: smooth-shank representation, threads not represented.
    for i,(x,y) in enumerate(p['case_screws']):
        screw=fuse([cylinder(x,y,-1.65,2.75,1.65),cylinder(x,y,0,1.5,25)])
        m.add(f'case_screw_{i+1}',screw,'steel','case_screws','steel','M3 nominal smooth-shank',thread_mate='upper_shell')

    # ---------- Main PCB with actual mounting openings ----------
    pcb=box(board['x'],board['y'],pz,board['width'],board['depth'],board['thickness'])
    pcb_holes=[cylinder(x,y,pz-1,1.7,4) for x,y in p['pcb_mounts']]
    # Metal compression sleeves pass through these enlarged holes without
    # loading FR4. Required trace/pad keepout is recorded in the A03 design JSON.
    pcb_holes += [cylinder(x,y,pz-1,3.6,4) for x,y in connector_mounts]
    pcb_holes += [cylinder(x,y,pz-1,4.1,4) for x,y in p['frame_posts'] if 20<x<280]
    # Two cartridge connector pin rows, including real under-board tail extent.
    for x in cart['centers_x']:
        for j in range(31):
            for yy in [146.46,151.54]: pcb_holes.append(cylinder(x-38.1+j*2.54,yy,pz-1,0.65,4))
    pcb=cut(pcb,pcb_holes)
    m.add('main_pcb',pcb,'pcb','mainboard','FR4','allocated board outline; unrouted')
    for i,(x,y) in enumerate(p['pcb_mounts']):
        m.add(f'pcb_screw_{i+1}',fuse([cylinder(x,y,pt,2.75,1.65),cylinder(x,y,6.0,1.5,pt-6.0)]),
              'steel','pcb_screws','steel','M3 nominal',thread_mate='lower_shell')

    # ---------- Dimensional silicon package references, not BMSX chip choices ----------
    for name,x,y in [('cpu_package',125,82),('gpu_package',172,82)]:
        chip=box(x-14,y-14,pt+0.1,28,28,1.3)
        leads=[]
        for j in range(52):
            t=(j-25.5)*0.5
            leads += [box(x-15.075,y+t-0.09,pt,1.10,0.18,0.16),box(x+13.975,y+t-0.09,pt,1.10,0.18,0.16),
                      box(x+t-0.09,y-15.075,pt,0.18,1.10,0.16),box(x+t-0.09,y+13.975,pt,0.18,1.10,0.16)]
        m.add(name,fuse([chip,*leads]),'chip','components','moulded package','NXP SOT459-1 envelope reference',thermal_source=True)
        # Package top is 13.0 here, TIM intentionally bridges to heatsink z14.
        m.add(name+'_tim',box(x-13,y-13,13.0,26,26,1.0),'tim','thermal','thermal pad','1 mm nominal design reserve')
    # Conservative SOJ42 envelopes: reserves do not assert memory chip capacity.
    memory_positions=[(48,48),(48,67),(48,86),(48,105),(239,51),(239,73),(239,95)]
    for i,(x,y) in enumerate(memory_positions):
        m.add(f'memory_envelope_{i+1}',box(x-13.715,y-5.665,pt,27.43,11.33,3.76),
              'chip','components','package','ISSI SOJ42 max mechanical envelope',envelope_only=True)
    m.add('io_asic_envelope',box(66,114,pt,18,18,3.0),'chip','components','package','reserved QFP envelope',envelope_only=True)
    m.add('bios_rom_envelope',box(203,115,pt,28,14,4),'chip','components','package','reserved ROM envelope',envelope_only=True)
    # Internal low-voltage regulation: physically allocated, not a completed circuit.
    m.add('dc_regulator_envelope',box(101,31,pt,18,12,9),'chip','components','package','reserved regulator envelope',envelope_only=True)
    for i,(x,y) in enumerate([(80,35),(88,35),(221,33),(237,33)]):
        m.add(f'filter_capacitor_{i+1}',cylinder(x,y,pt,3.2,11),'blue','components','capacitor','6.4 x 11 mm design envelope',envelope_only=True)

    # ---------- Real clearance heatsink plus removable spring/clamp provisions ----------
    hs=box(95,50,14,100,70,3)
    fins=[]
    for i in range(cool['heatsink_fin_count']):
        xx=95+i*(100-1.4)/(cool['heatsink_fin_count']-1)
        fins.append(box(xx,50,17,1.4,70,15))
    hs=fuse([hs,*fins])
    # Four mechanical mounting holes and PCB clearances under them.
    sink_mounts=[(99,54),(191,54),(99,116),(191,116)]
    hs=cut(hs,[cylinder(x,y,13,1.7,21) for x,y in sink_mounts])
    hs=cut(hs,[cylinder(x,y,17,3.3,17) for x,y in sink_mounts])
    m.add('heatsink',hs,'aluminium','heatsink','aluminium','100 x 70 x 18 mm designed sparse-fin heatsink')
    # Add holes to main PCB for actual heat-sink fixings.
    m.parts['main_pcb']['shape']=cut(m.parts['main_pcb']['shape'],[cylinder(x,y,pz-1,1.7,4) for x,y in sink_mounts])
    for i,(x,y) in enumerate(sink_mounts):
        stand=cylinder(x,y,pt,2.5,14-pt).cut(cylinder(x,y,pt-0.1,1.7,4))
        m.add(f'heatsink_spacer_{i+1}',stand,'steel','thermal','metal','nominal spacer')
        m.add(f'heatsink_nut_{i+1}',nut_z(x,y,7.6),'steel','thermal','steel','M3 nut, threads simplified')
        screw=fuse([cylinder(x,y,17,2.75,1.65),cylinder(x,y,7.6,1.5,9.4)])
        m.add(f'heatsink_screw_{i+1}',screw,'steel','thermal','steel','M3 screw with rigid spacer; preload unqualified',thread_mate=f'heatsink_nut_{i+1}')

    # ---------- Common upper/lower cartridge load frame ----------
    # Lower steel spreader is carried by the six original chassis bosses plus
    # the new wall-connected rib grid. Clearance slots surround solder tails;
    # actual solder-fillet dimensions still require a selected process drawing.
    spreader=box(9,124,5.5,282,50,2.0)
    spreader_tools=[cylinder(x,y,5.4,1.7,2.2) for x,y in p['frame_posts']]
    spreader_tools += [cylinder(x,y,5.4,1.7,2.2) for x,y in connector_mounts]
    spreader_tools += [cylinder(x,y,5.4,3.6,2.2) for x,y in p['pcb_mounts'] if y>124]
    for x in cart['centers_x']:
        for yy in (146.46,151.54):
            spreader_tools.append(box(x-41,yy-1.6,5.4,82,3.2,2.2))
    spreader=cut(spreader,spreader_tools)
    rail_seats=[box(x-42.5,yy-1.5,7.5,85,3,1.5)
                for x in cart['centers_x'] for yy in (143,155)]
    spreader=fuse([spreader,*rail_seats])
    m.add('cartridge_load_spreader',spreader,'steel','cartridge_structure','2.0 mm HC340LA sheet steel + welded steel rail seats',
          'A04 lower common load frame; HC340LA minimum yield 340 MPa; welded rail seats, weld process pending qualification',
          structural_role='lower frame connects socket sleeves, PCB backing rails, steel posts and rib-supported chassis')
    for idx,x in enumerate(cart['centers_x']):
        for j,yy in enumerate((143,155)):
            m.add(f'cartridge_pcb_insulator_{idx}_{j}',box(x-42.5,yy-1.5,9,85,3,1),
                  'blue','cartridge_structure','1.0 mm glass-epoxy insulating strip',
                  'A03 nominal PCB backing contact; retained by adhesive and assembly compression; grade/bond not released',
                  structural_role='insulated local PCB support; keep pads/vias off underside contact area')

    carrier=box(9,124,33,282,50,1.0)
    # Downturned flanges provide bending depth; supported every 135 mm.
    carrier=fuse([carrier,box(9,124,20,282,1,13),box(9,173,20,282,1,13),
                  box(9,124,20,1,50,13),box(290,124,20,1,50,13)])
    carrier_tools=[box(x-53,146,32,106,6,4) for x in cart['centers_x']]
    carrier_tools += [cylinder(x,y,32,1.7,4) for x,y in p['frame_posts']]
    # Clearance holes above connector mounting ears allow a tool to reach its screw.
    carrier_tools += [cylinder(x,y,20,4.2,17) for x,y in connector_mounts]
    guide_mounts=[(x+dx,y) for x in cart['centers_x'] for dx in [-50,50] for y in [132,166]]
    carrier_tools += [cylinder(x,y,32,1.7,4) for x,y in guide_mounts]
    carrier=cut(carrier,carrier_tools)
    m.add('cartridge_carrier',carrier,'steel','carrier','1.0 mm HC340LA sheet steel','A04 upper common frame; 13 mm downturned flanges; minimum yield 340 MPa',
          structural_role='carries cartridge guides and shell endstops; tied to socket load spreader by six steel posts')
    for i,(x,y) in enumerate(p['frame_posts']):
        stand=cylinder(x,y,7.5,3,25.5).cut(cylinder(x,y,7.4,1.3,25.7))
        m.add(f'carrier_standoff_{i+1}',stand,'steel','carrier_posts','steel','A03 M3 steel standoff z7.5..33, common upper/lower frame',
              structural_role='metal load path from guide carrier to socket spreader')
        # A washer spreads head bearing on the exterior of the ABS floor.
        washer=cylinder(x,y,-.8,4.5,.8).cut(cylinder(x,y,-.9,1.7,1.0))
        m.add(f'carrier_base_washer_{i+1}',washer,'steel','cartridge_structure','steel','A03 9 mm OD base load-spreading washer',
              structural_role='spreads base fastener bearing on ABS floor')
        m.add(f'carrier_base_screw_{i+1}',fuse([cylinder(x,y,-2.45,2.75,1.65),cylinder(x,y,-.8,1.5,14.3)]),
              'steel','carrier_base_screws','steel','A03 M3 smooth shank; 6 mm nominal steel thread engagement',thread_mate=f'carrier_standoff_{i+1}')
        m.add(f'carrier_top_screw_{i+1}',fuse([cylinder(x,y,34,2.75,1.65),cylinder(x,y,26,1.5,8)]),
              'steel','carrier_screws','steel','M3 smooth shank',thread_mate=f'carrier_standoff_{i+1}')

    for idx,x in enumerate(cart['centers_x']):
        y=cart['center_y']
        # Manufacturer envelope, with actual narrow card slot and mounting bores.
        conn=box(x-49.975,y-4.7,pt,99.95,9.4,15.24)
        conn=conn.cut(box(x-40.64,y-0.92,pt+15.24-8.38,81.28,1.84,9))
        conn=cut(conn,[cylinder(xx,y,pt-1,1.625,18) for xx in (x-46.675,x+46.675)])
        tails=[]
        for j in range(31):
            for yy in (146.46,151.54): tails.append(box(x-38.1+j*2.54-0.38,yy-0.23,pt-4.45,0.76,0.46,4.55))
        conn=fuse([conn,*tails])
        m.add(f'cartridge_connector_{idx}',conn,'chip','components','connector','EDAC 395-062-520-202 mechanical reference')
        for j,xx in enumerate((x-46.675,x+46.675)):
            sleeve=cylinder(xx,y,7.5,3.2,pt-7.5).cut(cylinder(xx,y,7.4,1.7,pt-7.3))
            m.add(f'cartridge_socket_sleeve_{idx}_{j}',sleeve,'steel','cartridge_structure','steel',
                  'A03 compression sleeve through 7.2 mm PCB clearance; socket bears directly on metal',
                  structural_role='socket compression bypasses PCB and former ABS screw boss')
            lower_bush=fuse([cylinder(xx,y,0,3.2,5.5),cylinder(xx,y,2.4,7,1.2)])
            lower_bush=lower_bush.cut(cylinder(xx,y,-.1,1.7,5.7))
            m.add(f'cartridge_floor_bushing_{idx}_{j}',lower_bush,'steel','cartridge_structure','steel',
                  'A04 flanged metal compression bushing: OD6.4/ID3.4, z0..5.5, OD14 flange z2.4..3.6',
                  structural_role='direct local lower socket support and inside floor bearing; 2.4 mm nominal floor grip needs tolerance qualification')
            washer=cylinder(xx,y,-1.2,7,1.2).cut(cylinder(xx,y,-1.3,1.7,1.4))
            m.add(f'cartridge_floor_washer_{idx}_{j}',washer,'steel','cartridge_structure','steel',
                  'A04 exterior 14 mm OD / 3.4 mm ID / 1.2 mm steel washer',
                  structural_role='local extraction load distributed into underside of ABS floor')
            m.add(f'cartridge_socket_nut_{idx}_{j}',nut_z(xx,y,-3.6),'steel','cartridge_structure','steel',
                  'A04 full-height M3 steel nut z-3.6..-1.2, accessible from exterior underside',
                  structural_role='local metal extraction anchor; full nominal 2.4 mm nut engagement with 0.76 mm bolt projection; grade/preload/locking need qualification')
            screw=fuse([cylinder(xx,y,26.84,2.85,1.65),cylinder(xx,y,-4.36,1.5,31.2)])
            m.add(f'cartridge_screw_{idx}_{j}',screw,'steel','cartridge_screws','steel',
                  'A04 M3 fully threaded 31.2 +/- 0.1 mm under-head procurement length, trimmed/deburred to drawing; full ordinary M3 nut, exterior floor anchor',
                  thread_mate=f'cartridge_socket_nut_{idx}_{j}')
        guide=ring(x-58,y-12,34.4,116,24,23.0,2.0,2.4)
        seat=box(x-58,y-12,34,116,24,0.4).cut(box(x-53,y-3,33.9,106,6,0.6))
        guide=fuse([guide,seat])
        for j,(xx,yy) in enumerate([(x+dx,yy) for dx in [-50,50] for yy in [132,166]]):
            lug=fuse([cylinder(xx,yy,34,4,3),box(xx-4,min(yy,160),34,8,7,3)])
            guide=fuse([guide,lug])
            guide=guide.cut(cylinder(xx,yy,33.8,1.7,4))
            m.add(f'guide_nut_{idx}_{j}',nut_z(xx,yy,30.6),'steel','guides','steel','M3 guide retaining nut')
            m.add(f'guide_screw_{idx}_{j}',fuse([cylinder(xx,yy,37,2.75,1.65),cylinder(xx,yy,30.6,1.5,6.4)]),
                  'steel','guides','steel','M3 guide retaining screw',thread_mate=f'guide_nut_{idx}_{j}')
        # The connector can be serviced with the guide still in place.
        guide=cut(guide,[cylinder(xx,y,33.8,4.2,4) for xx in (x-46.675,x+46.675)])
        # Guide opening is explicitly 111.2 x 19.2, giving 0.6 mm per side.
        from cartridge_flaps import install_flaps
        guide=install_flaps(m,guide,idx,x,y,open_angle=90 if idx==0 else 0)
        m.add(f'cartridge_guide_{idx}',guide,'abs','guides','ABS','0.6 mm nominal per-side cartridge clearance; A04 hinge bearings and motion relief')
        insertion=fuse([box(x-55,y-9,34.4,110,18,125),
                        box(x-51,y-.8,29.2,102,1.6,130.2),
                        box(x-40.4,y-.8,21.2,80.8,1.6,138.2)])
        m.keepout(f'cartridge_{idx}_insertion',insertion,'Straight withdrawal/insertion swept envelope',
                  allowed=[f'cartridge_{idx}_shell',f'cartridge_{idx}_pcb',f'cartridge_{idx}_roms',f'dust_flap_{idx}_front',f'dust_flap_{idx}_rear',
                           *(['cartridge_0_cover',*[f'cartridge_pcb_screw_{j}' for j in range(6)]] if idx==0 else [])])
        # Slot 0 populated; slot 1 closed by two hinged long-edge flaps.
        if idx==0:
            shell=rounded(x-55,y-9,34.4,110,18,75,2.0)
            shell=shell.cut(rounded(x-52.6,y-6.6,36.8,105.2,13.2,70.2,0.8))
            shell=shell.cut(box(x-51.3,y-1.2,33.9,102.6,2.4,5))
            boardcart=fuse([box(x-40.4,y-0.8,21.2,80.8,1.6,8.0),box(x-51,y-0.8,29.2,102,1.6,73.0)])
            # PCB is retained against two moulded front-half bosses.
            for j,xx in enumerate([x-43,x+43]):
                boss=cylinder_y(xx,y-6.6,93,2.5,5.8)
                shell=fuse([shell,boss])
                shell=shell.cut(cylinder_y(xx,y-6.7,93,0.8,6.0))
                boardcart=boardcart.cut(cylinder_y(xx,y-1,93,1.1,2.0))
                screw=fuse([cylinder_y(xx,y+0.8,93,1.8,1.2),cylinder_y(xx,y-5,93,1.0,5.8)])
                m.add(f'cartridge_pcb_screw_{j}',screw,'steel','cart','steel','M2 PCB screw; cartridge cover attachment not released',thread_mate='cartridge_0_shell')
            # A03 positive axial PCB capture: top-edge stops and two internal
            # notch keys carry axial reaction. All keys are well above the
            # socket screw heads; no retaining lip hangs into that head volume.
            # Strength and moulding/tolerance qualification remain open. The old
            # two M2 fixings retain the PCB in Y rather than being its sole stops.
            for xx in (x-30,x+30):
                shell=fuse([shell,box(xx-5,y-6.6,102.2,10,13.2,2)])
            boardcart=cut(boardcart,[box(x-52,y-1,48,7,2,2),
                                     box(x+45,y-1,48,7,2,2)])
            for xx in (x-52.6,x+45.2):
                shell=fuse([shell,box(xx,y-6.6,48,7.4,13.2,2)])
            # Separate, removable rear cover. The 0.10 mm parting gap is nominal;
            # four cover compression bosses provide real mating hard stops.
            front=shell.intersect(box(x-60,y-15,20,120,14.95,95))
            cover=shell.intersect(box(x-60,y+.05,20,120,14.95,95))
            cover_positions=[(x+dx,zz) for dx in (-47,47) for zz in (43,99)]
            for j,(xx,zz) in enumerate(cover_positions,2):
                front=fuse([front,cylinder_y(xx,y-6.6,zz,2.5,7.2)])
                cover=fuse([cover,cylinder_y(xx,y+.6,zz,2.5,6.0)])
                front=front.cut(cylinder_y(xx,y-6.7,zz,.8,7.4))
                cover=cut(cover,[cylinder_y(xx,y+.5,zz,1.1,8.6),
                                 cylinder_y(xx,y+7.6,zz,2.0,1.6)])
                boardcart=boardcart.cut(cylinder_y(xx,y-1,zz,2.7,2.0))
                screw=fuse([cylinder_y(xx,y+7.6,zz,1.8,1.2),
                            cylinder_y(xx,y-4.6,zz,1.0,12.2)])
                m.add(f'cartridge_pcb_screw_{j}',screw,'steel','cart','steel',
                      'A03 M2 cover screw through PCB clearance into front-half boss; flush recessed head',
                      thread_mate='cartridge_0_shell',structural_role='closes cartridge halves around positive PCB capture')
            m.add('cartridge_0_shell',front,'cart','cart','ABS',
                  'A03 front cartridge half with positive PCB top/notch stops and cover bosses',
                  structural_role='cartridge PCB axial retention and shell endstop')
            m.add('cartridge_0_cover',cover,'cart','cart','ABS',
                  'A03 removable rear cartridge half, four recessed M2 fasteners and compression hard stops',
                  structural_role='completes PCB notch capture and cartridge enclosure')
            for j in (0,1):
                m.parts[f'cartridge_pcb_screw_{j}']['basis']='A03 M2 PCB lateral retention; positive moulded stops carry nominal axial reactions'
            m.add('cartridge_0_pcb',boardcart,'pcb','cart','FR4','80.8 mm tongue derived from EDAC mating-card drawing')
            roms=[box(x-37,y+0.8,55,26,2.5,14),box(x+8,y+0.8,55,26,2.5,14)]
            m.add('cartridge_0_roms',cq.Compound.makeCompound(roms),'chip','cart','package','cartridge package space allocation')

    # ---------- Front ports and mechanically held daughterboard ----------
    fpcb=box(35,7,12,230,17,1.6)
    for x in p['front_port_x']:
        body=port_prism(x,-0.4,20,18.4,9.4,15.4,1.8)
        body=body.cut(port_prism(x,-0.6,20,14.8,5.8,10.5,1.1))
        body=fuse([body,box(x-3,14.6,13.6,6,6,2)])
        body=body.cut(cylinder(x,18,13.4,1.1,3))
        m.add(f'controller_port_{int(x)}',body,'chip','front_io','connector','proprietary mechanical envelope; electrical interface undefined')
        fpcb=fpcb.cut(cylinder(x,18,11.9,1.1,2))
        m.add(f'controller_anchor_{int(x)}',fuse([cylinder(x,18,15.6,1.8,1.2),cylinder(x,18,7,1,8.6)]),
              'steel','front_io','steel','M2 connector flange anchor to chassis',thread_mate='lower_shell')
    fpcb=cut(fpcb,[cylinder(x,21,11,1.7,4) for x in [40,150,260]])
    fpcb=fpcb.cut(cylinder(150,14,11,4.1,4))
    m.add('front_io_pcb',fpcb,'pcb','front_io','FR4','front controller board outline')
    for i,(x,y) in enumerate(front_mounts):
        m.add(f'front_pcb_screw_{i}',fuse([cylinder(x,y,13.6,2.75,1.65),cylinder(x,y,7,1.5,6.6)]),
              'steel','front_io','steel','M3 board screw',thread_mate='lower_shell')
    # Blocks intentionally keep the connector socket body above the daughterboard.
    # Lower front-board height may be adjusted by the fit checks.

    # ---------- Rear analogue and power daughterboard ----------
    rio=box(20,180,12.4,250,27,1.6)
    rio=cut(rio,[cylinder(x,184,11,1.7,5) for x in [24,142,266]])
    rio=cut(rio,[box(181.7,202.5,12,11.9,1.6,3),box(248.4,202.5,12,11.9,1.6,3)])
    rio=cut(rio,[cylinder(x,y,12,1.7,3) for x in [186,256] for y in [192,200]])
    rio=rio.cut(cylinder(150,196,12,4.1,4))
    m.add('rear_io_pcb',rio,'pcb','rear_io','FR4','rear power/peripheral/analogue-output board; unrouted')
    for i,(x,y) in enumerate(rear_mounts):
        m.add(f'rear_pcb_screw_{i}',fuse([cylinder(x,y,14,2.75,1.65),cylinder(x,y,7,1.5,7)]),
              'steel','rear_io','steel','M3 board screw',thread_mate='lower_shell')
    scart=box(194,190.6,14,54,20,16.5)
    ears=box(188.1,204,17.0,65.8,2.0,5.0)
    scart=fuse([scart,ears])
    scart=scart.cut(box(197,204.6,16,48,7,12.5))
    for j in range(10):
        # The 20 signal contacts occupy two staggered rows; shell is contact 21.
        scart=fuse([scart,box(199+j*4.4,202.2,17.0,1.1,5.5,2.0),box(199+j*4.4,202.2,23.0,1.1,5.5,2.0)])
    scart=cut(scart,[cylinder_y(x,202,19.5,1.85,8) for x in [191.8,250.2]])
    m.add('scart_socket',scart,'chip','rear_io','connector','Kycon face and mount dimensions; conservative depth')
    # Separate folded retainers capture the outside of each manufacturer's ear.
    # No oversized screw head is squeezed into the narrow ear-to-body margin.
    # The connector envelope is not carved away to make a mounting scheme fit.
    for side,x0,xs in [('left',182,186),('right',248.4,256)]:
        clip=box(x0,202.8,11.6,11.6,1.0,13.0)
        footx=182 if side=='left' else 251
        clip=fuse([clip,box(footx,188,11.6,9,15.8,0.8)])
        if side=='left':
            clip=fuse([clip,box(187.1,202.8,16.5,1.0,4.4,6.0),box(188.1,206.2,16.5,1.8,1.0,6.0)])
        else:
            clip=fuse([clip,box(253.9,202.8,16.5,1.0,4.4,6.0),box(252.1,206.2,16.5,1.8,1.0,6.0)])
        clip=cut(clip,[cylinder(xs,y,11,1.7,3) for y in [192,200]])
        m.add(f'scart_retainer_{side}',clip,'steel','rear_io','steel','1 mm folded ear clip; 0.2 mm axial capture allowance')
        for j,y in enumerate([192,200]):
            m.add(f'scart_base_screw_{side}_{j}',fuse([cylinder(xs,y,14,2.75,1.65),cylinder(xs,y,6,1.5,8)]),
                  'steel','rear_io','steel','M3 retainer and PCB clamp to base boss',thread_mate='lower_shell')
    dc=box(25.5,195.6,14,9,14.4,11)
    dc=dc.cut(cylinder_y(30,199,20.5,3.25,12))
    dc=fuse([dc,cylinder_y(30,200,20.5,1.0,9)])
    m.add('dc_in',dc,'chip','rear_io','connector','CUI PJ-102A envelope; no voltage/current selected')
    for name,x in [('keyboard_in',62),('pointer_in',88)]:
        md=box(x-7,197.1,14,14,12.9,13)
        md=md.cut(cylinder_y(x,204,20.5,5.3,7))
        m.add(name,md,'steel','rear_io','connector','Kycon KMDGX-6S-BS envelope; protocol is unspecified')
    # Rear plug and cable service spaces are explicit CAD bodies, not part of assembly mass.
    m.keepout('scart_plug_and_bend',box(186,210.6,9,70,80,35),'SCART plug and initial cable bend service volume')
    m.keepout('keyboard_plug',box(53,210,12,18,42,18),'Keyboard plug/strain relief space',allowed=['keyboard_in'])
    m.keepout('pointer_plug',box(79,210,12,18,42,18),'Pointer plug/strain relief space',allowed=['pointer_in'])
    m.keepout('dc_plug',box(24,210,15,12,40,12),'DC plug and strain relief space',allowed=['dc_in'])

    # ---------- Top controls, real through holes and internal carrier ----------
    m.add('power_slider',fuse([box(65,49.8,54.1,14,10.4,2.7),box(70,51.5,48.5,3,7,5.6),box(60,47.5,50.5,24,15,0.8)]),
          'blue','lid_controls','ABS','single slider and stem; mechanical actuation envelope')
    m.add('power_switch_envelope',box(61,49.5,40,20,11,8.5),'chip','lid_controls','switch','reserved switch dimensions',envelope_only=True)
    m.add('reset_plunger',fuse([cylinder(105,55,54.1,6.0,1.7),cylinder(105,55,45.0,2,9.1),cylinder(105,55,50.3,7.5,1.0)]),
          'lower','lid_controls','ABS','designed pushbutton plunger')
    m.add('reset_switch_envelope',box(102,52,40,6,6,5),'chip','lid_controls','switch','reserved tactile switch',envelope_only=True)
    m.add('power_led',cylinder(45,55,50.5,1.5,5.0),'led','lid_controls','LED','3 mm LED envelope')
    ctrl=box(37,43,38.4,80,25,1.6)
    ctrl=cut(ctrl,[cylinder(x,y,38,1.7,3) for x,y in [(42,46),(112,64)]])
    m.add('controls_pcb',ctrl,'pcb','lid_controls','FR4','lid-mounted switch board; unrouted')
    for i,(x,y) in enumerate([(42,46),(112,64)]):
        m.add(f'controls_screw_{i}',fuse([cylinder(x,y,36.75,2.75,1.65),cylinder(x,y,38.4,1.5,9.6)]),
              'steel','lid_controls','steel','M3 lid-board screw',thread_mate='upper_shell')
    m.add('led_leads',cq.Compound.makeCompound([cylinder(x,55,40,.25,10.5) for x in [44.2,45.8]]),
          'steel','lid_controls','copper alloy','LED lead envelope')
    return m

if __name__=='__main__':
    m=build()
    out=ROOT/'exports'; out.mkdir(exist_ok=True)
    print(f"Built {len(m.parts)} solid CAD objects",flush=True)
    (out/'parts_manifest.json').write_text(json.dumps(m.manifest(),indent=2))
    (out/'vent_geometry.json').write_text(json.dumps(m.vents,indent=2))
    m.assembly().export(str(out/'BMSX_A01_assembly.step'))
    m.assembly(explode=True).export(str(out/'BMSX_A01_exploded.step'))
    for n in ['lower_shell','upper_shell','cartridge_carrier','cartridge_guide_0']:
        cq.exporters.export(m.parts[n]['shape'],str(out/(n+'.step')))
        cq.exporters.export(m.parts[n]['shape'],str(out/(n+'.stl')),tolerance=0.12,angularTolerance=0.15)
    # Lightweight exact-part tessellations for reproducible previews and an offline viewer.
    meshes=[]
    for n,p in m.parts.items():
        verts,tris=p['shape'].tessellate(0.25,0.25)
        meshes.append({'name':n,'group':p['group'],'color':p['color'],
                       'vertices':[[v.x,v.y,v.z] for v in verts],'triangles':[list(t) for t in tris]})
    (out/'assembly_mesh.json').write_text(json.dumps(meshes,separators=(',',':')))
    print('Exports complete',flush=True)
