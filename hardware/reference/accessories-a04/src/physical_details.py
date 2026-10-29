"""A04 detailed physical features; applied to the console model before export.

These are nominal prototype solids. Contacts are a proposed proprietary contact
system, not a manufacturer-qualified connector or a KiCad pad definition.
"""
from __future__ import annotations
import cadquery as cq
import base_mechanical as b


def controller_socket_local():
    """Construct one keyed socket and its nine contacts before placement.

    The overlapping orthogonal clearance cylinders must be regularised into a
    union before subtraction. Reusing this local result also keeps nominally
    identical sockets independent of world-coordinate Boolean tolerances.
    """
    body=b.port_prism(0,-.4,20,18.4,9.4,15.4,1.8)
    body=body.cut(b.port_prism(0,-.6,20,14.8,5.8,10.5,1.1))
    body=b.fuse([body,b.box(-3,14.6,13.6,6,6,2),
                 b.box(6.6,-.4,19.4,1.2,10.4,1.2)])
    body=body.cut(b.cylinder(0,18,13.4,1.1,3))
    contacts=[];clearances=[];positions=[]
    for count,zc in [(5,18.85),(4,21.15)]:
        for j in range(count):
            xx=(j-(count-1)/2)*2.54
            contacts.append(b.fuse([
                b.cylinder_y(xx,1.4,zc,.3,12.1),
                b.cylinder(xx,13.5,13.6,.3,zc-13.6)]))
            clearances.extend([
                b.cylinder_y(xx,9.88,zc,.35,4.0),
                b.cylinder(xx,13.5,13.55,.35,zc-13.55+.05)])
            positions.append([xx,1.4,zc])
    clearance_tool=b.fuse(clearances)
    housing=body.cut(clearance_tool).clean()
    return housing,cq.Compound.makeCompound(contacts),positions


def apply(m, parameters):
    c=parameters['cooling']
    x,y,z=c['heatsink_x'],c['heatsink_y'],c['heatsink_bottom_z']
    w,d,t=c['heatsink_width'],c['heatsink_depth'],c['heatsink_base']
    fh,fw,n=c['heatsink_fin_height'],c['heatsink_fin_thickness'],c['heatsink_fin_count']
    hs=b.fuse([b.box(x,y,z,w,d,t), *[
        b.box(x+i*(w-fw)/(n-1),y,z+t,fw,d,fh) for i in range(n)]])
    mounts=[(99,54),(191,54),(99,116),(191,116)]
    hs=b.cut(hs,[b.cylinder(xx,yy,z-.1,1.7,t+.2) for xx,yy in mounts])
    hs=b.cut(hs,[b.cylinder(xx,yy,z+t,3.3,fh+.2) for xx,yy in mounts])
    # Local short fins preserve clearance to the lid control PCB and its screws.
    hs=hs.cut(b.box(80,45,34.7,39,25,30)).clean()
    m.parts['heatsink'].update(shape=hs,color=(.19,.20,.22),
        material='black-anodised aluminium extrusion, machined local relief',
        basis='A04 140 x 72 x 29 mm, 19 fins, local front-left relief; sink resistance is a qualification target',
        target_sink_to_internal_air_K_per_W=3.0,
        thermal_status='geometry is modeled; no measured thermal-resistance claim')
    posts=[b.cylinder(xx,yy,2.4,4,5.2).cut(b.cylinder(xx,yy,2.3,1.7,5.4)) for xx,yy in mounts]
    m.parts['lower_shell']['shape']=b.fuse([m.parts['lower_shell']['shape'],*posts])
    m.parts['lower_shell']['basis']='A04 nominal ABS shell; cartridge frame ribs and four hollow cooler-support bosses'

    # A small two-row keyed proprietary socket. Nine contacts carry serial data,
    # control, logic/motor power and returns; there is no USB contact tongue.
    local_housing,local_contacts,local_positions=controller_socket_local()
    for cx in parameters['front_port_x']:
        socket=m.parts[f'controller_port_{int(cx)}']
        positions=[[xx+cx,yy,zz] for xx,yy,zz in local_positions]
        socket.update(shape=local_housing.translate((cx,0,0)),material='PBT connector housing',
                      basis='A04 custom keyed 5+4 contact socket; 18.4 x 9.4 mm face, mechanical proposal',
                      contact_count=9,interface='BMSX serial pad; electrically not USB',
                      contact_positions_front_mm=positions)
        m.add(f'controller_contacts_{int(cx)}',local_contacts.translate((cx,0,0)),
              'gold','front_io','plated copper-alloy contact proposal',
              'A04 nine complete bent contact envelopes, 2.54 mm row pitch; contact force/plating/footprint qualification open')

    # Actual plated edge area and label thickness are part of the cartridge stack.
    cx=parameters['cartridges']['centers_x'][0];cy=parameters['cartridges']['center_y']
    fingers=[]
    for j in range(31):
        xx=cx-38.1+j*2.54
        for yy in (cy-.835,cy+.800):
            fingers.append(b.box(xx-.7,yy,22.0,1.4,.035,6.6))
    m.add('cartridge_0_fingers',cq.Compound.makeCompound(fingers),'gold','cart',
          'copper plus nickel/hard-gold finish, 35 um geometric metal reserve',
          '62 contact lands; conductor thickness is an allocation, not specified gold thickness',contact_count=62)
    m.add('cartridge_0_label',b.box(cx-50,cy-9.10,60,100,.10,45),'blue','cart',
          'printed label and adhesive, total 0.10 mm',
          '100 x 45 mm Pietsona label zone; original game art is specified in the design dossier')
    m.parts['dc_in']['basis']='A04 Same Sky PJ-002AH 5 A mechanical envelope reference, 9 x 14.4 x 11 mm; period design equivalent required'
    m.parts['dc_in'].update(rated_current_A=5.0,input_voltage_V=9.0,source_url='https://www.sameskydevices.com/product/resource/pj-002ah.pdf')
    for name in ['keyboard_in','pointer_in']:
        m.parts[name].update(basis='Mini-DIN-6 envelope; A04 PS/2 clock/data electrical proposal',interface='5 V PS/2 clock/data')
    return m
