"""Fixed top controls: native maker-derived receiving envelopes and own slidecap.

Source dimensions and electrical limits live in design/enclosure_controls.json.
The portable producer also owns the hidden inside-up carrier mounting geometry.
The component envelopes are deliberately not detailed factory switch CAD.
The blue actuator is captive between stationary roof lip and a real PA12carrier;
no glue, moving-lid wiring or new motherboard PCB is assumed.
"""

import cadquery as cq
from fasteners import axial_hexagon
from fixtures import hex_pocket
from geometry import bounds, box, cylinder, rounded_prism


def build_controls(plan):
    parts = {}
    materials = {}
    regions = {}
    cuts = []
    additions = []
    top = plan["panel_top_Z_mm"]
    inside = plan["panel_inside_Z_mm"]
    power = plan["power"]
    cap = power["own_cap"]
    x, y = plan["centres_XY_mm"]["POWER"]
    offset = cap["current_offset_X_mm"]
    fl = power["fixed_flange_top_Z_mm"]
    bottom = power["carrier_bounds_mm"][2]
    upper = power["carrier_bounds_mm"][5]
    plate = box(power["carrier_bounds_mm"])
    a, b, A, B = power["carrier_actuator_slot_XY_mm"]
    plate = plate.cut(box([a, b, bottom - 0.1, A, B, upper + 0.1]))
    mount = power["internal_mount"]
    insert = mount["insert"]
    ear_bottom, ear_top = mount["carrier_ear_Z_mm"]
    receiver_bottom, receiver_top = mount["carrier_boss_receiver_Z_mm"]
    boss_bottom, boss_top = mount["boss_Z_mm"]
    bore_bottom, bore_top = mount["blind_bore_Z_mm"]
    insert_bottom, insert_top = insert["axis_range_mm"]
    for px, py in power["carrier_mount_XY_mm"]:
        plate = plate.fuse(
            cylinder(
                [px, py, ear_bottom],
                [0, 0, 1],
                mount["carrier_ear_diameter_mm"] / 2,
                ear_top - ear_bottom,
            )
        )
    # The front inner wall reaches Y3.5 below the roof; trim the front ear
    # crescents rather than cutting that wall or moving any mounting axis.
    plate_bounds = bounds(plate)
    plate = plate.cut(
        box(
            [
                plate_bounds[0] - 0.1,
                plate_bounds[1] - 0.1,
                ear_bottom - 0.1,
                plate_bounds[3] + 0.1,
                mount["carrier_front_clearance_Y_mm"],
                ear_top + 0.1,
            ]
        )
    )
    for i, (px, py) in enumerate(power["carrier_mount_XY_mm"]):
        # The lowered ear clamps against the Z51 boss face, not the roof skin.
        plate = plate.cut(
            cylinder(
                [px, py, ear_bottom - 0.1],
                [0, 0, 1],
                mount["screw_clearance_diameter_mm"] / 2,
                ear_top - ear_bottom + 0.2,
            )
        )
        plate = plate.cut(
            cylinder(
                [px, py, receiver_bottom],
                [0, 0, 1],
                mount["carrier_boss_receiver_diameter_mm"] / 2,
                receiver_top - receiver_bottom,
            )
        )
        additions.append(
            cylinder(
                [px, py, boss_bottom],
                [0, 0, 1],
                mount["boss_diameter_mm"] / 2,
                boss_top - boss_bottom,
            )
        )
        # Initial pilot stays blind. In the installed assembly, hot insertion
        # displaces the overknurl envelope; this is not a larger drilled bore.
        pilot = cylinder(
            [px, py, bore_bottom - 0.1],
            [0, 0, 1],
            insert["moulded_or_finished_preinstallation_bore_diameter_mm"] / 2,
            bore_top - bore_bottom + 0.1,
        )
        imprint = cylinder(
            [px, py, insert_bottom],
            [0, 0, 1],
            insert["overknurl_diameter_ref_mm"] / 2,
            insert_top - insert_bottom,
        )
        cuts.append(pilot.fuse(imprint))
        name = "TOP_CONTROLS__SPIROL_151051_INSERT_" + str(i)
        parts[name] = imprint.cut(
            cylinder([px, py, insert_bottom - 0.1], [0, 0, 1], 1, insert_top - insert_bottom + 0.2)
        ).clean()
        materials[name] = "brass"
    for px, py in power["tab_mount_XY_mm"]:
        shaft = cylinder([px, py, bottom - 0.1], [0, 0, 1], 1.1, upper - bottom + 0.2)
        seat = cq.Solid.makeCone(1.1, 2.0, 1.1, cq.Vector(px, py, upper - 1.1), cq.Vector(0, 0, 1))
        plate = plate.cut(shaft.fuse(seat))
    # Outboard hanging hextraps retain nuts beside the maker's open U-tabs.
    # Trap tops stop at the thickest accepted tab underside. Nuts can rise
    # within the open pockets for thinner tabs without clamping the plastic.
    tab_bottom = fl - power["flange_thickness_receiving_max_mm"]
    for px, py in power["tab_mount_XY_mm"]:
        left = px < x
        stock = box(
            [
                x - 12.3 if left else x + 7,
                y - 3.6,
                fl - 2.6,
                x - 7 if left else x + 12.3,
                y + 3.6,
                tab_bottom,
            ]
        )
        web = box(
            [
                x - 12.3 if left else x + 10.1,
                y - 3.6,
                tab_bottom - 0.05,
                x - 10.1 if left else x + 12.3,
                y + 3.6,
                fl + 0.1,
            ]
        )
        plate = plate.fuse(stock).fuse(web)
        pocket = hex_pocket(
            {"axis": "Z", "centre_mm": [px, py, fl - 1.1], "across_flats_mm": 4.2, "length_mm": 2.3}
        )
        pocket = pocket.rotate((px, py, 0), (px, py, 1), 30)
        # Native fixtures helper is source-owned; explicit slide-in pocket is
        # open at outerX, not a fabricated socket/generic clearance exception.
        opening = box(
            [
                x - 12.4 if left else px,
                py - 2.1,
                fl - 2.25,
                px if left else x + 12.4,
                py + 2.1,
                fl + 0.05,
            ]
        )
        plate = plate.cut(pocket.fuse(opening))
        plate = plate.cut(cylinder([px, py, fl - 2.7], [0, 0, 1], 1.1, upper - fl + 2.8))
    parts["TOP_CONTROLS__PA12_SLIDE_CARRIER"] = plate.clean()
    materials["TOP_CONTROLS__PA12_SLIDE_CARRIER"] = "mount_pa12"
    # Actual drawing maxima, with a separate explicit insulated-lug envelope.
    # M1 tabs have end-open slots, not closed mounting holes.
    bw, bd, bh = power["body_receiving_max_mm"]
    fw, fd = power["flange_receiving_max_XY_mm"]
    body = box([x - bw / 2, y - bd / 2, fl - bh, x + bw / 2, y + bd / 2, fl])
    body = body.fuse(box([x - fw / 2, y - fd / 2, tab_bottom, x + fw / 2, y + fd / 2, fl]))
    lw, ld = power["complete_insulated_terminal_XY_mm"]
    body = body.fuse(
        box(
            [
                x - lw / 2,
                y - ld / 2,
                power["complete_insulated_terminal_bottom_Z_mm"],
                x + lw / 2,
                y + ld / 2,
                fl - bh,
            ]
        )
    )
    s = power["actuator_square_receiving_max_mm"] / 2
    stem = box(
        [
            x + offset - s,
            y - s,
            fl - 0.1,
            x + offset + s,
            y + s,
            fl + power["actuator_height_receiving_max_mm"],
        ]
    )
    body = body.fuse(stem)
    r = power["mount_slot_receiving_min_width_mm"] / 2
    for px, py in power["tab_mount_XY_mm"]:
        slot = cylinder([px, py, tab_bottom - 0.1], [0, 0, 1], r, fl - tab_bottom + 0.2)
        mouth = box(
            [
                x - fw / 2 - 0.1 if px < x else px,
                py - r,
                tab_bottom - 0.1,
                px if px < x else x + fw / 2 + 0.1,
                py + r,
                fl + 0.1,
            ]
        )
        body = body.cut(slot.fuse(mouth))
    parts["TOP_CONTROLS__POWER_MAKER_ENVELOPE"] = body.clean()
    materials["TOP_CONTROLS__POWER_MAKER_ENVELOPE"] = "steel"
    w, h = cap["visible_size_mm"]
    z, Z = cap["visible_Z_mm"]
    fw, fh = cap["flange_size_mm"]
    fz, fZ = cap["flange_Z_mm"]
    cx = x + offset
    knob = rounded_prism([cx - w / 2, y - h / 2, z, cx + w / 2, y + h / 2, Z], 0.6)
    knob = knob.fuse(box([cx - fw / 2, y - fh / 2, fz, cx + fw / 2, y + fh / 2, fZ]))
    s = cap["socket_side_mm"] / 2
    knob = knob.cut(box([cx - s, y - s, fz - 0.1, cx + s, y + s, cap["socket_top_Z_mm"]]))
    for xx in [-6, -3, 0, 3, 6]:
        knob = knob.cut(box([cx + xx - 0.3, y - 3.5, Z - 0.35, cx + xx + 0.3, y + 3.5, Z + 0.1]))
    parts["TOP_CONTROLS__BLUE_POWER_SLIDE"] = knob.clean()
    materials["TOP_CONTROLS__BLUE_POWER_SLIDE"] = "control_blue"
    cuts.extend([box(cap["cap_mouth_bounds_mm"]), box(cap["cap_cavity_bounds_mm"])])
    reset = plan["reset"]
    x, y = plan["centres_XY_mm"]["RESET"]
    # Correct antirotation flat is part of both bushing receiving profile and
    # the finished panel hole; no circular-hole substitution.
    bore = cylinder(
        [x, y, inside - 0.1], [0, 0, 1], reset["cutout_diameter_mm"] / 2, top - inside + 0.2
    )
    bore = bore.intersect(
        box(
            [x - 10, y - 10, inside - 0.2, x + reset["cutout_flat_width_mm"] / 2, y + 10, top + 0.2]
        )
    )
    cuts.append(bore)
    thread_bottom = top - 13.6
    thread = cylinder([x, y, thread_bottom], [0, 0, 1], reset["body_thread_diameter_mm"] / 2, 13.6)
    thread = thread.intersect(
        box([x - 10, y - 10, thread_bottom - 0.1, x + 5.4, y + 10, top + 0.1])
    )
    body = cylinder(
        [x, y, reset["component_low_Z_mm"]],
        [0, 0, 1],
        5.4,
        thread_bottom - reset["component_low_Z_mm"],
    ).fuse(thread)
    bezel = cylinder(
        [x, y, top], [0, 0, 1], reset["bezel_diameter_mm"] / 2, reset["bezel_height_mm"]
    )
    button_bottom = top + reset["bezel_height_mm"]
    button = cylinder(
        [x, y, button_bottom],
        [0, 0, 1],
        reset["button_diameter_mm"] / 2,
        reset["unpressed_top_Z_mm"] - button_bottom,
    )
    parts["TOP_CONTROLS__RESET_MAKER_ENVELOPE"] = body.fuse(bezel).fuse(button).clean()
    materials["TOP_CONTROLS__RESET_MAKER_ENVELOPE"] = "control_black"
    lo, hi = reset["nut_Z_mm"]
    nut = axial_hexagon("Z", [x, y, lo], lo, hi, reset["mount_nut_AF_mm"], 0).cut(
        cylinder([x, y, lo - 0.1], [0, 0, 1], 6.06, hi - lo + 0.2)
    )
    parts["TOP_CONTROLS__RESET_MOUNT_NUT"] = nut
    materials["TOP_CONTROLS__RESET_MOUNT_NUT"] = "steel"
    lo, hi = reset["lockwasher_Z_mm"]
    washer = cylinder([x, y, lo], [0, 0, 1], reset["lockwasher_OD_mm"] / 2, hi - lo).cut(
        cylinder([x, y, lo - 0.1], [0, 0, 1], reset["lockwasher_ID_mm"] / 2, hi - lo + 0.2)
    )
    parts["TOP_CONTROLS__RESET_LOCKWASHER_ENVELOPE"] = washer
    materials["TOP_CONTROLS__RESET_LOCKWASHER_ENVELOPE"] = "steel"
    led = plan["led"]
    x, y = plan["centres_XY_mm"]["LED"]
    cuts.append(
        cylinder([x, y, inside - 0.1], [0, 0, 1], led["cutout_diameter_mm"] / 2, top - inside + 0.2)
    )
    rear = cylinder(
        [x, y, led["rear_low_Z_mm"]],
        [0, 0, 1],
        led["rear_complete_radius_mm"],
        inside - led["rear_low_Z_mm"],
    )
    rear = rear.fuse(cylinder([x, y, inside], [0, 0, 1], 3, top - inside))
    bezel = cylinder(
        [x, y, top], [0, 0, 1], led["bezel_diameter_mm"] / 2, led["bezel_height_mm"]
    ).cut(
        cylinder(
            [x, y, top - 0.1], [0, 0, 1], led["lens_diameter_mm"] / 2, led["bezel_height_mm"] + 0.2
        )
    )
    parts["TOP_CONTROLS__LED_MAKER_ENVELOPE"] = rear.fuse(bezel).clean()
    materials["TOP_CONTROLS__LED_MAKER_ENVELOPE"] = "control_black"
    parts["TOP_CONTROLS__GREEN_LED_LENS"] = cylinder(
        [x, y, top], [0, 0, 1], led["lens_diameter_mm"] / 2, led["bezel_height_mm"]
    )
    materials["TOP_CONTROLS__GREEN_LED_LENS"] = "control_green"
    for name, shape in parts.items():
        assert shape.isValid(), name
        assert len(shape.Solids()) == 1, (name, len(shape.Solids()))
        regions[name] = [bounds(shape)]
    return parts, materials, regions, cuts, additions
