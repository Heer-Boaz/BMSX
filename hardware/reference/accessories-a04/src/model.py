"""BMSX A04: compact local-memory and system-controller placement.

All dimensions are millimetres. This is a mechanical placement hypothesis,
not an electrically released schematic or a demonstrably implementable ASIC.
The original A01 and A02 are preserved in their own directories. Interconnect geometry is
generated separately by interconnect.py and is never implied by package leads.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path
import cadquery as cq
import base_mechanical as base
import physical_details

ROOT = Path(__file__).resolve().parents[1]
PARAMS = json.loads((ROOT / "src/parameters.json").read_text())
COLORS = base.COLORS
box, cylinder, fuse, cut = base.box, base.cylinder, base.fuse, base.cut

REFERENCE_SOURCES = {
    "QFP208": "https://ww1.microchip.com/downloads/aemDocuments/documents/corporate-responsibilty/environmental/material-compliance-documents/208L_QFP_28x28x3_4mm_C.pdf",
    "SOJ42": "https://www.datasheets.com/issi/IS41LV16100C-50TLI/datasheet.pdf",
    "SGRAM100": "https://dosdays.co.uk/media/samsung/KM4132G271A.PDF",
    "SOJ40": "https://www.ardent-tool.com/datasheets/Micron_MT4C16257.pdf",
    "QFP144": "https://www.renesas.com/en/package/pkg87",
}

# These positions are a deliberate floorplan rather than free-space filling.
# Package rotations describe mechanical orientation only, not assigned ASIC pins.
FLOORPLAN = {
    "revision": "BMSX-A04-FLOORPLAN",
    "units": "mm",
    "status": "electrical-topology-informed placement; electrical routing/timing not released",
    "components": {
        "U1_CPU_GTE": {"center_xy": [125,82], "rotation_deg": 0, "cluster": "CPU_SYSTEM_MAIN_RAM"},
        "U4_SYS_DMAC": {"center_xy": [89,82], "rotation_deg": 0, "cluster": "CPU_SYSTEM_MAIN_RAM"},
        "U10_MAIN_RAM_L": {"center_xy": [60,56], "rotation_deg": 90, "cluster": "CPU_SYSTEM_MAIN_RAM"},
        "U11_MAIN_RAM_H": {"center_xy": [60,88], "rotation_deg": 90, "cluster": "CPU_SYSTEM_MAIN_RAM"},
        "U3_GEO": {"center_xy": [77,121], "rotation_deg": 0, "cluster": "SYSTEM_BUS_MASTERS"},
        "U7_IMGDEC": {"center_xy": [38,111], "rotation_deg": 0, "cluster": "SYSTEM_BUS_MASTERS"},
        "U2_GPU": {"center_xy": [172,82], "rotation_deg": 0, "cluster": "GPU_LOCAL_VRAM"},
        "U12_VRAM_L": {"center_xy": [205,69], "rotation_deg": 90, "cluster": "GPU_LOCAL_VRAM"},
        "U13_VRAM_H": {"center_xy": [205,97], "rotation_deg": 90, "cluster": "GPU_LOCAL_VRAM"},
        "U6_PCRTC": {"center_xy": [236,76], "rotation_deg": 0, "cluster": "DISPLAY_OUTPUT"},
        "U5_APU": {"center_xy": [235,112], "rotation_deg": 0, "cluster": "APU_PRIVATE_RAM"},
        "U14_AUDIO_RAM": {"center_xy": [263,112], "rotation_deg": 90, "cluster": "APU_PRIVATE_RAM"},
        "U8_IO": {"center_xy": [75,45], "rotation_deg": 0, "cluster": "PERIPHERAL_INPUT"},
        "JE_CONTROLS": {"center_xy": [212,31], "rotation_deg": 0, "cluster": "LID_CONTROLS"},
        "RN_BUS1": {"center_xy": [107,78], "rotation_deg": 0, "cluster": "CPU_SYSTEM_MAIN_RAM"},
        "RN_BUS2": {"center_xy": [107,86], "rotation_deg": 0, "cluster": "CPU_SYSTEM_MAIN_RAM"},
        "RN_BUS3": {"center_xy": [191,80], "rotation_deg": 0, "cluster": "GPU_LOCAL_VRAM"},
        "RN_BUS4": {"center_xy": [191,84], "rotation_deg": 0, "cluster": "GPU_LOCAL_VRAM"},
    },
    "topology_intent": {
        "main_ram": "U4 owns one 32-bit main bank; two adjacent 1Mx16 packages carry separate D15:0 and D31:16 lanes with shared address/control",
        "video_ram": "U2 east-side corridor feeds one shared32-bit trunk with two short branches to rotated 1MiB address-bank packages; separate chip selects",
        "system": "U4 next to CPU and main RAM; GEO/IMGDEC nearby; slower or lower-duty remote device links are not allowed to displace local memory",
        "audio": "retain APU and its private512KiB RAM as a compact local pair",
        "mechanical": "CPU/GPU centres and cooler mounts retained because both local-memory clusters fit coherently around them",
        "controls": "move main lid header away from centre-front screw/tool envelope; long low-current harness accepts this mechanical tradeoff",
    },
    "unvalidated": ["actual ASIC electrical pin assignment", "PCB trace/via escape and signal integrity", "memory/DMA timing closure", "thermal performance and converter losses"],
}

def placement(name):
    return FLOORPLAN['components'][name]['center_xy']


def add_component(m, name, shape, *, functions, board="main", voltage=None,
                  package="design allocation", basis="explicit design assumption",
                  pins=None, **extra):
    color = extra.pop("color", "chip")
    group = "electronics_" + board
    ref = name.split('_',1)[0] if re.match(r'^[A-Z]+[0-9]+_', name) else name
    if name in FLOORPLAN['components']:
        extra.setdefault('floorplan_cluster',FLOORPLAN['components'][name]['cluster'])
    m.add(name, shape, color, group, "electronic component", basis,
          ref=ref, functions=functions, board=board,
          voltage_V=voltage, package=package, electrical_status="placement hypothesis; no circuit validation",
          **extra)
    bb = shape.BoundingBox()
    record = {"name": name, "ref": ref, "functions": functions,
              "board": board, "voltage_V": voltage, "package": package, "basis": basis,
              "bbox_min": [bb.xmin, bb.ymin, bb.zmin], "bbox_max": [bb.xmax, bb.ymax, bb.zmax],
              "center_xy": [(bb.xmin+bb.xmax)/2, (bb.ymin+bb.ymax)/2],
              "pin_coordinates_status": "mechanical terminals only; electrical pin assignment remains a hypothesis",
              "pins": pins or [], **extra}
    m.component_records.append(record)
    return shape


def qfp(m, name, cx, cy, body=(28,28), span=(30.85,30.85), height=4.10,
        edge_counts=(52,52), pitch=0.5, z=11.6, *, functions, voltage=3.3,
        package="QFP208", basis="package envelope and explicitly assumed function allocation", rotation=0, **extra):
    bw, bd = body; sw, sd = span; nx, ny = edge_counts
    stand = min(0.40, height*0.18)
    body_shape=box(cx-bw/2,cy-bd/2,z+stand,bw,bd,height-stand)
    pieces=[body_shape]; pins=[]; pin_number=1
    lead_w=min(0.24,pitch*0.42); lead_t=0.18
    # Rectangular gull-wing envelope: a board contact and a rising inner heel.
    # The maximum package dimensions, including leads, are the checked envelope.
    for side in ["south","east","north","west"]:
        n=nx if side in ("south","north") else ny
        for j in range(n):
            t=(j-(n-1)/2)*pitch
            if side=="south":
                px,py=cx+t,cy-sd/2
                pieces += [box(px-lead_w/2,py,z,lead_w,(sd-bd)/2+.16,lead_t),
                           box(px-lead_w/2,cy-bd/2-.12,z,lead_w,.28,stand+.12)]
            elif side=="north":
                px,py=cx-t,cy+sd/2
                pieces += [box(px-lead_w/2,cy+bd/2-.16,z,lead_w,(sd-bd)/2+.16,lead_t),
                           box(px-lead_w/2,cy+bd/2-.16,z,lead_w,.28,stand+.12)]
            elif side=="east":
                px,py=cx+sw/2,cy+t
                pieces += [box(cx+bw/2-.16,py-lead_w/2,z,(sw-bw)/2+.16,lead_w,lead_t),
                           box(cx+bw/2-.16,py-lead_w/2,z,.28,lead_w,stand+.12)]
            else:
                px,py=cx-sw/2,cy-t
                pieces += [box(px,py-lead_w/2,z,(sw-bw)/2+.16,lead_w,lead_t),
                           box(cx-bw/2-.12,py-lead_w/2,z,.28,lead_w,stand+.12)]
            pins.append({"mechanical_pin_index":pin_number,"side":side,"position_mm":[px,py,z]})
            pin_number+=1
    shape=fuse(pieces)
    if rotation:
        shape=shape.rotate((cx,cy,0),(cx,cy,1),rotation)
        theta=math.radians(rotation);sides=['south','east','north','west']
        for pin in pins:
            px,py,pz=pin['position_mm'];dx,dy=px-cx,py-cy
            pin['position_mm']=[cx+dx*math.cos(theta)-dy*math.sin(theta),cy+dx*math.sin(theta)+dy*math.cos(theta),pz]
            pin['package_side_before_rotation']=pin['side']
            if rotation%90==0:pin['side']=sides[(sides.index(pin['side'])+round(rotation/90))%4]
    return add_component(m,name,shape,functions=functions,voltage=voltage,package=package,
                         basis=basis,pins=pins,pin_budget=2*(nx+ny),
                         body_mm=list(body),lead_span_mm=list(span),height_above_board_mm=height,
                         rotation_deg=rotation,mechanical_pin_numbering="design sequence, not a manufacturer electrical pinout",**extra)


def so_package(m, name, cx, cy, length=27.43, body_width=10.29, span=11.33,
               height=3.76, pin_count=42, pitch=1.27, rotation=0, z=11.6,
               *, functions, voltage=3.3, package="SOJ42", basis="mechanical reference", **extra):
    stand=.25; pieces=[box(-length/2,-body_width/2,z+stand,length,body_width,height-stand)]
    pins=[]
    for j in range(pin_count//2):
        x=(j-(pin_count//2-1)/2)*pitch
        for side in [-1,1]:
            yy=-span/2 if side==-1 else body_width/2-.15
            pieces.append(box(x-.20,yy,z,.40,(span-body_width)/2+.15,.35))
            px,py=x,side*span/2
            theta=math.radians(rotation)
            pins.append({"mechanical_pin_index":len(pins)+1,"position_mm":[cx+px*math.cos(theta)-py*math.sin(theta),cy+px*math.sin(theta)+py*math.cos(theta),z]})
    shape=fuse(pieces).rotate((0,0,0),(0,0,1),rotation).translate((cx,cy,0))
    return add_component(m,name,shape,functions=functions,voltage=voltage,package=package,
                         basis=basis,pins=pins,pin_budget=pin_count,rotation_deg=rotation,**extra)


def smd_rect(m,name,cx,cy,w,d,h,z=11.6,*,functions,board="main",voltage=None,
             package="SMT design envelope",basis="explicit support-component allocation",**extra):
    return add_component(m,name,box(cx-w/2,cy-d/2,z,w,d,h),functions=functions,board=board,
                         voltage=voltage,package=package,basis=basis,**extra)


def header(m,name,cx,cy,rows,columns,board,z,pitch=2.54,height=6,mating_axis=0,**extra):
    w=(columns-1)*pitch+5; d=(rows-1)*pitch+4
    body=box(cx-w/2,cy-d/2,z,w,d,height)
    if mating_axis:
        # Side-entry shroud and L-shaped terminals. The selected housing and
        # its contact system remain a generic discrete-wire crimp allocation.
        cavity_y=cy-d/2+1 if mating_axis>0 else cy-d/2-.1
        body=body.cut(box(cx-w/2+1,cavity_y,z+1,w-2,d-.9,height-2))
    else:
        body=body.cut(box(cx-w/2+1,cy-d/2+1,z+height-2,w-2,d-2,2.1))
    pins=[]; shapes=[body]
    for row in range(rows):
        for col in range(columns):
            x=cx+(col-(columns-1)/2)*pitch; y=cy+(row-(rows-1)/2)*pitch
            if mating_axis:
                pin_z=z+height/2+(row-(rows-1)/2)*pitch
                mouth_y=cy+mating_axis*(d/2-.5)
                shapes.append(box(x-.32,y-.32,z,.64,.64,pin_z-z+.32))
                shapes.append(box(x-.32,min(y,mouth_y)-.32,pin_z-.32,
                                  .64,abs(mouth_y-y)+.64,.64))
                pin_position=[x,mouth_y,pin_z]
            else:
                shapes.append(box(x-.32,y-.32,z,.64,.64,height-.5))
                pin_position=[x,y,z+height-.5]
            pins.append({"mechanical_pin_index":len(pins)+1,"position_mm":pin_position})
    return add_component(m,name,fuse(shapes),functions=["internal harness termination"],board=board,
                         voltage="net-dependent",package=f"{rows}x{columns} discrete-wire crimp header allocation",
                         basis="connector envelope and pin-count allocation; mating SKU and pinout unselected",
                         pins=pins,pin_budget=rows*columns,
                         mating_direction=[0,mating_axis,0] if mating_axis else [0,0,1],
                         terminal_geometry="right-angle L-shaped" if mating_axis else "vertical",
                         harness_type="discrete insulated wires with crimp contacts",**extra)


def regulator_to263(m,name,cx,cy,rail,z=11.6):
    # Conservative 11 x 18 x 5 mm TO-263-5 reserve. Five exposed leads and the
    # thermal tab are present; an LM2576 implementation still needs an electrical
    # design, component selection and loss calculation.
    pieces=[box(cx-5.5,cy-7,z+.2,11,10,4.8),box(cx-5,cy-9,z,10,11,.3)]
    pins=[]
    for i in range(5):
        x=cx+(i-2)*1.7
        pieces += [box(x-.4,cy+2.85,z,.8,6.15,.2),box(x-.4,cy+2.85,z,.8,.4,1.0)]
        pins.append({'mechanical_pin_index':i+1,'position_mm':[x,cy+9,z]})
    return add_component(m,name,fuse(pieces),functions=[f'9 V to {rail} V conversion'],
                         voltage={'input':9.0,'output':rail},package='TO-263-5 conservative 11x18x5 reserve',
                         basis='TI LM2576 package-class reference; converter topology/current/components not released',
                         source_url='https://www.ti.com/lit/ds/symlink/lm2576.pdf',pins=pins,pin_budget=5,
                         tab_status='conductive thermal tab; electrical node to be fixed by selected datasheet')


def _bbox_collision(a,b,margin=.2):
    aa=a.BoundingBox();bb=b.BoundingBox()
    return (aa.xmin < bb.xmax+margin and aa.xmax > bb.xmin-margin and
            aa.ymin < bb.ymax+margin and aa.ymax > bb.ymin-margin and
            aa.zmin < bb.zmax-1e-6 and aa.zmax > bb.zmin+1e-6)


def add_decoupling(m, targets):
    placements=[]; rejected=[]; count=0
    # Two-terminal 0603 bodies; individually placed with actual geometry.
    # Capacity/ESR/count is a physical allocation, not power-integrity validation.
    for target in targets:
        shape=m.parts[target]["shape"]; b=shape.BoundingBox()
        cx=(b.xmin+b.xmax)/2;cy=(b.ymin+b.ymax)/2
        offsets=[(-.28,-1),(.28,-1),(-.28,1),(.28,1),(-1,-.28),(-1,.28),(1,-.28),(1,.28)]
        local=0
        for u,v in offsets:
            if abs(u)==1:
                x=(b.xmin-1.9) if u<0 else (b.xmax+1.9);y=cy+v*(b.ymax-b.ymin)
            else:
                x=cx+u*(b.xmax-b.xmin);y=(b.ymin-1.9) if v<0 else (b.ymax+1.9)
            s=box(x-.8,y-.45,11.6,1.6,.9,.9)
            if x<21.3 or x>278.7 or y<28.0 or y>170.9:continue
            blockers=[]
            for n,p in m.parts.items():
                if n in ("main_pcb","lower_shell"):continue
                if _bbox_collision(s,p['shape'],margin=.35):blockers.append(n)
            if blockers:
                rejected.append({"target":target,"xy":[x,y],"blockers":blockers});continue
            count+=1;local+=1
            name=f"C_D{count:03d}_{target.split('_')[0]}"
            smd_rect(m,name,x,y,1.6,.9,.9,functions=["local bypass allocation"],voltage=3.3,
                     package="0603",nominal_capacitance="100 nF design allocation; value and count not validated",
                     assigned_to=target,color="steel")
            placements.append(name)
        if local<3:
            m.placement_warnings.append(f"Only {local} automatic decoupling reserves around {target}; review exact pin allocation.")
    m.decoupling_report={"placed_count":len(placements),"skipped_candidates":rejected,
                         "status":"explicit local package placement, no PDN/ERC validation"}


def build():
    m=base.build();m.component_records=[];m.placement_warnings=[]
    removed=["cpu_package","gpu_package","cpu_package_tim","gpu_package_tim","io_asic_envelope",
             "bios_rom_envelope","dc_regulator_envelope"]
    removed += [f"memory_envelope_{i}" for i in range(1,8)]
    removed += [f"filter_capacitor_{i}" for i in range(1,5)]
    for name in removed:m.parts.pop(name)

    # QFP208 total height 4.10 mm conservatively exceeds the 4.07 mm reference max.
    # Retain CPU/GPU centres; move the common cooler to suit the corrected stack.
    dz=2.7;pt=11.6;hs_base=16.7
    m.parts['heatsink']['shape']=m.parts['heatsink']['shape'].translate((0,0,dz))
    m.parts['heatsink']['basis']='A04 retained common sink; base z16.7, QFP package height reserve 4.1 + TIM 1.0; thermal performance unvalidated'
    sink_mounts=[(99,54),(191,54),(99,116),(191,116)]
    for i,(x,y) in enumerate(sink_mounts):
        m.parts[f'heatsink_spacer_{i+1}']['shape']=cylinder(x,y,pt,2.5,hs_base-pt).cut(cylinder(x,y,pt-.1,1.7,hs_base-pt+.2))
        head_z=hs_base+3
        m.parts[f'heatsink_screw_{i+1}']['shape']=fuse([cylinder(x,y,head_z,2.75,1.65),cylinder(x,y,7.6,1.5,head_z-7.6)])
        m.parts[f'heatsink_spacer_{i+1}']['basis']='A04 retained rigid 5.1 mm spacer; contact preload remains unvalidated'

    qfp(m,'U1_CPU_GTE',*placement('U1_CPU_GTE'),functions=['BLua32 CPU','GTE','GTE_PLUS'],
        basis='Microchip QFP208 mechanical reference; fictitious CPU/GTE ASIC allocation',source_url=REFERENCE_SOURCES['QFP208'],
        nominal_clock_Hz=33868800,courtyard_mm=[32,32],integration_assumption='GTE and GTE_PLUS integrated into CPU ASIC; not separately validated silicon')
    qfp(m,'U2_GPU',*placement('U2_GPU'),functions=['GPU drawing engine','GPU command/readback FIFOs','local VRAM controller'],
        basis='Microchip QFP208 mechanical reference; fictitious GPU ASIC allocation',source_url=REFERENCE_SOURCES['QFP208'],courtyard_mm=[32,32])
    for n,x in [('U1_CPU_GTE',125),('U2_GPU',172)]:
        m.add(n+'_TIM',box(x-13,69,15.7,26,26,1),'tim','thermal','thermal pad','A04 nominal 1 mm TIM; compression and contact pressure unvalidated')
    qfp(m,'U3_GEO',*placement('U3_GEO'),body=(28,28),span=(32,32),edge_counts=(36,36),pitch=.65,
        functions=['GEO XFORM2_BATCH','GEO SAT2_BATCH','GEO OVERLAP2D_PASS','main RAM master'],package='QFP144 conservative 32 mm allocation',
        basis='Conservative fictitious ASIC package allocation; not a selected Sony chip',scratch_bytes_within_main_ram=524288)
    qfp(m,'U4_SYS_DMAC',*placement('U4_SYS_DMAC'),functions=['memory controller','bus arbitration','DMA channel 0','DMA channel 1','IRQ controller','SYSTEM','cartridge decoder/select'],
        basis='Microchip QFP208 reference; explicitly combined system ASIC',source_url=REFERENCE_SOURCES['QFP208'],
        integration_assumption='Two equivalent programmable DMA channels share one controller datapath, plus IRQ/SYSTEM/CART/memory arbitration')
    qfp(m,'U5_APU',*placement('U5_APU'),body=(28,28),span=(32,32),edge_counts=(36,36),pitch=.65,
        functions=['16 playback slots','stereo mixer','fixed sample FIFO transfer engine','sample RAM controller','ROM playback access'],
        package='QFP144 conservative 32 mm allocation',basis='Fictitious APU ASIC package; fixed transfer engine is inside APU',
        sample_frame_Hz=44100,fixed_transfer_words_per_second=1058400)
    qfp(m,'U6_PCRTC',*placement('U6_PCRTC'),body=(28,28),span=(32.4,32.4),edge_counts=(40,40),pitch=.65,
        functions=['two VRAM reading circuits','display composition','beam timing','display IRQ events'],
        package='QFP160 conservative allocation',basis='Fictitious standalone PCRTC ASIC, 32.4 mm package reserve',
        nominal_reference_Hz=13500000,shared_memory='same 2 MiB VRAM as GPU; no added overlay RAM')
    qfp(m,'U7_IMGDEC',*placement('U7_IMGDEC'),body=(14,14),span=(18,18),height=3.2,edge_counts=(25,25),pitch=.5,
        functions=['image decompressor','32-word input FIFO','64-word output FIFO','4096-word history'],
        package='QFP100 allocation',basis='Fictitious standalone image decoder; FIFO/history storage allocated inside ASIC')
    qfp(m,'U8_IO',*placement('U8_IO'),body=(10,10),span=(12,12),height=2.0,edge_counts=(16,16),pitch=.5,
        functions=['keyboard sampler','pointer sampler','four gamepad record samplers','vibration output control'],
        package='QFP64 allocation',basis='Fictitious input ASIC; external serial protocols are design assumptions')

    for name,lane in [('U10_MAIN_RAM_L','D[15:0]'),('U11_MAIN_RAM_H','D[31:16]')]:
        so_package(m,name,*placement(name),rotation=FLOORPLAN['components'][name]['rotation_deg'],functions=['main RAM'],basis='ISSI IS41LV16100C 1Mx16 EDO geometry and capacity reference; timing unvalidated',
                   source_url=REFERENCE_SOURCES['SOJ42'],capacity_bytes=2097152,organization='1M x 16',
                   memory_role='one 32-bit main-RAM bank',bit_lane=lane,total_bank_bytes=4194304)
    for name,bank in [('U12_VRAM_L',0),('U13_VRAM_H',1)]:
        qfp(m,name,*placement(name),rotation=FLOORPLAN['components'][name]['rotation_deg'],body=(20.1,14.1),span=(23.4,17.4),height=1.4,edge_counts=(30,20),pitch=.65,
            functions=['GPU/PCRTC VRAM'],package='Samsung SGRAM QFP100',
            basis='Samsung KM4132G271A August 1997 mechanical/capacity reference; shared-bus timing unvalidated',
            source_url=REFERENCE_SOURCES['SGRAM100'],capacity_bytes=1048576,organization='128K x 32 x 2 internal banks',
            board_bank=bank,memory_role='two devices share D[31:0], independently selected address banks',
            name_suffix_meaning='L/H denote address bank 0/1, NOT 16-bit bit-lanes',total_bank_bytes=2097152)
    so_package(m,'U14_AUDIO_RAM',*placement('U14_AUDIO_RAM'),length=26.7,body_width=10.3,span=11.4,height=3.9,pin_count=40,rotation=FLOORPLAN['components']['U14_AUDIO_RAM']['rotation_deg'],
               functions=['private APU sample RAM'],package='SOJ40 256Kx16 allocation',
               basis='Micron MT4C16257 mechanical envelope plus allowance; 3.3 V electrical part selection remains open',
               source_url=REFERENCE_SOURCES['SOJ40'],capacity_bytes=524288,organization='256K x 16',
               selected_electrical_part=None)
    so_package(m,'U15_SYSTEM_ROM',120,130,length=28,body_width=12.5,span=14,height=4,pin_count=32,pitch=1.27,
               functions=['system BIOS ROM'],package='parallel ROM envelope',
               basis='ROM package/capacity design reserve; no final firmware byte count or memory SKU',
               capacity_bytes=None,address_window_bytes=16777216,capacity_note='16 MiB address window does not specify installed ROM capacity')

    # Named support-component placements. Values and interfaces remain hypotheses.
    smd_rect(m,'X1_SYSTEM_CLOCK',144,44,11.3,4.7,4.5,functions=['33.8688 MHz clock reference'],voltage=3.3,package='oscillator envelope',frequency_Hz=33868800)
    smd_rect(m,'X2_VIDEO_CLOCK',260,81,11.3,4.7,4.5,functions=['13.5 MHz PCRTC reference'],voltage=3.3,package='oscillator envelope',frequency_Hz=13500000)
    so_package(m,'U22_RESET_SUPERVISOR',56,36,length=5,body_width=4,span=6,height=1.75,pin_count=8,pitch=1.27,
               functions=['power-on reset','reset supervision'],package='SOIC8 allocation',basis='reset support circuit not selected')
    so_package(m,'U23_CLOCK_BUFFER',162,51,length=13,body_width=5.3,span=8,height=1.75,pin_count=20,pitch=1.27,
               functions=['clock distribution'],package='SOIC20 allocation',basis='eight-output clock buffer pin-budget reserve; fanout/skew unvalidated',
               output_budget=8)
    for name,x,y in [('U24_CART0_XCVR',46,132),('U25_CART1_XCVR',177,134)]:
        so_package(m,name,x,y,length=13,body_width=6.1,span=8.1,height=1.5,pin_count=48,pitch=.5,
                   functions=['cartridge bus buffering'],package='TSSOP48 allocation',basis='bus buffers reserved; cartridge protocol and pinout not released')
    so_package(m,'U26_PERIPHERAL_LEVELS',104,162,length=6.5,body_width=4.4,span=8.1,height=1.5,pin_count=20,pitch=.65,
               functions=['keyboard/pointer level interface'],package='TSSOP20 allocation',basis='3.3/5 V interface reserve',voltage='3.3/5')
    so_package(m,'U27_PAD_LINE_BUFFER',210,17,length=6.5,body_width=4.4,span=6.4,height=1.5,pin_count=20,pitch=.65,z=13.6,
               functions=['controller serial line buffering'],package='TSSOP20 allocation',basis='front board interface reserve',board='front')

    # Converters and analogue drive on MAIN: the rear board receives analogue AV.
    qfp(m,'U30_VIDEO_DAC',201,132,body=(7,7),span=(9,9),height=1.6,edge_counts=(12,12),pitch=.5,
        functions=['digital RGB to analogue RGB'],package='QFP48 video DAC allocation',basis='RGB DAC package/pin budget reserve; no selected circuit')
    so_package(m,'U31_RGB_DRIVER',217,134,length=10,body_width=4,span=6,height=1.75,pin_count=16,pitch=1.27,
               functions=['RGB output filters and line drive','SCART RGB level interface'],voltage=5,
               package='SOIC16 allocation',basis='analogue output-stage reserve; 75-ohm network not validated')
    so_package(m,'U32_AUDIO_DAC',263,135,length=13,body_width=5.3,span=8,height=1.75,pin_count=20,pitch=1.27,
               functions=['stereo audio DAC'],voltage=5,package='SOIC20 allocation',basis='audio DAC support-component reserve')
    so_package(m,'U33_AUDIO_FILTER',244,134,length=6,body_width=4,span=7,height=1.75,pin_count=8,pitch=1.27,
               functions=['stereo reconstruction filtering','audio output buffer'],voltage=5,
               package='SOIC8 allocation',basis='analogue filter/buffer reserve')

    # A04 dual synchronous buck proposal, supported by a 1993 controller family.
    for name,x,y,rail in [('U20_REG3V3',111,45.5,3.3),('U21_REG5V',178.5,44.5,5.0)]:
        so_package(m,name,x,y,length=8.75,body_width=3.9,span=6,height=1.75,pin_count=14,pitch=1.27,
                   functions=[f'9 V to {rail} V conversion'],voltage={'input':9.0,'output':rail},
                   package='SOIC14 LTC1148 controller class',basis='Linear Technology LTC1148 family, February 1993; component-level circuit proposal, not validated',
                   source_url='https://www.analog.com/media/en/technical-documentation/data-sheets/1148fd.pdf')
    for name,x,L,Isat in [('L1_REG3V3_INDUCTOR',129,47,6),('L2_REG5V_INDUCTOR',194,68,4)]:
        smd_rect(m,name,x,38,18,18,10,functions=['converter inductor reserve'],package='18 x 18 x 10 mm procurement envelope',
                 basis='A04 inductance/current specification; catalogue match within this envelope still required',voltage='converter switching node',
                 inductance_uH=L,minimum_saturation_current_A=Isat)
    for name,x,y in [('Q20P',119,51),('Q20N',129,51),('Q21P',181,53),('Q21N',200,53)]:
        so_package(m,name,x,y,length=5,body_width=4,span=6,height=1.75,pin_count=8,pitch=1.27,
                   functions=['synchronous buck power MOSFET'],voltage='9 V switching stage',package='SOIC8 MOSFET class',
                   basis='A04 complementary MOSFET implementation reserve; selected Rds_on/gate-charge qualification required')
    smd_rect(m,'D2_CATCH_3V3',139,56,4.6,3.6,2.6,functions=['3.3 V buck freewheel diode'],voltage='converter switching node',package='SMB Schottky allocation')
    smd_rect(m,'D3_CATCH_5V',216,50,4.6,3.6,2.6,functions=['5 V buck freewheel diode'],voltage='converter switching node',package='SMB Schottky allocation')
    for name,x,y,R in [('R20_CURRENT_SENSE',140,51,.033),('R21_CURRENT_SENSE',210,51,.05)]:
        smd_rect(m,name,x,y,6.3,3.2,.8,functions=['buck current sense, Kelvin connections required'],voltage='low-side sense',
                 package='2512 power resistor reserve',resistance_ohm=R,color='steel')
    for name,x,y,uF,V in [('C100_INPUT_BULK',111,33,470,16),('C104_INPUT_BULK',178.5,33,470,16),
                          ('C101_3V3_BULK',161,35,1000,10),('C102_5V_BULK',209,40,1000,10)]:
        add_component(m,name,cylinder(x,y,pt,5,20),functions=['buck bulk filtering'],voltage=V,package='radial low-ESR electrolytic procurement envelope 10 x 20 mm',
                      basis='A04 electrical value and mechanical procurement reserve; ESR/ripple/catalogue match remains open',capacitance_uF=uF,color='blue')
    for name,x,y in [('CT20',109,51),('CT21',174,49.5),('CC20',111,51),('CC21',172,49.5)]:
        smd_rect(m,name,x,y,1.6,.9,.9,functions=['buck timing or compensation'],voltage='controller signal',
                 package='0603 control passive',basis='330 pF timing or compensation reserve; values in electrical proposal',color='steel')
    smd_rect(m,'F1_INPUT_FUSE',43,195,8,4,3,z=14,board='rear',functions=['input overcurrent protection reserve'],voltage=9,package='SMT fuse envelope')
    so_package(m,'Q1_REVERSE_PROTECTION',45,202,length=5,body_width=4,span=6,height=1.75,pin_count=8,pitch=1.27,z=14,board='rear',functions=['input polarity/transient protection reserve'],voltage=9,package='SOIC8 P-MOSFET reserve',basis='A04 low-loss reverse-polarity input proposal; Rds_on <= 40 milliohm target')
    add_component(m,'C103_INPUT_REAR',cylinder(47,188,14,3.2,8),functions=['DC input bulk filtering'],board='rear',voltage='rating TBD',
                  package='radial capacitor envelope 6.4x8',basis='input capacitor reserve; electrical value unselected',color='blue')

    smd_rect(m,'R_SHDN',62,31,2.0,1.25,1.0,functions=['shutdown pullup'],voltage='9 V standby through 2.2 kohm',package='0805 resistor',resistance_ohm=2200,color='steel')
    smd_rect(m,'D_SHDN',66,31,3.5,2.0,1.2,functions=['shutdown voltage clamp'],voltage=3.3,package='SOD123 zener reserve',basis='A04 SHDN clamp proposal, 3.3 V at standby bias; edges require validation')

    headers=[('JE_FRONT',89,31,2,10,'main',11.6,0),('JE_FRONT_PEER',89,19,2,10,'front',13.6,0),
             ('JE_REAR_DIGITAL',70,165,2,8,'main',11.6,1),('JE_REAR_DIGITAL_PEER',70,190,2,8,'rear',14,-1),
             ('JE_AV',235,165,2,8,'main',11.6,1),('JE_AV_PEER',166,190,2,8,'rear',14,-1),
             ('JE_POWER',37,163,1,3,'main',11.6,1),('JE_POWER_PEER',37,190,1,3,'rear',14,-1),
             ('JE_CONTROLS',*placement('JE_CONTROLS'),1,5,'main',11.6,0),('JE_CONTROLS_PEER',93,46,1,5,'lid',40,-1)]
    for n,x,y,rows,cols,board,z,axis in headers:
        header(m,n,x,y,rows,cols,board,z,mating_axis=axis)
        if n in ['JE_POWER','JE_POWER_PEER']:
            m.parts[n].update(basis='A04 4 A/contact 2.54 mm crimp-connector class; final right-angle SKU and thermal rating qualification required',continuous_design_A=3.0,harness_wire='AWG22, maximum100 mm each conductor')

    for i,(x,y) in enumerate([(83,10),(140,9),(203,9),(260,10)]):
        smd_rect(m,f'U_ESD_PAD{i}',x,y,3,3,1,z=13.6,board='front',functions=['controller line ESD reserve'],
                 package='4-line ESD array allocation',voltage='3.3 V signal')
    for i,(x,y) in enumerate([(54,191),(91,191)]):
        smd_rect(m,f'U_ESD_REAR{i}',x,y,3,3,1,z=14,board='rear',functions=['keyboard/pointer ESD reserve'],
                 package='ESD array allocation',voltage='5 V peripheral signal')
    for i,(x,y) in enumerate([(202,140),(207,140),(214,140),(219,140),(240,140),(245,140),(250,140),(255,140)]):
        smd_rect(m,f'RN_AV{i+1}',x,y,3,1.6,1,functions=['AV termination/filter network reserve'],
                 package='SMT network allocation',voltage='analogue',color='steel')
    for i,(x,y) in enumerate([placement('RN_BUS1'),placement('RN_BUS2'),placement('RN_BUS3'),placement('RN_BUS4')]):
        smd_rect(m,f'RN_BUS{i+1}',x,y,3,1.6,1,functions=['bus/clock series termination reserve'],
                 package='SMT resistor network allocation',voltage=3.3,color='steel')

    add_decoupling(m,['U1_CPU_GTE','U2_GPU','U3_GEO','U4_SYS_DMAC','U5_APU','U6_PCRTC',
                      'U7_IMGDEC','U8_IO','U10_MAIN_RAM_L','U11_MAIN_RAM_H','U12_VRAM_L','U13_VRAM_H','U14_AUDIO_RAM'])
    physical_details.apply(m,PARAMS)
    m.parts['main_pcb']['basis']='A04 compact local-memory/system clusters; PCB is unrouted mechanical FR4 outline'
    m.parts['rear_io_pcb']['basis']='A04 analogue AV / DC / peripheral rear board; unrouted mechanical outline'
    m.parts['front_io_pcb']['basis']='A04 four pad sockets, line buffer, protection and harness; unrouted mechanical outline'
    m.placement_summary={
        'revision':PARAMS['revision'],
        'floorplan':FLOORPLAN,
        'logic_allocation':'CPU+GTE; GPU; GEO; SYS/DMAC/IRQ/CART; APU+fixed FIFO transfer; PCRTC; IMGDEC; I/O',
        'memory_bytes':{'main':4194304,'vram':2097152,'audio':524288},
        'main_ram_topology':'2x 1Mx16 in parallel as one 32-bit bank',
        'vram_topology':'2x 1MiB, both on shared 32-bit data bus; separate chip selects; timing unvalidated',
        'geo_scratch':'512 KiB reserved inside main RAM, no additional physical RAM',
        'rom_capacity':'TBD; 16 MiB is address window only',
        'rails':'9 V/3 A external adapter; dual LTC1148-class synchronous buck, 3.3 V/3 A and 5 V/2 A design ratings; circuit proposal not electrically released',
        'thermal_change':'4.1 mm CPU/GPU packages, 1 mm TIM, common 140x72x29 sink base16.7/top45.7 mm; local front-left relief and support bosses',
        'electrical_release':False,
        'limitations':['ASIC electrical pinouts are not defined by the BMSX programming documentation',
                       'Package pin counts are design budgets, not proven ASIC implementations',
                       'No PCB pad stack or routed electrical netlist is implied by this MCAD',
                       'Support components, local bypass values/counts, power losses, contact pressure and timing require electrical engineering']}
    return m


def export_model(m):
    out=ROOT/'exports';out.mkdir(exist_ok=True)
    (out/'parts_manifest.json').write_text(json.dumps(m.manifest(),indent=2))
    (out/'component_manifest.json').write_text(json.dumps({'summary':m.placement_summary,'components':m.component_records,
        'decoupling':m.decoupling_report,'warnings':m.placement_warnings},indent=2))
    (out/'vent_geometry.json').write_text(json.dumps(m.vents,indent=2))
    m.assembly().export(str(out/'BMSX_A04_assembly.step'))
    for name in ['lower_shell','upper_shell','heatsink','cartridge_carrier','cartridge_load_spreader']:
        cq.exporters.export(m.parts[name]['shape'],str(out/(name+'.step')))
    carts=cq.Assembly(name='BMSX_A04_cartridges')
    for n,p in m.parts.items():
        if p['group']=='cart':
            carts.add(p['shape'],name='Pietsona_'+n,color=cq.Color(*p['color']))
            carts.add(p['shape'].translate((130,0,0)),name='Pietious_'+n,color=cq.Color(*p['color']))
    carts.export(str(out/'BMSX_A04_cartridges.step'))
    e=cq.Assembly(name='BMSX_A04_electronics')
    for n,p in m.parts.items():
        if p['group'].startswith('electronics_') or n in ['main_pcb','front_io_pcb','rear_io_pcb','controls_pcb']:
            e.add(p['shape'],name=n,color=cq.Color(*p['color']))
    e.export(str(out/'BMSX_A04_electronics.step'))
    meshes=[]
    for n,p in m.parts.items():
        verts,tris=p['shape'].tessellate(.22,.25)
        meshes.append({'name':n,'group':p['group'],'color':p['color'],
                       'vertices':[[v.x,v.y,v.z] for v in verts],'triangles':[list(t) for t in tris]})
    (out/'assembly_mesh.json').write_text(json.dumps(meshes,separators=(',',':')))
    # A genuine BRep section through a CPU package and cartridge fixing.
    slab=box(131.625,-5,-10,.1,220,140)
    sections=[]
    for n,p in m.parts.items():
        bb=p['shape'].BoundingBox()
        if bb.xmin>131.725 or bb.xmax<131.625: continue
        cut_shape=p['shape'].intersect(slab)
        if cut_shape.Volume()<1e-6: continue
        v,t=cut_shape.tessellate(.04,.12)
        sections.append({'name':n,'group':p['group'],'color':p['color'],'vertices':[[a.x,a.y,a.z] for a in v],'triangles':[list(a) for a in t]})
    (out/'section_mesh.json').write_text(json.dumps(sections,separators=(',',':')))
    (out/'section_manifest.json').write_text(json.dumps({'section_x_mm':131.675,'slab_thickness_mm':.1,'method':'exact BRep intersection','parts':[p['name'] for p in sections]},indent=2))
    print(json.dumps({'parts':len(m.parts),'components':len(m.component_records),'decoupling':m.decoupling_report['placed_count'],'warnings':m.placement_warnings}),flush=True)


if __name__=='__main__':
    model=build()
    export_model(model)
