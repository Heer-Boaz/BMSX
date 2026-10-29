"""Connected installed torsion-return wire and its actual rotating-leg allocation.

A geometric spring proposal, not a force/fatigue-qualified supplier component.
The left-hand winding gains turns as the leaf turns inward; the body contracts
while the fixed and rotating ends remain connected. A formed bridge passes the
lower journal through a real outer-quadrant machining allowance.
"""

import math

import cadquery as cq
from geometry import box, cylinder


def build_return_spring(axis_y, axis_z, angle_degrees):
    angle = math.radians(angle_degrees)
    turns = 4 + angle_degrees / 360
    radius = 4.4 / turns
    wire_radius = 0.125
    helix = cq.Wire.makeHelix(1.4 / turns, 1.4, radius, lefthand=True)
    helix = helix.rotate((0, 0, 0), (0, 1, 0), 90).translate((108.5, axis_y, axis_z))
    profile = (
        cq.Workplane(cq.Plane(origin=helix.startPoint(), normal=helix.tangentAt(0)))
        .circle(wire_radius)
        .val()
    )
    coil = cq.Solid.sweep(profile, [], helix, makeSolid=True, isFrenet=True)
    start, end = helix.startPoint(), helix.endPoint()
    fixed_points = [start.toTuple(), (108.5, axis_y, axis_z - 3)]
    moving_points = [
        end.toTuple(),
        (109.9, axis_y - 2.4 * math.sin(angle), axis_z - 2.4 * math.cos(angle)),
        (112.45, axis_y - 2.4 * math.sin(angle), axis_z - 2.4 * math.cos(angle)),
        (112.45, axis_y - 1.1 * math.sin(angle), axis_z - 1.1 * math.cos(angle)),
        (113.7, axis_y - 1.1 * math.sin(angle), axis_z - 1.1 * math.cos(angle)),
    ]
    legs = []
    for points in [fixed_points, moving_points]:
        for a, b in zip(points, points[1:]):
            direction = cq.Vector(*b) - cq.Vector(*a)
            legs.append(cylinder(a, direction.toTuple(), wire_radius, direction.Length))
        legs.extend(cq.Solid.makeSphere(wire_radius, cq.Vector(*p)) for p in points)
    spring = coil.fuse(*legs).clean()
    # Maximal wire+installation allowance for the entire0..90degree inward arc,
    # not a sparse set of angular snapshots. Keep the R2.15 journal core solid.
    leg_space = cylinder((109.7, axis_y, axis_z), (1, 0, 0), 2.65, 2.95).cut(
        cylinder((109.6, axis_y, axis_z), (1, 0, 0), 2.15, 3.15)
    )
    leg_space = leg_space.intersect(
        box([109.7, axis_y - 2.66, axis_z - 2.66, 112.65, axis_y + 0.25, axis_z + 0.25])
    )
    # The two radial bends lie outside the journal's axial bearing stock.
    # They need full radial travel as well as the outer bridge's annular slot.
    for x0, x1 in [(109.7, 110.15), (112.3, 112.65)]:
        radial = cylinder((x0, axis_y, axis_z), (1, 0, 0), 2.65, x1 - x0).cut(
            cylinder((x0 - 0.1, axis_y, axis_z), (1, 0, 0), 0.9, x1 - x0 + 0.2)
        )
        radial = radial.intersect(
            box([x0, axis_y - 2.66, axis_z - 2.66, x1, axis_y + 0.25, axis_z + 0.25])
        )
        leg_space = leg_space.fuse(radial)
    return (
        spring,
        leg_space,
        {
            "turns": turns,
            "mean_radius_mm": radius,
            "wire_diameter_mm": 0.25,
            "fixed_anchor_mm": [108.5, axis_y, axis_z - 3],
            "moving_receiver_closed_mm": [113.7, axis_y, axis_z - 1.1],
            "loaded_inside_diameter_mm": 2 * radius - 0.25,
            "shaft_diameter_mm": 1.5,
            "scope": "Connected installed geometry and nominal binding allocation only. Forming radii, preload, rate, stress and fatigue remain prototype/manufacturer qualification.",
        },
    )
