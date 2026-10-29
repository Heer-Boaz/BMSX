"""Export the native board contacts and the numbered internal wiring schedule.

KiCad's numbered pads remain the electrical owner; Book IV owns SCART contacts.
Like WireViz's Harness.connect, record both connector/contact endpoints per wire,
not graphical left/right positions. Reference implementations studied:
https://github.com/wireviz/WireViz/blob/master/src/wireviz/Harness.py
https://github.com/KiCad/kicad-footprints/blob/master/Connector_PinHeader_2.54mm.pretty/PinHeader_1x04_P2.54mm_Vertical.kicad_mod
"""

import csv
import hashlib
import json
import math
import subprocess
from html import escape
from pathlib import Path

import pcbnew

ROOT = Path(__file__).resolve().parents[1]
BOARDS = {
    "MAIN": "mainboard/BMSX",
    "FRONT": "front/BMSX_FRONT",
    "KEYBOARD": "keyboard/BMSX_KEYBOARD",
    "AV": "av/BMSX_AV_BREAKOUT",
    "SCART": "scart/BMSX_SCART_TERM",
}
LABELS = {
    "SCART_R": "Red output",
    "SCART_G": "Green output",
    "SCART_B": "Blue output",
    "SCART_CSYNC": "Composite synchronisation output",
    "SCART_AUD_L": "Left audio output",
    "SCART_AUD_R": "Right audio output",
    "SCART_RGB_SELECT": "RGB selection output",
}


def main():
    sources = [ROOT / "ecad" / (name + ".kicad_pcb") for name in BOARDS.values()]
    boards = {name: pcbnew.LoadBoard(str(path)) for name, path in zip(BOARDS, sources)}
    refs = {
        "MAIN": ("J300", "J301", "J500", "J61"),
        "FRONT": ("J5",),
        "KEYBOARD": ("J2",),
        "AV": ("J1", "J2", "J3", "J4", "J5", "J6"),
        "SCART": ("J1", "J2"),
    }
    connectors, native, positions = {}, {}, {}
    for name, board in boards.items():
        for fp in board.GetFootprints():
            if fp.GetReference() not in refs[name]:
                continue
            key = name + " " + fp.GetReference()
            pads = [pad for pad in fp.Pads() if pad.GetNumber()]
            contacts = {pad.GetNumber(): pad.GetNetname() for pad in pads}
            assert all(contacts[pad.GetNumber()] == pad.GetNetname() for pad in pads), key
            connectors[key] = contacts
            positions[key] = {
                pad.GetNumber(): [
                    pcbnew.ToMM(pad.GetPosition().x),
                    pcbnew.ToMM(pad.GetPosition().y),
                ]
                for pad in pads
            }
            native[key] = {
                "value": fp.GetValue(),
                "footprint": str(fp.GetFPID().GetLibItemName()),
                "contacts": contacts,
            }
    manual = ROOT.parent / "docs/book4/connectors.md"
    text = manual.read_text()
    table = text[text.index("| SCART contact |") : text.index("{#tbl-scart-contacts}")]
    scart = {}
    for line in table.splitlines()[2:]:
        if line.startswith("|"):
            pin, label, ret = (value.strip() for value in line.strip("|").split("|"))
            scart[label] = (pin, ret)
    assert scart["Composite synchronisation output"] == ("19", "17")
    rear_path = ROOT / "design/enclosure_rear_io.json"
    rear = json.loads(rear_path.read_text())
    parts_path = ROOT / "models/harness/parts.json"
    supplier = json.loads(parts_path.read_text())
    parts = supplier["parts"]
    controls_path = ROOT / "design/enclosure_controls.json"
    controls = json.loads(controls_path.read_text())
    front_path = ROOT / "design/enclosure_front_io.json"
    front = json.loads(front_path.read_text())
    front_models_path = ROOT / front["source_manifest"]
    front_models = json.loads(front_models_path.read_text())
    keyboard_top = (
        front_models["parts"]["KEYBOARD__KEYBOARD_NATIVE_DRILLED_BOARD"]["bounds_mm"][5]
        + front["keyboard_transform"]["translation_mm"][2]
    )
    mating_roofs = []
    for connector, housing, top, receiver in (
        ("MAIN J300", "PHDR-20VS", rear["mainboard_pcb_top_Z_mm"], "main_J300_mate"),
        ("FRONT J5", "PHDR-20VS", front["board_pose"]["top_z_mm"], "front_J5_mate"),
    ):
        part = parts[housing]
        assert native[connector]["value"] == part["mating_header"]
        roof = top + part["mated_height_nominal_mm"]
        allocation_roof = controls["fixed_receivers"][receiver][5]
        assert roof <= allocation_roof
        mating_roofs.append(
            {
                "connector": connector,
                "housing": housing,
                "PCB_top_mm": top,
                "nominal_mated_roof_mm": roof,
                "receiving_roof_mm": allocation_roof,
                "nominal_roof_margin_mm": allocation_roof - roof,
            }
        )
    pad_wire_contacts = []
    for contact_name, wire_name, contact_positions in (
        ("SPHD-002T-P0.5", "39128", "1–13"),
        ("SPHD-001T-P0.5", "39122", "14–20"),
    ):
        contact = parts[contact_name]
        wire = parts[wire_name]
        assert contact["wire_AWG_range"][0] <= wire["wire_AWG"] <= contact["wire_AWG_range"][1]
        assert (
            contact["wire_insulation_diameter_mm"][0]
            <= wire["diameter_nominal_mm"]
            <= contact["wire_insulation_diameter_mm"][1]
        )
        pad_wire_contacts.append(
            {
                "positions": contact_positions,
                "contact": contact_name,
                "wire": wire_name,
                "wire_AWG": wire["wire_AWG"],
                "contact_AWG_range": contact["wire_AWG_range"],
                "wire_nominal_OD_mm": wire["diameter_nominal_mm"],
                "contact_insulation_OD_range_mm": contact["wire_insulation_diameter_mm"],
            }
        )
    keyboard_part = parts["PHR-4"]
    keyboard_contact = parts["SPH-002T-P0.5S"]
    keyboard_wire = parts["39128"]
    assert keyboard_contact["wire_AWG_range"][0] <= keyboard_wire["wire_AWG"]
    assert keyboard_wire["wire_AWG"] <= keyboard_contact["wire_AWG_range"][1]
    assert (
        keyboard_contact["wire_insulation_diameter_mm"][0] <= keyboard_wire["diameter_nominal_mm"]
    )
    assert (
        keyboard_wire["diameter_nominal_mm"] <= keyboard_contact["wire_insulation_diameter_mm"][1]
    )
    keyboard_mates = []
    for connector, top, receiver in (
        ("MAIN J301", rear["mainboard_pcb_top_Z_mm"], "J301_mate"),
        ("KEYBOARD J2", keyboard_top, "keyboard_J2_mate"),
    ):
        assert native[connector]["value"] == keyboard_part["mating_header"]
        roof = top + keyboard_part["mated_height_nominal_mm"]
        bend_roof = (
            roof
            + 2.0
            + keyboard_wire["minimum_bend_radius_mm"]
            + keyboard_wire["diameter_nominal_mm"] / 2
        )
        allocation_roof = controls["fixed_receivers"][receiver][5]
        assert bend_roof <= allocation_roof
        keyboard_mates.append(
            {
                "connector": connector,
                "housing": "PHR-4",
                "PCB_top_mm": top,
                "nominal_mated_roof_mm": roof,
                "straight_exit_assumption_mm": 2.0,
                "nominal_90_degree_bend_screen_roof_mm": bend_roof,
                "receiving_roof_mm": allocation_roof,
                "scope": "Nominal mated height, an illustrative 2 mm straight exit, centreline bend radius and half nominal wire OD; actual exit, full 3D route, tolerances, crimp and finished assembly remain unqualified.",
            }
        )
    ribbon = parts["63911615521"]
    ribbon_max_width = ribbon["width_nominal_mm"] + ribbon["width_tolerance_mm"]
    ribbon_max_thickness = ribbon["thickness_nominal_mm"] + ribbon["thickness_tolerance_mm"]
    ribbon_bounds = rear["AV_breakout"]["ribbon_bounds_mm"]
    assert math.isclose(ribbon_max_width, ribbon_bounds[3] - ribbon_bounds[0])
    assert ribbon_max_thickness <= ribbon_bounds[5] - ribbon_bounds[2]
    dc = rear["DC"]["wire_departure"]
    dc_header = next(fp for fp in boards["MAIN"].GetFootprints() if fp.GetReference() == "J61")
    dc_peg = next(pad for pad in dc_header.Pads() if not pad.GetNumber())
    pad1_x, pad1_y = positions["MAIN J61"]["1"]
    pad2_x, pad2_y = positions["MAIN J61"]["2"]
    peg_x, peg_y = pcbnew.ToMM(dc_peg.GetPosition().x), pcbnew.ToMM(dc_peg.GetPosition().y)
    assert math.isclose(pad1_x - pad2_x, 5.5, abs_tol=1e-6)
    assert math.isclose(pad1_y, pad2_y, abs_tol=1e-6)
    assert math.isclose(peg_y, pad1_y, abs_tol=1e-6)
    assert math.isclose(peg_x - pad1_x, dc["maker_peg_to_pad1_mm"], abs_tol=1e-6)
    dc_header_back_x = peg_x + dc["maker_peg_to_mating_face_mm"] - dc["maker_header_body_length_mm"]
    assert math.isclose(
        dc_header_back_x + dc["maker_mated_length_reference_mm"],
        dc["reference_X_mm"],
        abs_tol=1e-6,
    )
    mates_path = ROOT / "models/rear/mating.json"
    mate = next(m for m in json.loads(mates_path.read_text()) if m["ref"] == "J61")
    lo_x, lo_y, lo_z, hi_x, hi_y, hi_z = mate["bounds_mm_local"]
    angle = math.radians(-dc_header.GetOrientationDegrees())
    origin_x = pcbnew.ToMM(dc_header.GetPosition().x)
    origin_y = pcbnew.ToMM(dc_header.GetPosition().y)
    corners = [
        (
            origin_x + math.cos(angle) * x - math.sin(angle) * y,
            origin_y + math.sin(angle) * x + math.cos(angle) * y,
        )
        for x in (lo_x, hi_x)
        for y in (lo_y, hi_y)
    ]
    allocation = [
        min(x for x, _ in corners),
        min(y for _, y in corners),
        lo_z,
        max(x for x, _ in corners),
        max(y for _, y in corners),
        hi_z,
    ]
    housing = parts["39-01-2025"]
    witness = [
        min(dc_header_back_x, dc["reference_X_mm"] - housing["housing_length_nominal_mm"]),
        pad1_y - housing["contact_axis_to_body_edge_nominal_mm"],
        dc["PCB_top_Z_mm"],
        dc["reference_X_mm"],
        pad1_y
        - housing["contact_axis_to_body_edge_nominal_mm"]
        + housing["housing_width_two_circuit_nominal_mm"],
        dc["PCB_top_Z_mm"] + dc["maker_mated_height_reference_mm"],
    ]
    assert all(allocation[i] - 1e-6 <= witness[i] for i in range(3))
    assert all(witness[i] <= allocation[i] + 1e-6 for i in range(3, 6))
    dc_routes = []
    for wire, axis_z in zip(rear["DC_wires"], dc["nominal_contact_axes_Z_mm"]):
        start = wire["segments"][0]["start"]
        assert all(
            math.isclose(a, b, abs_tol=1e-6)
            for a, b in zip(start, (dc["reference_X_mm"], dc["reference_Y_mm"], axis_z))
        )
        part = parts[wire["wire_MPN"]]
        required_radius = part["diameter_maximum_mm"] * part["minimum_bend_radius_diameters"]
        assert wire["OD_mm"] == part["diameter_maximum_mm"]
        assert parts["39-00-0039"]["wire_insulation_diameter_mm"][0] <= part["diameter_minimum_mm"]
        assert part["diameter_maximum_mm"] <= parts["39-00-0039"]["wire_insulation_diameter_mm"][1]
        assert (
            parts["39-00-0039"]["wire_cross_section_mm2_range"][0]
            <= part["wire_cross_section_mm2"]
            <= parts["39-00-0039"]["wire_cross_section_mm2_range"][1]
        )
        length, radii = 0.0, []
        for segment in wire["segments"]:
            if segment["kind"] == "line":
                length += math.dist(segment["start"], segment["end"])
                continue
            a = math.dist(segment["start"], segment["mid"])
            b = math.dist(segment["mid"], segment["end"])
            c = math.dist(segment["end"], segment["start"])
            four_area = math.sqrt((a + b + c) * (-a + b + c) * (a - b + c) * (a + b - c))
            radius = a * b * c / four_area
            angle = 2 * (math.pi - math.atan2(four_area, a * a + b * b - c * c))
            radii.append(radius)
            length += radius * angle
        minimum_radius = min(radii)
        assert minimum_radius >= required_radius or math.isclose(
            minimum_radius, required_radius, rel_tol=1e-12
        )
        resistance = length * part["maximum_conductor_resistance_20C_ohm_per_km"] / 1e6
        dc_routes.append(
            {
                "wire": wire["name"],
                "MPN": wire["wire_MPN"],
                "colour": part["colour"],
                "maximum_OD_mm": part["diameter_maximum_mm"],
                "minimum_static_radius_required_mm": required_radius,
                "minimum_modelled_arc_radius_mm": minimum_radius,
                "proposed_centreline_length_mm": length,
                "route_conductor_R20_max_ohm": resistance,
                "voltage_drop_at_5A_design_basis_V": 5 * resistance,
                "wire_loss_at_5A_design_basis_W": 25 * resistance,
                "cut_length_scope": "Centreline route only; final cut/strip length follows verified complete-mate exit and inlet terminal datums. No continuous-current rating is assigned.",
            }
        )
    dc_crimp = parts["39-00-0039"]
    recommended_od = dc_crimp["hand_tool_0_5_mm2_recommended_insulation_OD_mm"]
    reel_crimp = parts["39-00-0038"]
    applicator_od = reel_crimp["applicator_0_5_mm2_recommended_insulation_OD_mm"]
    wire_od = [parts[wire["wire_MPN"]] for wire in rear["DC_wires"]]
    dc_crimp_scope = {
        "tool": dc_crimp["hand_tool"],
        "profile": dc_crimp["hand_tool_0_5_mm2_profile"],
        "recommended_class_2_insulation_OD_mm": recommended_od,
        "selected_wire_published_OD_ranges_mm": {
            part["colour"]: [part["diameter_minimum_mm"], part["diameter_maximum_mm"]]
            for part in wire_od
        },
        "entire_published_wire_range_in_recommendation": all(
            recommended_od[0] <= part["diameter_minimum_mm"]
            and part["diameter_maximum_mm"] <= recommended_od[1]
            for part in wire_od
        ),
        "scope": dc_crimp["hand_tool_scope"],
        "alternate_process": {
            "contact": "39-00-0038",
            "applicator": reel_crimp["applicator"],
            "recommended_insulation_OD_mm": applicator_od,
            "scope": reel_crimp["applicator_scope"],
        },
        "entire_published_wire_range_covered_by_combined_process_ranges": (
            recommended_od[1] >= applicator_od[0]
            and all(
                recommended_od[0] <= part["diameter_minimum_mm"]
                and part["diameter_maximum_mm"] <= applicator_od[1]
                for part in wire_od
            )
        ),
    }
    scart_board_path = ROOT / "ecad/scart/board.json"
    scart_board = json.loads(scart_board_path.read_text())
    scart_supplier_path = ROOT / scart_board["supplier_datum_owner"]
    scart_supplier = json.loads(scart_supplier_path.read_text())
    scart_pose = scart_board["assembly_pose"]
    assert scart_pose["native_xy_is_world_xy"]
    ox, oy, oz = scart_pose["pcb_origin_world_mm"]
    tail_roles, used_tails = {}, set()
    for net, label in LABELS.items():
        pin, ret = scart[label]
        assert connectors["SCART J1"][pin] == net
        assert connectors["SCART J1"][ret] == "GND"
        tail_roles[pin] = label
        tail_roles[ret] = "Associated return"
        used_tails.update((pin, ret))
    shield = scart["Socket shield"][0]
    assert connectors["SCART J1"][shield] == "GND"
    tail_roles[shield] = "Socket shield"
    used_tails.add(shield)
    assert len(used_tails) == 14
    factory_tails = []
    scart_net_counts = {}
    for fp in boards["SCART"].GetFootprints():
        for pad in fp.Pads():
            if pad.GetNumber():
                scart_net_counts[pad.GetNetname()] = scart_net_counts.get(pad.GetNetname(), 0) + 1
    for tail in scart_supplier["tails"]:
        pin = str(tail["contact"])
        x, y = positions["SCART J1"][pin]
        world_x, world_y = ox + x, oy + y
        assert math.isclose(world_x, tail["world_X_mm"], abs_tol=1e-6)
        assert math.isclose(world_y, tail["world_Y_mm"], abs_tol=1e-6)
        if pin in used_tails:
            assignment = tail_roles[pin]
        else:
            assert scart_net_counts[connectors["SCART J1"][pin]] == 1
            assignment = "NC"
        factory_tails.append(
            {
                "contact": tail["contact"],
                "native_net": connectors["SCART J1"][pin],
                "assignment": assignment,
                "native_X_mm": x,
                "native_Y_mm": y,
                "world_X_mm": world_x,
                "world_Y_mm": world_y,
                "own_PCB_top_Z_mm": oz,
                "maker_u_mm": tail["u_mm"],
                "maker_v_mm": tail["v_mm"],
                "drawing_revision": scart_supplier["drawing"]["revision"],
            }
        )
    assert len(factory_tails) == 21
    assert set(connectors["SCART J1"]) == {str(i) for i in range(1, 22)}
    assert set(connectors["SCART J2"]) == {str(i) for i in range(1, 17)}
    rows, paired = [], 0
    view = "Board header mating face: identify contact 1 on header and wire mate. Wire-entry view is mirrored."
    for group, first, second, count in (
        ("PAD", "MAIN J300", "FRONT J5", 20),
        ("KEYBOARD", "MAIN J301", "KEYBOARD J2", 4),
        ("AV IDC", "MAIN J500", "AV J1", 16),
    ):
        expected = {str(i) for i in range(1, count + 1)}
        assert set(connectors[first]) == set(connectors[second]) == expected
        for i in range(1, count + 1):
            pin = str(i)
            assert connectors[first][pin] == connectors[second][pin], (first, second, pin)
            note = (
                view
                if group != "AV IDC"
                else "J500 mating face contact 1 -> socket 1 -> ribbon conductor 1 -> AV J1 pad 1; J1 is a solder termination."
            )
            if group == "PAD":
                wire = "Belden 39122 AWG22" if i >= 14 else "Belden 39128 AWG28"
            else:
                wire = "individual wire" if group == "KEYBOARD" else "ribbon conductor " + pin
            net = connectors[first][pin]
            rows.append([group, first, pin, net, second, pin, wire, note])
            paired += 1
    tail_view = "SCART termination J2 underside lap joints. Native PCB nets assign J1 contacts; copper routing is incomplete."
    for pair, coax in enumerate(rear["coaxes"]):
        first = "AV " + coax["ref"]
        signal = connectors[first]["1"]
        target = scart[LABELS[signal]]
        assert tuple(map(str, coax["SCART_signal_return"])) == target, coax["name"]
        assert connectors[first]["2"] == "GND"
        for pin, contact, conductor in zip(
            ("1", "2"), (str(2 * pair + 1), str(2 * pair + 2)), ("centre", "shield")
        ):
            wire, net = coax["name"] + " " + conductor, connectors[first][pin]
            assert connectors["SCART J2"][contact] == net
            rows.append(["SCART", first, pin, net, "SCART J2", contact, wire, tail_view])
            paired += 1
    aux = {str(wire["J6_pin"]): str(wire["SCART_pin"]) for wire in rear["auxiliary_wires"]}
    for pin in ("1", "3", "5"):
        ret = str(int(pin) + 1)
        assert (aux[pin], aux[ret]) == scart[LABELS[connectors["AV J6"][pin]]]
        assert connectors["AV J6"][ret] == "GND"
    for pin in ("7", "8"):
        assert aux[pin] == scart["Socket shield"][0] and connectors["AV J6"][pin] == "GND"
    for pin in map(str, range(1, 9)):
        net = connectors["AV J6"][pin]
        contact = str(int(pin) + 8)
        assert connectors["SCART J2"][contact] == net
        rows.append(["SCART", "AV J6", pin, net, "SCART J2", contact, "insulated wire", tail_view])
        paired += 1
    for pin, net, terminal, colour in (
        ("1", "RAW9", "L722A centre", "red"),
        ("2", "GND", "L722A sleeve", "black"),
    ):
        assert connectors["MAIN J61"][pin] == net
        note = "J61 header mating face; identify housing contact 1. Jack functions do not specify solder-tail coordinates."
        rows.append(["DC", "MAIN J61", pin, net, "DC inlet", terminal, colour + " lead", note])
    output = ROOT / "build/exports"
    output.mkdir(parents=True, exist_ok=True)
    schedule = output / "BMSX_wiring_schedule.csv"
    with schedule.open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(
            "harness,from_connector,from_contact,native_net,to_connector,to_contact,conductor,assembly_view,continuity_check".split(
                ","
            )
        )
        for row in rows:
            check = f"Disconnected harness: {row[1]}.{row[2]} to {row[4]}.{row[5]}; check no unintended cross-connections."
            writer.writerow(row + [check])
    parts_csv = output / "BMSX_harness_parts.csv"
    with parts_csv.open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(
            ["manufacturer", "part", "description", "quantity", "quantity_basis", "selection"]
        )
        for mpn, part in parts.items():
            if mpn in ("39-00-0038", "39-00-0039"):
                quantity, basis, selection = (
                    2,
                    "conditional; total two contacts across both options",
                    "reel contact for applicator"
                    if mpn == "39-00-0038"
                    else "loose contact for hand tool",
                )
            elif "quantity_in_scope" in part:
                quantity, basis, selection = (
                    part["quantity_in_scope"],
                    "pieces",
                    "selected component",
                )
            elif mpn in ("39128", "39122", "63911615521", "4510041", "4510011"):
                quantity, basis, selection = (
                    "",
                    "cut length belongs to assembly route",
                    "selected wire",
                )
            else:
                quantity, basis, selection = "", "not in assembly BOM", part["selection"]
            writer.writerow(
                [part["manufacturer"], mpn, part["description"], quantity, basis, selection]
            )
    fit_csv = output / "BMSX_JST_pad_nominal_fit.csv"
    with fit_csv.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(mating_roofs[0]))
        writer.writeheader()
        writer.writerows(mating_roofs)
    dc_csv = output / "BMSX_DC_wire_routes.csv"
    tails_csv = output / "BMSX_SCART_factory_tails.csv"
    for path, entries in ((dc_csv, dc_routes), (tails_csv, factory_tails)):
        with path.open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(entries[0]))
            writer.writeheader()
            writer.writerows(entries)
    svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 1260" role="img" aria-labelledby="title desc">',
        '<title id="title">Internal harness contact schedule</title><desc id="desc">Numbered electrical connections, not connector geometry or solder-tail positions.</desc>',
        '<style>text{font:18px Arial,sans-serif;fill:#183044}.title{font-size:25px;font-weight:bold}.small{font-size:16px}.net{font:16px monospace}.line{stroke:#a7bac8;stroke-width:1}</style><rect width="1500" height="1260" fill="white"/>',
    ]
    headings = [
        (30, 140, 470, "PAD", "J300 ↔ front J5 · keyed JST 2×10"),
        (520, 140, 460, "KEYBOARD", "J301 ↔ keyboard J2 · 1×4 keyed JST"),
        (1000, 140, 470, "AV IDC", "J500 ↔ AV J1 · 16 conductors"),
        (30, 760, 800, "SCART", "AV terminals → SCART termination J2"),
        (880, 760, 590, "DC", "J61 → DC inlet functions"),
    ]
    for x, y, width, group, title in headings:
        svg.append(f'<text x="{x}" y="{y}" class="title">{escape(title)}</text>')
        for i, row in enumerate(row for row in rows if row[0] == group):
            yy = y + 40 + i * 25
            left, right = f"{row[1]}.{row[2]}", f"{row[4]}.{row[5]}"
            svg.append(
                f'<path d="M{x},{yy + 7} H{x + width}" class="line"/><text x="{x}" y="{yy}" class="small">{escape(left)}</text><text x="{x + 145}" y="{yy}" class="net">{escape(row[3])}</text><text x="{x + width}" y="{yy}" text-anchor="end" class="small">{escape(right)}</text>'
            )
    notes = """Internal harness contact schedule
Electrical endpoints only: contact IDs stay the same across a mate; wire-entry and mating-face views are mirrored.
Locate contact 1 on each actual header and wire housing. Do not infer socket numbering from a PCB solder-side view.
The pad and keyboard JST housings are polarised. Verify every contact number.
Before connection: isolate both harness ends.
Verify every scheduled endpoint and rail polarity.
Check no unintended signal/rail cross-connections.
Common returns may join only as scheduled.
Insulate the unused DC switched-sleeve terminal.
SCART J2 → J1 is a native PCB net assignment, not another loom. The termination PCB has no completed copper routing.
Disconnect adapter power before assembly. This schedule does not qualify copper routing, retention force or analogue performance.""".splitlines()
    xs = [30] * 4 + [880] * 5 + [30] * 2
    ys = (42, 78, 108, 710, 910, 940, 970, 1000, 1050, 1210, 1240)
    for i, (x, y, label) in enumerate(zip(xs, ys, notes)):
        cls = "title" if i == 0 else "small" if i >= 8 else ""
        svg.append(f'<text x="{x}" y="{y}" class="{cls}">{escape(label)}</text>')
    drawing = output / "BMSX_internal_harnesses.svg"
    drawing.write_text("\n".join(svg + ["</svg>"]) + "\n")
    subprocess.run(
        ["rsvg-convert", "-o", str(drawing.with_suffix(".png")), str(drawing)], check=True
    )
    report = {
        "scope": "Native numbered pad/net agreement and a reference harness schedule. The listed catalogue wires and lengths are examples, not immutable product requirements; a custom harness must satisfy the actual connector, electrical, thermal and mechanical requirements. This is not measured continuity or physical mating qualification.",
        "kicad_version": pcbnew.GetBuildVersion(),
        "native_connectors": native,
        "paired_native_contacts_checked": paired,
        "conductor_rows": len(rows),
        "supplier_parts_owner": "hardware/models/harness/parts.json",
        "JST_pad_nominal_mating_roofs": mating_roofs,
        "JST_pad_nominal_wire_contact_fit": {
            "pairs": pad_wire_contacts,
            "scope": "Published wire gauge and nominal insulation diameter against the published contact ranges; nominal diameter is not a tolerance bound or a finished-crimp qualification.",
        },
        "JST_keyboard_nominal_mating_roofs": keyboard_mates,
        "mating_scope": "Nominal 8.8 mm mated height fits the receiving envelope; contact retention, exit geometry, drilling, crimps and tolerance stacks remain to be qualified.",
        "ribbon_receiving": {
            "maximum_width_mm": ribbon_max_width,
            "maximum_thickness_mm": ribbon_max_thickness,
            "current_proposed_bounds_mm": ribbon_bounds,
            "scope": "Published cable maximum fits the enlarged allocation. Its centreline remains proposed; exact seated IDC exit datum is not established.",
        },
        "DC_wire_routes": dc_routes,
        "DC_crimp_insulation_recommendation": dc_crimp_scope,
        "DC_loop_conductor_R20_max_ohm": sum(
            row["route_conductor_R20_max_ohm"] for row in dc_routes
        ),
        "DC_wire_departure_scope": rear["DC"]["wire_departure"],
        "DC_header_rear_reference_X_mm": dc_header_back_x,
        "DC_mated_roof_reference_Z_mm": dc["PCB_top_Z_mm"] + dc["maker_mated_height_reference_mm"],
        "DC_mate_dimensional_witness": {
            "witness_bounds_mm": witness,
            "native_allocation_bounds_mm": allocation,
            "scope": "Nominal manufacturer length/width and mated REF height fit the existing own reservation. This witness is not the complete supplier shape, a tolerance stack or a mechanical qualification.",
        },
        "SCART_termination": {
            "used_factory_contacts": len(used_tails),
            "NC_factory_contacts": len(factory_tails) - len(used_tails),
            "native_track_count": len(boards["SCART"].GetTracks()),
            "native_unconnected_count": boards["SCART"]
            .GetConnectivity()
            .GetUnconnectedCount(False),
            "scope": "J2 inputs and J1 factory tails are assigned by the native board nets. Copper connectivity is not included as physical loom conductors or certified as routed.",
        },
        "counting_scope": "56 board-paired physical conductors plus2 DC inlet leads =58 loom rows. Native SCART J2-to-J1 PCB connectivity adds no phantom loom conductors.",
        "SCART_contact_owner": "docs/book4/connectors.md#tbl-scart-contacts",
        "views": view,
        "continuity_procedure": "With power disconnected and both harness ends isolated, verify each scheduled endpoint and no unintended cross-connections; intentional common returns excepted. Board common grounds cannot establish individual return-wire continuity.",
        "not_proven": [
            "PHD mating, crimp, wire fanout and full assembly qualification",
            "Exact wire-mate seating, contact-1 markings and exit geometry",
            "DC full housing perimeter/tolerances, actual crimp and insulation exit, and final cut/strip lengths; maker-mated X67.475 is REF only",
            "Choose the hand tool or reel-contact applicator from actual wire OD; their stated recommended ranges jointly cover 2.1–2.5 mm, but physical conductor and insulation crimps, press setup and finished-loom retention still require qualification.",
            "SCART full supplier perimeter/tolerances, production lot and physical mounting acceptance",
            "Mounted harness retention, physical continuity, 75-ohm performance and copper routing",
        ],
        "input_sha256": {
            str(path.relative_to(ROOT.parent)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sources
            + [
                manual,
                rear_path,
                parts_path,
                mates_path,
                controls_path,
                front_path,
                front_models_path,
                scart_board_path,
                scart_supplier_path,
                Path(__file__),
            ]
        },
        "outputs": [
            str(path.relative_to(ROOT))
            for path in (
                schedule,
                parts_csv,
                fit_csv,
                dc_csv,
                tails_csv,
                drawing,
                drawing.with_suffix(".png"),
            )
        ],
    }
    target = ROOT / "build/reports/interconnect.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2) + "\n")
    print(f"{paired} native contact pairs; {len(rows)} wires; {target}")


if __name__ == "__main__":
    main()
