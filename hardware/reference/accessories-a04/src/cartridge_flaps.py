"""A04 long-edge cartridge shutters, actual hinge solids and a spring allocation.

The torsion coil is a physical reserved volume for a custom wire spring.
Leg geometry, contact preload and fatigue remain a spring-supplier gate.
Kinematic sampling verifies rigid nominal solids, not insertion-force or life.
"""
from __future__ import annotations
import cadquery as cq


def cyl_x(x,y,z,r,length):
    return cq.Solid.makeCylinder(r,length,cq.Vector(x,y,z),cq.Vector(1,0,0))


def flap_geometry(x,y,side):
    from base_mechanical import box,fuse,cut
    direction=1 if side=='front' else -1
    ay=y-direction*10.7; az=58.5
    body=box(x-55.1,ay+1.5 if direction==1 else ay-10.3,az-.5,110.2,8.8,1.0)
    arms=[];knuckles=[]
    for dx,length in [(-51,8),(-5,10),(43,8)]:
        arms.append(box(x+dx,ay if direction==1 else ay-1.6,az-.5,length,1.6,1))
        knuckles.append(cyl_x(x+dx,ay,az,1.25,length))
    shape=fuse([body,*arms,*knuckles])
    shape=cut(shape,[cyl_x(x-56,ay,az,.7,112),cyl_x(x+33.8,ay,az,1.55,2.8)])
    return shape,(ay,az),direction


def install_flaps(m,guide,idx,x,y,open_angle=0):
    from base_mechanical import box,fuse,cut
    # A shallow full-length pocket receives each leaf when it is vertical.
    # It is in the guide wall, outside the 110 x 18 mm cartridge envelope.
    for side in ('front','rear'):
        closed,(ay,az),direction=flap_geometry(x,y,side)
        guide=cut(guide,[box(x-55.35,ay-.72 if direction==1 else ay-1.78,47.5,110.7,2.5,11.4),
                         cyl_x(x+33.6,ay,az,1.65,3.2)])
        bearings=[]
        for dx,length in [(-57.8,2.0),(-30,4),(26,4),(55.8,2.0)]:
            bearing=cyl_x(x+dx,ay,az,1.3,length)
            # Outer wall webs join the bearing to the existing guide, clear
            # of the moving leaf's inner quarter-circle.
            web_y=ay-1.4 if direction==1 else ay+1.0
            bearing=fuse([bearing,box(x+dx,web_y,55.5,length,.4,3.0)])
            bearing=bearing.cut(cyl_x(x+dx-.1,ay,az,.7,length+.2))
            bearings.append(bearing)
        guide=fuse([guide,*bearings])
        leaf=closed.rotate((x,ay,az),(x+1,ay,az),-direction*open_angle)
        m.add(f'dust_flap_{idx}_{side}',leaf,'lower','cartridge_shutters','ABS',
              'A04 1 mm leaf with interleaved hinge barrels, 1.4 mm bores and 90 degree travel',
              motion_axis=[1,0,0],motion_axis_point=[x,ay,az],angle_deg=open_angle,
              closed_to_open_sign=-direction,nominal_leaf_thickness_mm=1.0)
        pin=fuse([cyl_x(x-57.9,ay,az,.6,115.8),
                  cyl_x(x-58.25,ay,az,.85,.35),cyl_x(x+57.9,ay,az,.85,.35)])
        m.add(f'dust_flap_pin_{idx}_{side}',pin,'steel','cartridge_shutters','stainless steel',
              'A04 1.2 mm hinge pin, formed retaining ends; nominal 0.1 mm radial running clearance')
        helix=cq.Wire.makeHelix(.4,2.4,1.2,cq.Vector(x+34,ay,az),cq.Vector(1,0,0))
        start=helix.Vertices()[0].Center()
        coil=(cq.Workplane('YZ',origin=start.toTuple()).circle(.15)
              .sweep(cq.Workplane(obj=helix),isFrenet=True).val())
        m.add(f'dust_flap_spring_{idx}_{side}',coil,'steel','cartridge_shutters','spring steel',
              'A04 custom torsion-spring coil allocation: wire 0.30 mm, mean diameter 2.4 mm, six turns; legs and stops pending',
              envelope_only=True,wire_diameter_mm=.30,mean_coil_diameter_mm=2.4,active_turns=6,
              requires_qualification='spring leg seats, preload, force curve, fatigue and moulded bearing tolerances')
    return guide
