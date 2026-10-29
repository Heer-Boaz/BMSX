"""Native straight-insertion and reversed-block checks for both cartridge slots.

The selected socket's entire mouth is the conservative electrical boundary;
no inferred spring model or consumed contact position is used. Continuous door
clearance follows from the relieved radial region, with bounded native poses
also checked against the actual machined frame and both physical cards.
"""

import hashlib
import json
import math
from pathlib import Path
from time import perf_counter

import cadquery as cq
from cartridge_polarisation import SPEC, SPEC_PATH, frame_key
from compact_cartridge_flaps import rotate
from geometry import bounds, box, overlaps

ROOT = Path(__file__).resolve().parents[1]


def main():
    started = perf_counter()
    flap_path = ROOT / "build/reports/compact-cartridge-flaps.json"
    frame_path = ROOT / "build/reports/compact-cartridge-frame.json"
    bank_path = ROOT / "build/reports/compact-cartridge-bank.json"
    structure_path = ROOT / "build/reports/compact-structure.json"
    flaps = json.loads(flap_path.read_text())
    frame = json.loads(frame_path.read_text())
    bank = json.loads(bank_path.read_text())
    structure = json.loads(structure_path.read_text())
    assert not frame["material_interferences"]
    assert not bank["material_intersections"]
    paths = [
        Path(__file__),
        SPEC_PATH,
        flap_path,
        frame_path,
        bank_path,
        structure_path,
        ROOT / "cad/cartridge_polarisation.py",
    ]

    def load(row):
        path = ROOT / row["brep"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"]
        return cq.Shape.importBrep(str(path))

    metal = load(frame["physical_parts"]["COMPACT_FRAME_METAL"])
    lid = load(structure["physical_parts"]["CASE__REMOVABLE_LID"])
    fixed_frame = {n: load(r) for n, r in frame["physical_parts"].items()}
    bank_step = ROOT / "build/exports/compact_cartridge_bank.step"
    assert (
        hashlib.sha256(bank_step.read_bytes()).hexdigest()
        == bank["output_sha256"][str(bank_step.relative_to(ROOT))]
    )
    bank_shapes = {
        n.rsplit("/", 1)[-1]: s.located(loc).translate((170, 110, 0))
        for s, n, loc, colour in cq.Assembly.importStep(str(bank_step))
    }
    assert len(bank_shapes) == 12
    tolerance = SPEC["tolerance_budget_mm"]
    rib, channel = SPEC["frame_rib_local_bounds_mm"], SPEC["shell_channel_local_bounds_mm"]
    nominal_fit = min(rib[1] - channel[1], channel[4] - rib[4], channel[3] - rib[3])
    minimum_fit = nominal_fit - tolerance["frame_rib_surface"] - tolerance["shell_channel_surface"]
    free_half_width = (SPEC["nominal_roof_aperture_mm"][0] - 110) / 2
    maximum_X_shift = (
        free_half_width
        + tolerance["roof_aperture_edge"]
        + tolerance["shell_external_surface"]
        + tolerance["roof_to_frame_XY"]
    )
    maximum_Y_shift = (
        (SPEC["nominal_roof_aperture_mm"][1] - 18) / 2
        + tolerance["roof_aperture_edge"]
        + tolerance["shell_external_surface"]
        + tolerance["roof_to_frame_XY"]
    )
    reversed_overlap = (
        rib[3]
        - tolerance["frame_rib_surface"]
        - (-55 + tolerance["shell_external_surface"] + maximum_X_shift)
    )
    blocked_lift = rib[5] - SPEC["nominal_shell_bottom_Z_mm"]
    board_clearance = (
        SPEC["nominal_lowest_card_edge_Z_mm"] + blocked_lift - SPEC["nominal_socket_mouth_Z_mm"]
    )
    minimum_board_clearance = (
        board_clearance
        - tolerance["frame_key_top_Z"]
        - tolerance["shell_to_board_Z"]
        - tolerance["socket_top_Z"]
    )
    # Both same-front stops bracket the entire PCB width. Roll cannot lower
    # an interior PCB point below both supports. Pitch/yaw can contribute at
    # most the full transverse distance from a front shell support to either
    # PCB face:9mm shell half-depth +0.8mm board half-thickness. The norm is
    # rotation-independent and deliberately does not take credit for the roof
    # excluding steep angles. Any earlier roof contact only increases clearance.
    support_to_board_radius = math.hypot(
        SPEC["nominal_shell_bottom_Z_mm"] - SPEC["nominal_lowest_card_edge_Z_mm"], 9 + 0.8
    )
    minimum_tilted_clearance = (
        rib[5]
        - support_to_board_radius
        - SPEC["nominal_socket_mouth_Z_mm"]
        - tolerance["frame_key_top_Z"]
        - tolerance["shell_to_board_Z"]
        - tolerance["socket_top_Z"]
    )
    requirements = SPEC["requirements"]
    assert minimum_fit >= requirements["minimum_correct_running_clearance_mm"] - 1e-9
    assert reversed_overlap >= requirements["minimum_reversed_lateral_overlap_mm"]
    assert minimum_board_clearance >= requirements["minimum_reversed_board_to_mouth_clearance_mm"]
    assert minimum_tilted_clearance >= requirements["minimum_reversed_board_to_mouth_clearance_mm"]
    checks = []
    tilted_checks = []
    export = cq.Assembly(name="BMSX_CARTRIDGE_POLARISATION")
    export.add(metal, name="MACHINED_FRAME_WITH_TWO_KEYS")
    frame_boxes = {n: bounds(s) for n, s in fixed_frame.items()}
    for slot, (x, y) in enumerate(SPEC["slot_centres_XY_mm"]):
        key = frame_key([x, y])
        assert key.intersect(metal).Volume() >= key.Volume() - 1e-6
        cards = {
            n: s
            for n, s in bank_shapes.items()
            if n.startswith(f"SLOT{slot}__") and not n.endswith("SOCKET")
        }
        assert len(cards) == 5
        reversed_cards = {n: s.rotate((x, y, 0), (x, y, 1), 180) for n, s in cards.items()}
        # Every posed solid is the current native card, not a substitute box.
        for lift in [0, 10, blocked_lift, 28, 40, 75]:
            for name, card in cards.items():
                placed = card.translate((0, 0, lift))
                for peer, obstacle in fixed_frame.items():
                    if not overlaps(bounds(placed), frame_boxes[peer]):
                        continue
                    volume = placed.intersect(obstacle).Volume(tol=1e-10)
                    assert volume < 1e-5, (slot, lift, name, peer, volume)
                    checks.append(
                        {
                            "slot": slot,
                            "direction": "correct",
                            "lift_mm": lift,
                            "parts": [name, peer],
                            "intersection_mm3": volume,
                        }
                    )
        for dx in [-maximum_X_shift, 0, maximum_X_shift]:
            for dy in [-maximum_Y_shift, 0, maximum_Y_shift]:
                shell = cq.Compound.makeCompound(
                    [s for n, s in reversed_cards.items() if n.endswith(("SHELL", "COVER"))]
                )
                at_stop = shell.translate((dx, dy, blocked_lift))
                below_stop = shell.translate((dx, dy, blocked_lift - 0.1))
                volume = at_stop.intersect(key).Volume(tol=1e-10)
                penetration = below_stop.intersect(key).Volume(tol=1e-10)
                assert volume < 1e-5 and at_stop.distance(key) < 1e-6
                assert penetration > 0.01, (slot, dx, dy, penetration)
                checks.append(
                    {
                        "slot": slot,
                        "direction": "reversed",
                        "shift_XY_mm": [dx, dy],
                        "blocked_lift_mm": blocked_lift,
                        "intersection_at_stop_mm3": volume,
                        "penetration_0_1mm_below_stop_mm3": penetration,
                    }
                )
        local_lid = lid.intersect(box([x - 60, y - 15, 46, x + 60, y + 15, 60]))
        for roll, pitch, yaw in [
            (13, 0, 0),
            (-13, 0, 0),
            (0, 30, 0),
            (0, -30, 0),
            (10, 25, 1),
            (-10, -25, -1),
            (10, -25, -1),
            (-10, 25, 1),
        ]:
            posed = {
                n: s.rotate((x, y, 34.4), (x, y + 1, 34.4), roll)
                .rotate((x, y, 34.4), (x + 1, y, 34.4), pitch)
                .rotate((x, y, 34.4), (x, y, 35.4), yaw)
                for n, s in reversed_cards.items()
            }
            shell = cq.Compound.makeCompound(
                [s for n, s in posed.items() if n.endswith(("SHELL", "COVER"))]
            )
            lo, hi = 0, 75
            assert shell.intersect(key).Volume() > 1e-5
            assert shell.translate((0, 0, hi)).intersect(key).Volume() < 1e-5
            for _ in range(30):
                mid = (lo + hi) / 2
                if shell.translate((0, 0, mid)).intersect(key).Volume(tol=1e-10) > 1e-8:
                    lo = mid
                else:
                    hi = mid
            pcb = posed[f"SLOT{slot}__PCB"].translate((0, 0, hi))
            edge_clearance = bounds(pcb)[2] - SPEC["nominal_socket_mouth_Z_mm"]
            assert edge_clearance >= minimum_tilted_clearance
            roof_intersection = shell.translate((0, 0, hi)).intersect(local_lid).Volume(tol=1e-10)
            tilted_checks.append(
                {
                    "slot": slot,
                    "roll_pitch_yaw_degrees": [roll, pitch, yaw],
                    "key_stop_lift_mm": hi,
                    "PCB_to_mouth_mm": edge_clearance,
                    "lid_intersection_at_key_stop_mm3": roof_intersection,
                    "roof_blocks_even_earlier": roof_intersection > 1e-5,
                }
            )
        chosen = reversed_cards if slot == 0 else cards
        for name, s in chosen.items():
            export.add(
                s.translate((0, 0, blocked_lift if slot == 0 else 0)), name=f"SLOT{slot}__{name}"
            )

    # A rotating point keeps its X and radius about the hinge. All key stock
    # within the leaf X range lies beyond the unrelieved hinge shoulder radius.
    relief = SPEC["leaf_relief_local_bounds_mm"]
    hinge_y, hinge_z = 100.1, 54.7
    minimum_key_radius = math.hypot(rib[1] + 110 - hinge_y, rib[5] - hinge_z)
    shoulder_radius = math.hypot(relief[1] + 110 - hinge_y, 0.4)
    radial_separation = minimum_key_radius - shoulder_radius
    leaf_key_X_clearance = relief[3] - rib[3]
    minimum_leaf_X_clearance = (
        leaf_key_X_clearance
        - tolerance["leaf_axial_end_float_each_direction"]
        - tolerance["frame_rib_surface"]
        - tolerance["leaf_surface"]
    )
    minimum_leaf_radial_clearance = (
        radial_separation
        - tolerance["frame_rib_surface"]
        - tolerance["leaf_surface"]
        - tolerance["hinge_axis_YZ"]
        - tolerance["pin_to_journal_radial_clearance"]
    )
    assert radial_separation > 1.3 and leaf_key_X_clearance > 0.59
    assert minimum_leaf_X_clearance > 0.39 and minimum_leaf_radial_clearance > 0.9
    door_checks = []
    card_door_checks = []
    seated_angle = flaps["states"]["seated"]["angle_degrees"]
    for slot, (x, y) in enumerate(SPEC["slot_centres_XY_mm"]):
        leaf = load(flaps["physical_parts"][f"FLAP__SLOT{slot}__LEAF"])
        for angle in [*range(0, 90, 5), seated_angle, 89.9]:
            moved = rotate(leaf, y - 9.9, angle)
            for axial_shift in [-0.4, 0.4]:
                shifted = moved.translate((axial_shift, 0, 0))
                for peer, obstacle in fixed_frame.items():
                    if not overlaps(bounds(shifted), frame_boxes[peer]):
                        continue
                    volume = shifted.intersect(obstacle).Volume(tol=1e-10)
                    assert volume < 1e-5, (slot, angle, axial_shift, peer, volume)
                    door_checks.append(
                        {
                            "slot": slot,
                            "angle_degrees": angle,
                            "axial_shift_mm": axial_shift,
                            "peer": peer,
                            "intersection_mm3": volume,
                        }
                    )
            for peer, obstacle in fixed_frame.items():
                if not overlaps(bounds(moved), frame_boxes[peer]):
                    continue
                volume = moved.intersect(obstacle).Volume(tol=1e-10)
                assert volume < 1e-5, (slot, angle, peer, volume)
                door_checks.append(
                    {"slot": slot, "angle_degrees": angle, "peer": peer, "intersection_mm3": volume}
                )
            theta = math.radians(angle)
            cards = {
                n: s
                for n, s in bank_shapes.items()
                if n.startswith(f"SLOT{slot}__") and not n.endswith("SOCKET")
            }
            lift = max(
                0,
                max(
                    hinge_z
                    - (bounds(s)[1] - (y - 9.9)) * math.tan(theta)
                    + 0.4 / math.cos(theta)
                    - bounds(s)[2]
                    for s in cards.values()
                ),
            )
            for name, card in cards.items():
                placed = card.translate((0, 0, lift))
                volume = placed.intersect(moved).Volume(tol=1e-10)
                assert volume < 1e-5, (slot, angle, name, volume)
                card_door_checks.append(
                    {
                        "slot": slot,
                        "angle_degrees": angle,
                        "lift_mm": lift,
                        "card_part": name,
                        "intersection_mm3": volume,
                    }
                )
    target = ROOT / "build/exports/BMSX_CARTRIDGE_POLARISATION.step"
    export.export(str(target))
    restored = cq.importers.importStep(str(target)).val()
    expected_solids = len(metal.Solids()) + sum(
        len(s.Solids()) for n, s in bank_shapes.items() if not n.endswith("SOCKET")
    )
    assert restored.isValid() and len(restored.Solids()) == expected_solids
    detail = cq.Assembly(name="BMSX_CARTRIDGE_POLARISATION_DETAIL")
    region = box([110, 99, 20, 138, 121, 68])
    detail_solids = 0
    for tag, reversed_entry, shift in [
        ("CORRECT_SEATED", False, 0),
        ("REVERSED_BLOCKED", True, 40),
    ]:
        context = fixed_frame | {"SOCKET": bank_shapes["SLOT0__SOCKET"]}
        context.update(
            {
                n: (
                    s.rotate((170, 110, 0), (170, 110, 1), 180).translate((0, 0, blocked_lift))
                    if reversed_entry
                    else s
                )
                for n, s in bank_shapes.items()
                if n.startswith("SLOT0__") and not n.endswith("SOCKET")
            }
        )
        for name, s in context.items():
            if not overlaps(bounds(s), bounds(region)):
                continue
            section = s.intersect(region)
            if section.Volume() < 1e-6:
                continue
            assert section.isValid()
            detail.add(section.translate((shift, 0, 0)), name=tag + "__" + name)
            detail_solids += len(section.Solids())
    detail_target = ROOT / "build/exports/BMSX_CARTRIDGE_POLARISATION_DETAIL.step"
    detail.export(str(detail_target))
    detail_restored = cq.importers.importStep(str(detail_target)).val()
    assert detail_restored.isValid() and len(detail_restored.Solids()) == detail_solids
    result = {
        "scope": __doc__,
        "input_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths
        },
        "minimum_correct_running_clearance_mm": minimum_fit,
        "maximum_aperture_translation_XY_mm": [maximum_X_shift, maximum_Y_shift],
        "minimum_reversed_lateral_overlap_mm": reversed_overlap,
        "nominal_reversed_blocked_lift_mm": blocked_lift,
        "nominal_reversed_board_to_socket_mouth_mm": board_clearance,
        "minimum_reversed_board_to_socket_mouth_mm": minimum_board_clearance,
        "tilted_insertion_bound": {
            "two_same_front_keys_bracket_PCB_width": True,
            "maximum_support_to_board_radius_mm": support_to_board_radius,
            "minimum_board_to_mouth_clearance_mm": minimum_tilted_clearance,
            "scope": "Rigid shell; both side walls intact. Rotation-independent conservative bound without taking credit for earlier roof contact. Manufacturing Z allowances deducted.",
        },
        "return_wall_mm": SPEC["shell_return_wall_mm"],
        "continuous_door_clearance": {
            "unrelieved_shoulder_radial_separation_mm": radial_separation,
            "relieved_edge_to_key_X_mm": leaf_key_X_clearance,
            "minimum_X_clearance_after_end_float_and_surfaces_mm": minimum_leaf_X_clearance,
            "minimum_radial_separation_after_hinge_and_surfaces_mm": minimum_leaf_radial_clearance,
            "scope": "All angles0..89.9 degrees. Includes0.4mm axial float each way,0.1mm radial pin/bore clearance and declared surface/axis allowances.",
        },
        "insertion_checks": checks,
        "native_tilted_reversal_checks": tilted_checks,
        "native_door_checks": door_checks,
        "native_card_door_checks": card_door_checks,
        "unchanged_electrical_geometry": [
            "SOCKET",
            "PCB",
            "FINGERS",
            "ROMS",
            "62 terminal assignments and locations",
        ],
        "output_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [target, detail_target]
        },
        "STEP_roundtrip": {"valid": True, "solids": len(restored.Solids())},
        "detail_STEP_roundtrip": {
            "valid": True,
            "solids": detail_solids,
            "section_bounds_mm": bounds(region),
            "second_state_X_shift_mm": 40,
        },
        "not_proven": SPEC["not_proven"],
        "pass": True,
        "fabrication_release": False,
        "elapsed_seconds": perf_counter() - started,
    }
    (ROOT / "build/reports/cartridge-polarisation.json").write_text(
        json.dumps(result, indent=2) + "\n"
    )
    print(
        json.dumps(
            {
                k: result[k]
                for k in [
                    "minimum_correct_running_clearance_mm",
                    "minimum_reversed_lateral_overlap_mm",
                    "minimum_reversed_board_to_socket_mouth_mm",
                    "continuous_door_clearance",
                    "STEP_roundtrip",
                    "elapsed_seconds",
                ]
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
