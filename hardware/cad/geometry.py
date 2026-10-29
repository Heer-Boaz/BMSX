"""Central world-coordinate CAD primitives for the enclosure and its checks."""

import cadquery as cq


def box(bounds):
    x, y, z, X, Y, Z = bounds
    return cq.Solid.makeBox(X - x, Y - y, Z - z, cq.Vector(x, y, z))


def rounded_prism(bounds, radius, axis="Z"):
    return cq.Workplane(obj=box(bounds)).edges("|" + axis).fillet(radius).val()


def rounded_top_prism(bounds, plan_radius, top_radius):
    """Plan-rounded stock with a continuous rolled upper shoulder.

    Shell producers subtract the matching inset stock; both exterior and
    interior shoulder radii are explicit, so rounding does not eat the wall.
    """
    stock = rounded_prism(bounds, plan_radius)
    return cq.Workplane(obj=stock).edges(">Z").fillet(top_radius).val()


def cylinder(centre, direction, radius, length):
    return cq.Solid.makeCylinder(radius, length, cq.Vector(*centre), cq.Vector(*direction))


def bounds(shape):
    b = shape.BoundingBox()
    return [b.xmin, b.ymin, b.zmin, b.xmax, b.ymax, b.zmax]


def overlaps(a, b):
    return all(a[i] <= b[i + 3] and b[i] <= a[i + 3] for i in range(3))


def tube_path(segments, radius):
    """Native constant-radius tube around a connected line/three-point-arc wire.

    CadQuery/OCC owns sweep transport; source provides the actual spatial path,
    not sampled line guesses. First tangent defines the normal profile plane.
    """
    edges = []
    for segment in segments:
        points = [cq.Vector(*segment[k]) for k in ["start", "end"]]
        if segment["kind"] == "line":
            edge = cq.Edge.makeLine(*points)
        else:
            edge = cq.Edge.makeThreePointArc(points[0], cq.Vector(*segment["mid"]), points[1])
        edges.append(edge)
    path = cq.Wire.assembleEdges(edges)
    profile = (
        cq.Workplane(
            cq.Plane(origin=cq.Vector(*segments[0]["start"]), normal=edges[0].tangentAt(0))
        )
        .circle(radius)
        .val()
    )
    return cq.Solid.sweep(profile, [], path, makeSolid=True, isFrenet=True)


def thermal_contact(heat, tim):
    under = [
        f
        for f in heat.Faces()
        if f.geomType() == "PLANE" and f.normalAt().z < -0.99 and abs(f.Center().z - 16.7) < 1e-5
    ]
    tops = [f for f in tim.Faces() if f.geomType() == "PLANE" and f.normalAt().z > 0.99]
    assert len(under) == len(tops) == 1
    area = tops[0].intersect(under[0]).Area()
    volume, distance = tim.intersect(heat).Volume(), tim.distance(heat)
    assert abs(area - 676) < 1e-5 and abs(tops[0].Area() - area) < 1e-5
    assert abs(volume) < 1e-5 and distance < 1e-5
    return {"contact_area_mm2": area, "intersection_mm3": volume, "distance_mm": distance}
