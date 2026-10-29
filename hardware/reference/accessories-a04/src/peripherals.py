#!/usr/bin/env python3
"""BMSX A04 detached keyboard and purchased external power-module envelopes.

All displayed solids are exported to STEP. Keyboard dimensions and mechanisms
are explicit design allocations, not claims of a manufactured keyboard.
"""
from __future__ import annotations
from pathlib import Path
import json,math,hashlib,itertools
from io import BytesIO
import cadquery as cq
from base_mechanical import Model,box,rounded,cylinder,cylinder_y,fuse,cut
ROOT=Path(__file__).resolve().parents[1]
PITCH=19.05
ANGLE=3.0
TILT=lambda s:s.rotate((0,0,0),(1,0,0),ANGLE)


def keyboard_layout():
 rows=[
  [('Esc',1),('',.25)]+[(f'F{i}',1) for i in range(1,5)]+[('',.25)]+[(f'F{i}',1) for i in range(5,9)]+[('',.25)]+[(f'F{i}',1) for i in range(9,13)]+[('',.25),('Ins',1),('Del',1)],
  [(c,1) for c in ['`','1','2','3','4','5','6','7','8','9','0','-','=']]+[('Back',2),('Home',1)],
  [('Tab',1.5)]+[(c,1) for c in 'QWERTYUIOP']+[('[',1),(']',1),('\\',1.5),('PgUp',1)],
  [('Caps',1.75)]+[(c,1) for c in 'ASDFGHJKL']+[(';',1),("'",1),('Enter',2.25),('PgDn',1)],
  [('Shift',2.25)]+[(c,1) for c in 'ZXCVBNM']+[(',',1),('.',1),('/',1),('Shift',1.75),('Up',1),('End',1)],
  [('Ctrl',1.25),('Alt',1.25),('Space',6.25),('Alt',1.25),('Menu',1),('Ctrl',1),('Fn',1),('Left',1),('Down',1),('Right',1)]
 ]
 keys=[]
 for row,items in enumerate(rows):
  offset=0
  assert abs(sum(u for _,u in items)-16)<1e-8
  for label,u in items:
   if label:
    keys.append({'index':len(keys),'label':label,'row':row,'u':u,'center':[22.6+(offset+u/2)*PITCH,128.0-row*PITCH],'size':[u*PITCH-1.3,17.75]})
   offset+=u
 assert len(keys)==83
 return keys


def keycap(key):
 x,y=key['center'];w,d=key['size']
 cap=rounded(x-w/2,y-d/2,24,w,d,7,.85)
 cap=cap.cut(rounded(x-w/2+1.2,y-d/2+1.2,23.9,w-2.4,d-2.4,5.9,.35))
 stem=fuse([cylinder(x,y,18,2.2,11.8),cylinder(x,y,17.3,3.1,.7)])
 # Nominal two-leg return-stop flexure; mould release/strain remains a gate.
 stem=stem.cut(box(x-.35,y-3.2,17.2,.7,6.4,5.0))
 return fuse([cap,stem])


def cable_geometry(p0):
 # Loose serpentine avoids visual coiling intersections; all radii are 25 mm.
 a=math.radians(ANGLE);direction=cq.Vector(0,math.cos(a),math.sin(a))
 p0=cq.Vector(*p0)
 r=30.0;theta0=a;drop=p0.z-4.5
 theta1=-math.acos((math.cos(theta0)+1-drop/r)/2)
 def first(theta):return p0+cq.Vector(0,r*(math.sin(theta0)-math.sin(theta)),r*(math.cos(theta)-math.cos(theta0)))
 turn=first(theta1)
 def second(theta):return turn+cq.Vector(0,r*(math.sin(theta)-math.sin(theta1)),r*(-math.cos(theta)+math.cos(theta1)))
 end=second(0)
 lead_edges=[cq.Edge.makeThreePointArc(p0,first((theta0+theta1)/2),turn),cq.Edge.makeThreePointArc(turn,second(theta1/2),end),cq.Edge.makeLine(end,cq.Vector(175,235,4.5))]
 lead=cq.Wire.assembleEdges(lead_edges)
 edges=[cq.Edge.makeLine(cq.Vector(175,235,4.5),cq.Vector(175,635,4.5))]
 def arc(x,y,up):
  return cq.Edge.makeThreePointArc(cq.Vector(x,y,4.5),cq.Vector(x+25,y+25*up,4.5),cq.Vector(x+50,y,4.5))
 edges += [arc(175,635,1),cq.Edge.makeLine(cq.Vector(225,635,4.5),cq.Vector(225,285,4.5)),arc(225,285,-1),cq.Edge.makeLine(cq.Vector(275,285,4.5),cq.Vector(275,635,4.5)),arc(275,635,1),cq.Edge.makeLine(cq.Vector(325,635,4.5),cq.Vector(325,285,4.5)),arc(325,285,-1)]
 used=lead.Length()+sum(e.Length() for e in edges)
 final=2000.0-used
 assert final>0
 endpoint=cq.Vector(375,285+final,4.5)
 edges.append(cq.Edge.makeLine(cq.Vector(375,285,4.5),endpoint))
 lead_wire=lead;rest_wire=cq.Wire.assembleEdges(edges)
 leadsolid=cq.Workplane(cq.Plane(origin=p0,xDir=(1,0,0),normal=direction)).circle(2).sweep(cq.Workplane(obj=lead_wire),isFrenet=True).val()
 restsolid=cq.Workplane(cq.Plane(origin=(175,235,4.5),xDir=(1,0,0),normal=(0,1,0))).circle(2).sweep(cq.Workplane(obj=rest_wire),isFrenet=True).val()
 return leadsolid,restsolid,endpoint,lead.Length()+rest_wire.Length()


def build_keyboard():
 m=Model();keys=keyboard_layout();mounts=[(17,17),(175,17),(333,17),(17,141),(215,141),(333,141)]
 casefix=[(10,10),(175,8),(340,10),(10,147),(215,148),(340,147)]
 lower=rounded(0,0,0,350,155,10,9).cut(rounded(2.4,2.4,2.4,345.2,150.2,20,6.6))
 lower=fuse([lower,rounded(1.8,1.8,9.6,346.4,151.4,2.4,7.2).cut(rounded(3.6,3.6,9.5,342.8,147.8,2.6,5.4))])
 upper=rounded(0,0,10.3,350,155,13.7,9).cut(rounded(2.4,2.4,10.2,345.2,150.2,11.4,6.6))
 upper=upper.cut(rounded(21,19,19,308,121,12,2))
 upper=upper.cut(rounded(1.6,1.6,10.2,346.8,151.8,2.1,7.4).cut(rounded(3.8,3.8,10.1,342.4,147.4,2.3,5.2)))
 for x,y in mounts:
  lower=fuse([lower,cylinder(x,y,2.4,3.5,7.6)])
  lower=lower.cut(cylinder(x,y,4,1.0,8))
 for x,y in casefix:
  lower=fuse([lower,cylinder(x,y,2.4,3.2,7.6)])
  lower=lower.cut(cylinder(x,y,-1,1.4,12))
  upper=fuse([upper,cylinder(x,y,10,2.8,11.6)])
  upper=upper.cut(cylinder(x,y,9.9,1.0,10))
 # Six cross-ribs meet the backing-sheet underside; placed outside the circuit field.
 for x in (70,125,225,280):
  lower=fuse([lower,box(x-.6,12,2.4,1.2,133,7.6)])
 cablehole=cylinder_y(175,150,7.5,3.2,8)
 lower=lower.cut(cablehole);upper=upper.cut(cablehole)
 # Two retaining bosses for the jacket clamp; load never relies on solder joints.
 for x in (168,182):
  lower=fuse([lower,cylinder(x,147,2.4,2.3,5.1)])
  lower=lower.cut(cylinder(x,147,3.5,.8,6))
 # Controller-card supports under the main key module.
 controller_mounts=[(147,121),(195,121),(147,138),(195,138)]
 for x,y in controller_mounts:
  lower=fuse([lower,cylinder(x,y,2.4,2.2,1.6)])
  lower=lower.cut(cylinder(x,y,2.8,.8,2.5))
 m.add('keyboard_lower_shell',TILT(lower),'lower','keyboard_case','ABS','2.4 mm nominal shell with module and cable clamp supports')
 m.add('keyboard_upper_shell',TILT(upper),'abs','keyboard_case','ABS','2.4 mm nominal shell; mould draft and ejection details pending')
 plate=box(14,14,10,322,130,.8)
 plate=cut(plate,[cylinder(x,y,9.9,1.4,1.1) for x,y in mounts])
 m.add('keyboard_backing_plate',TILT(plate),'steel','keyboard_structure','0.8 mm zinc-coated low-carbon steel','full backing plate; nominal stiffness, no tapping/drop test')
 layers=[('insulator',10.8,.125,'PET dielectric'),('bottom_circuit',10.925,.125,'PET with printed silver/carbon contacts'),('spacer',11.05,.1,'adhesive PET spacer, contact apertures'),('top_circuit',11.15,.125,'PET with printed silver/carbon contacts')]
 for label,z,h,material in layers:
  layer=box(20,19,z,310,119,h)
  layer=cut(layer,[*[cylinder(x,y,z-.1,3.6,h+.2) for x,y in mounts],box(146,115,z-.1,28,4,h+.2)])
  if label=='spacer':layer=cut(layer,[cylinder(*k['center'],z-.1,3.5,h+.2) for k in keys])
  m.add('keyboard_'+label,TILT(layer),(0.74,0.79,0.68) if 'circuit' in label else (0.79,0.82,0.84),'keyboard_membrane',material,'mechanical layer; printed traces are a routing requirement, not drawn copper')
 mat=box(20,19,11.275,310,119,.8)
 mat=cut(mat,[*[cylinder(x,y,11.1,3.6,1.3) for x,y in mounts],box(146,115,11.1,28,4,1.3)])
 # Domes are hollow cones with closed tops; free height 5.225 mm above the sheet.
 for k in keys:
  x,y=k['center']
  dome=cq.Solid.makeCone(5.7,2.3,5.225,cq.Vector(x,y,12.075))
  dome=dome.cut(cq.Solid.makeCone(4.9,1.8,4.625,cq.Vector(x,y,12.074)))
  mat=fuse([mat,dome])
  mat=mat.cut(box(x-5.8,y-.25,11.2,5.8,.5,.95))
 m.add('keyboard_dome_sheet',TILT(mat),(0.69,0.75,0.77),'keyboard_switches','silicone rubber, provisional 50 Shore A','83 hollow domes with air channels; 3.5 mm travel target, force and fatigue not qualified')
 # Barrel frame carries independent guide sleeves, separated from flexible domes.
 frame=box(14,14,18,322,130,2)
 barrels=[];holes=[]
 for k in keys:
  x,y=k['center'];barrels.append(cylinder(x,y,18,3.8,7));holes.append(cylinder(x,y,17.9,2.4,7.3))
 frame=fuse([frame,*barrels])
 for x,y in mounts:
  frame=fuse([frame,cylinder(x,y,10.8,3.2,7.2)])
  holes.append(cylinder(x,y,10.7,1.4,9.5))
 frame=cut(frame,holes)
 m.add('keyboard_barrel_frame',TILT(frame),'abs','keyboard_structure','ABS','7 mm guide length; 0.2 mm nominal radial stem clearance; return-stop flexure needs tooling check')
 for k in keys:
  col=(0.70,0.71,0.70) if k['row'] in (1,2,3,4) and k['u']==1 else (0.33,0.35,0.38)
  if k['label']=='Enter':col=(0.12,.28,.61)
  m.add(f"key_{k['index']:02d}_{k['label'].replace('/','slash').replace(chr(92),'backslash')}",TILT(keycap(k)),col,'keyboard_keys','ABS','hollow 1.2 mm cap with split return-stop stem; legends applied after moulding',key=k)
  if k['u']>=2:
   # Wire envelope with actual separate bearing brackets; final cap clips remain open.
   x,y=k['center'];half=(k['size'][0]-10)/2
   rr=2.5;zz=22.5
   A=cq.Vector(x-half,y-3,zz);B=cq.Vector(x-half,y+5.2-rr,zz);C=cq.Vector(x-half+rr,y+5.2,zz)
   D=cq.Vector(x+half-rr,y+5.2,zz);E=cq.Vector(x+half,y+5.2-rr,zz);F=cq.Vector(x+half,y-3,zz)
   q=rr/math.sqrt(2)
   mid1=cq.Vector(x-half+rr-q,y+5.2-rr+q,zz);mid2=cq.Vector(x+half-rr+q,y+5.2-rr+q,zz)
   wire=cq.Wire.assembleEdges([cq.Edge.makeLine(A,B),cq.Edge.makeThreePointArc(B,mid1,C),cq.Edge.makeLine(C,D),cq.Edge.makeThreePointArc(D,mid2,E),cq.Edge.makeLine(E,F)])
   stabilizer=cq.Workplane(cq.Plane(origin=A,xDir=(1,0,0),normal=(0,1,0))).circle(.6).sweep(cq.Workplane(obj=wire),isFrenet=False).val()
   m.add(f"key_stabilizer_{k['index']:02d}",TILT(stabilizer),'steel','keyboard_stabilizers','1.2 mm spring-steel wire','wire route allocation for large key; cap clips, bearing details and travel not production released',envelope_only=True)
 for i,(x,y) in enumerate(mounts):
  screw=fuse([cylinder(x,y,20,2.25,1.3),cylinder(x,y,4,1.25,16)])
  m.add(f'keyboard_module_screw_{i}',TILT(screw),'steel','keyboard_fasteners','steel','M2.5 screw through frame and backing plate into base boss',thread_mate='keyboard_lower_shell')
 for i,(x,y) in enumerate(casefix):
  screw=fuse([cylinder(x,y,-1.3,2.2,1.3),cylinder(x,y,0,1.25,17)])
  m.add(f'keyboard_case_screw_{i}',TILT(screw),'steel','keyboard_fasteners','steel','M2.5 case screw from underside',thread_mate='keyboard_upper_shell')
 controller=box(144,118,4,54,24,1.0)
 controller=cut(controller,[cylinder(x,y,3.9,1.1,1.2) for x,y in controller_mounts])
 m.add('keyboard_controller_pcb',TILT(controller),'pcb','keyboard_electronics','FR4','5 V keyboard scan controller; 8x11 matrix allocation')
 m.add('keyboard_controller_asic',TILT(box(165,123,5,10,10,2.5)),'chip','keyboard_electronics','QFP44 envelope','period-compatible mask-programmed controller class, no part number selected')
 m.add('keyboard_membrane_connector',TILT(box(150,119,5,23,4,2.5)),'chip','keyboard_electronics','FFC clamp envelope','19 matrix signals plus reference contact; 0.8 mm pitch mechanical allocation')
 # Flexible circuit tail folds through a dedicated backing-plate window.
 window=box(145,115,9.9,31,3.0,1.1)
 m.parts['keyboard_backing_plate']['shape']=TILT(plate.cut(window))
 tail=fuse([box(147,115.8,5.5,25,.2,5.55),box(147,116,5.5,25,3,.2),box(147,116,10.925,25,3,.125)])
 m.add('keyboard_membrane_tail',TILT(tail),(0.67,.72,.65),'keyboard_membrane','PET printed flex','folded tail allocation through steel window; bend radius and individual conductor artwork pending')
 for i,(x,y) in enumerate(controller_mounts):
  m.add(f'keyboard_controller_screw_{i}',TILT(fuse([cylinder(x,y,5,1.7,1.1),cylinder(x,y,2.8,1,2.2)])),'steel','keyboard_fasteners','steel','M2 nominal card screw',thread_mate='keyboard_lower_shell')
 clamp=box(164,144,7.5,22,6,4.5).cut(cylinder_y(175,143.9,7.5,2.2,6.2))
 clamp=cut(clamp,[cylinder(x,147,7.4,1.1,4.7) for x in (168,182)])
 m.add('keyboard_cable_clamp',TILT(clamp),'lower','keyboard_structure','ABS','two-screw jacket clamp; prevents cable pulls reaching controller solder joints')
 for i,x in enumerate((168,182)):
  m.add(f'keyboard_clamp_screw_{i}',TILT(fuse([cylinder(x,147,12,1.7,1.1),cylinder(x,147,3.5,1,8.5)])),'steel','keyboard_fasteners','steel','M2 clamp screw',thread_mate='keyboard_lower_shell')
 boot=fuse([cylinder_y(175,150,7.5,3.1,5),cylinder_y(175,155,7.5,3.8,20)])
 m.add('keyboard_cable_boot',TILT(boot),'rubber','keyboard_cable','flexible PVC/TPE','captive neck in shell; 20 mm flexible strain relief')
 m.add('keyboard_internal_cable',TILT(cylinder_y(175,140,7.5,2,10)),'rubber','keyboard_cable','4-core stranded shielded PVC cable','4 mm outer diameter; chassis jacket clamp before board termination')
 # Stance has 3 degrees slope. Feet are actual wedges with horizontal undersides.
 for i,(x,y) in enumerate([(30,12),(175,22),(320,12),(30,137),(175,137),(320,137)]):
  foot=rounded(x-7,y-5,-2,14,10,16,3)
  foot=foot.cut(TILT(box(-20,-20,0,390,210,40)))
  m.add(f'keyboard_foot_{i}',foot,'rubber','keyboard_feet','rubber','fixed 3 degree stance; wedge tops conform to inclined lower shell')
 a=math.radians(ANGLE);p0=[175,175*math.cos(a)-7.5*math.sin(a),175*math.sin(a)+7.5*math.cos(a)]
 lead,cable,ep,length=cable_geometry(p0)
 m.add('keyboard_cable_drop',lead,'rubber','keyboard_cable','4 mm shielded PVC cable','first section of the same 2.0 m free cable')
 m.add('keyboard_cable_2m',cable,'rubber','keyboard_cable_full','4 mm shielded PVC cable','remaining cable laid in a loose serpentine; minimum illustrated bend radius 25 mm')
 plug=fuse([cylinder_y(ep.x,ep.y,ep.z,4.5,16),cylinder_y(ep.x,ep.y+16,ep.z,5.8,20),cylinder_y(ep.x,ep.y+36,ep.z,4.6,8)])
 # Plug contact region is an envelope; pin numbering is in the electrical contract.
 plug=plug.cut(cylinder_y(ep.x,ep.y+36,ep.z,3.8,8.1))
 m.add('keyboard_minidin_plug',plug,'lower','keyboard_cable_full','overmoulded mini-DIN-6 plug','mechanical allocation, keyed insert/contact positions require selected manufacturer drawing')
 return m,keys,length


def build_adapter():
 m=Model()
 # Purchased module: do not infer isolation/creepage or approval from these solids.
 body=rounded(0,0,0,105,60,42,5)
 lower=body.intersect(box(-1,-1,-1,107,62,21.0))
 upper=body.intersect(box(-1,-1,20.3,107,62,22.0))
 for n,s in [('adapter_lower',lower),('adapter_upper',upper)]:m.add(n,s,'lower','adapter','purchased insulated enclosure','105 x 60 x 42 mm procurement envelope for a regulated 9 V 3 A external supply',envelope_only=True)
 label=rounded(15,12,42,75,36,.12,2)
 m.add('adapter_rating_label',label,(.16,.17,.19),'adapter','printed label','9 V DC / 3 A / center-positive requirement, approval marks intentionally absent')
 # C8-style appliance input is a location envelope, no pins or mains circuitry released.
 inlet=box(8,-.4,11,20,10,12)
 inlet=inlet.cut(fuse([cylinder_y(14,-.5,17,3.0,7),cylinder_y(22,-.5,17,3.0,7)]))
 m.parts['adapter_lower']['shape']=lower.cut(box(7.7,-1,10.7,20.6,11.4,12.6))
 m.parts['adapter_upper']['shape']=upper.cut(box(7.7,-1,10.7,20.6,11.4,12.6))
 m.add('adapter_ac_inlet_envelope',inlet,'chip','adapter','connector envelope','commercial certified supply to be selected; inlet shown only for external mating-space allocation',envelope_only=True)
 boot=cylinder_y(80,60,18,4.1,24)
 m.add('adapter_dc_strain_relief',boot,'rubber','adapter','PVC/TPE','2 m low-voltage lead, 0.75 mm2 each conductor per power contract')
 m.add('adapter_dc_lead_excerpt',cylinder_y(80,84,18,2.5,100),'rubber','adapter','2x0.75 mm2 cable','100 mm CAD excerpt; specified full cable 2 m, no mains lead model')
 for i,(x,y) in enumerate([(15,10),(90,10),(15,50),(90,50)]):m.add(f'adapter_foot_{i}',cylinder(x,y,-2,4.5,2),'rubber','adapter','rubber','nominal module feet')
 return m


def export_model(m,label):
 out=ROOT/'exports';out.mkdir(exist_ok=True)
 solids=sum(len(p['shape'].Solids()) for p in m.parts.values())
 volume=sum(p['shape'].Volume() for p in m.parts.values())
 pre_valid=all(p['shape'].isValid() and p['shape'].Volume()>0 for p in m.parts.values())
 assert pre_valid, 'Invalid or negative physical BRep before export'
 ass=cq.Assembly(name='BMSX_A04_'+label)
 for n,p in m.parts.items():ass.add(p['shape'],name=n,color=cq.Color(*p['color']))
 path=out/f'BMSX_A04_{label}.step';ass.export(str(path))
 (out/f'{label}_manifest.json').write_text(json.dumps(m.manifest(),indent=2)+'\n')
 meshes=[]
 for n,p in m.parts.items():
  vs,ts=p['shape'].tessellate(.18,.2)
  meshes.append({'name':n,'group':p['group'],'color':p['color'],'vertices':[[v.x,v.y,v.z] for v in vs],'triangles':[list(t) for t in ts]})
 (out/f'{label}_mesh.json').write_text(json.dumps(meshes,separators=(',',':')))
 # The export is reimported to verify topology/count/volume, not ignored.
 imported=cq.importers.importStep(str(path)).val()
 record={'parts':len(m.parts),'solids':solids,'all_brep_valid':pre_valid,'all_post_mesh_brep_valid':all(p['shape'].isValid() for p in m.parts.values()),'step_valid':imported.isValid(),'step_solids':len(imported.Solids()),'volume_mm3':volume,'step_volume_mm3':imported.Volume(),'relative_volume_error':abs(imported.Volume()-volume)/max(1,volume),'source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
 (ROOT/'analysis'/f'{label}_export_check.json').write_text(json.dumps(record,indent=2)+'\n')
 return record


def main():
 m,keys,length=build_keyboard()
 r=export_model(m,'keyboard')
 a=build_adapter();ar=export_model(a,'adapter')
 design={'revision':'BMSX-A04-PERIPHERALS','keyboard_case_nominal_mm':[350,155,24],'keyboard_key_top_local_z_mm':31,'keyboard_stance_angle_deg':3,'keyboard_keys':83,'key_pitch_mm':19.05,'key_travel_target_mm':3.5,'keys':keys,'free_cable_length_mm':length,'cable_outer_diameter_mm':4.0,'minimum_illustrated_bend_radius_mm':25.0,'keyboard_max_power_reservation_W':.4,'matrix':'8 rows x 11 columns, 19 scan signals','interface':'PS/2 mini-DIN-6, 5 V open collector clock/data, pin1 data/pin3GND/pin4+5V/pin5clock/pins2&6NC','adapter_output_requirement':'regulated 9 V DC, 3 A, center-positive 5.5/2.1 mm barrel plug','adapter_max_body_mm':[105,60,42],'adapter_dc_cable_requirement':'2 m, 2 x 0.75 mm2 stranded conductors','assembly_limits':['Key stem flexure/snap retention, cap stability and dome force curve are unqualified.','Stabilizer wire, controller ASIC, membrane connector and mini-DIN plug are mechanical allocations.','Controller schematic, membrane conductor artwork and anti-ghosting policy are not released.','Mould draft, ejectors, runners, texture and production tolerances require final tool drawings.','External adapter is a purchased module envelope; no mains circuit or approvals are represented.'],'verification':{'keyboard_export':r,'adapter_export':ar}}
 (ROOT/'research/A04_peripherals_design.json').write_text(json.dumps(design,indent=2)+'\n')
 print(json.dumps({'keyboard':r,'adapter':ar,'cable_mm':length},indent=2),flush=True)
if __name__=='__main__':main()
