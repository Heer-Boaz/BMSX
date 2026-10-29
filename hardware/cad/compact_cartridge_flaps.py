"""Native inward cartridge covers with split journals and torsion-return proposals.

BOSL2 pinned450f7fa5fc5222279ca4c4e564e1a6c01ccdd57c hinges.scad
informs real pin/knuckle clearances. CadQuery owns BRep operations and STEP.
The coil is a receiving/design proposal, not a spring-rate or fatigue proof.
"""

import hashlib
import json
import math
from pathlib import Path
from time import perf_counter

import cadquery as cq
from cartridge_polarisation import SPEC, SPEC_PATH, leaf_relief, shell_with_channel
from cartridge_return_spring import build_return_spring
from geometry import bounds, box, cylinder, overlaps

ROOT = Path(__file__).resolve().parents[1]


def rotate(shape, y, angle):
    return shape.rotate((0, y, 54.7), (1, y, 54.7), -angle)


def main():
    start = perf_counter()
    spec_path = ROOT / "design/cartridge_flaps.json"
    spec = json.loads(spec_path.read_text())
    source = ROOT / "models/cartridge/manifest.json"
    bank = json.loads(source.read_text())
    frame_plan = json.loads((ROOT / "design/enclosure_cartridge_frame.json").read_text())
    out = ROOT / "build/cad/cartridge_flaps"
    out.mkdir(parents=True, exist_ok=True)
    fixed = {}
    moving = {}
    adds = {}
    cuts = {}
    materials = {}
    source_paths = [
        Path(__file__),
        spec_path,
        source,
        ROOT / "design/enclosure_cartridge_frame.json",
        ROOT / "cad/cartridge_return_spring.py",
        ROOT / "cad/geometry.py",
        SPEC_PATH,
        ROOT / "cad/cartridge_polarisation.py",
    ]
    leaf_service_shapes = {}
    for slot, (y, hinge_z) in enumerate(spec["hinge_axes"]):
        assert hinge_z == 54.7
        prefix = f"FLAP__SLOT{slot}__"
        _, leg_space, _ = build_return_spring(y, hinge_z, 0)
        cuts[prefix + "SPRING_LEG_SPACE"] = leg_space
        leaf = box(spec["leaf_bounds_slot0_mm"]).translate((0, y - spec["hinge_axes"][0][0], 0))
        leaf_sweep_bounds = list(spec["leaf_bounds_slot0_mm"])
        leaf_sweep_bounds[5] = 131
        leaf_service = box(leaf_sweep_bounds).translate((0, y - spec["hinge_axes"][0][0], 0))
        for a, b in [(112.7, 114.7), (225.3, 227.3)]:
            tube = cylinder((a, y, 54.7), (1, 0, 0), spec["leaf_knuckle_OD_mm"] / 2, b - a).cut(
                cylinder((a - 0.1, y, 54.7), (1, 0, 0), spec["journal_bore_mm"] / 2, b - a + 0.2)
            )
            leaf = leaf.fuse(tube)
            leaf_service = leaf_service.fuse(box([a, y - 1.6, 53.1, b, y + 1.6, 131]))
            cuts[prefix + f"KNUCKLE_SPACE_{a}"] = cylinder(
                (a - 0.2, y, 54.7), (1, 0, 0), 1.8, b - a + 0.4
            )
        leaf = leaf.cut(cylinder((112.6, y, 54.7), (1, 0, 0), spec["journal_bore_mm"] / 2, 114.8))
        moving[prefix + "LEAF"] = leaf.clean()
        materials[prefix + "LEAF"] = "polymer"
        pin = cylinder((107.5, y, 54.7), (1, 0, 0), spec["pin_diameter_mm"] / 2, 124.5).fuse(
            cylinder((107, y, 54.7), (1, 0, 0), 1, 0.5)
        )
        fixed[prefix + "STEEL_PIN"] = pin
        materials[prefix + "STEEL_PIN"] = "steel"
        cuts[prefix + "COMPLETE_SHAFT_CHANNEL"] = cylinder(
            (106.8, y, hinge_z), (1, 0, 0), spec["journal_bore_mm"] / 2, 125.4
        )
        # A real removable lower journal allows the preassembled pin and leaf
        # to be offered upwards; no impossible shaft insertion through a roof.
        for end, x in [("L", 111.3), ("R", 228.7)]:
            cap = box([x - 2.3, y - 8, 48.8, x + 2.3, y + 8, 50.3]).fuse(
                box([x - 1, y - 2, 50.3, x + 1, y + 2, 54.7])
            )
            upper = cylinder((x - 1, y, 54.7), (1, 0, 0), 2, 2).intersect(
                box([x - 1, y - 2, 54.7, x + 1, y + 2, 56.7])
            )
            adds[prefix + end + "_UPPER_JOURNAL"] = upper
            cuts[prefix + end + "_JOURNAL_RECEIVER"] = box(
                [x - 1.2, y - 2.2, 48.5, x + 1.2, y + 2.2, 54.7]
            )
            bore = cylinder((x - 1.3, y, 54.7), (1, 0, 0), 0.85, 2.6)
            cap = cap.cut(bore)
            cuts[prefix + end + "_UPPER_BORE"] = bore
            if end == "L":
                cap = cap.cut(leg_space)
            for j, dy in enumerate([-5.8, 5.8]):
                yy = y + dy
                boss = cylinder((x, yy, 50.3), (0, 0, 1), 2.3, 4.7)
                adds[prefix + end + f"_BOSS_{j}"] = boss
                cuts[prefix + end + f"_TAPPED_RECEIVER_{j}"] = cylinder(
                    (x, yy, 50.2), (0, 0, 1), 1, 4.3
                )
                cap = cap.cut(cylinder((x, yy, 48.7), (0, 0, 1), 1.15, 1.7))
                screw = cylinder((x, yy, 46.8), (0, 0, 1), 1.9, 2).fuse(
                    cylinder((x, yy, 48.8), (0, 0, 1), 1, 5)
                )
                name = prefix + end + f"_M2x5_{j}"
                fixed[name] = screw
                materials[name] = "steel"
            name = prefix + end + "_LOWER_JOURNAL"
            fixed[name] = cap.clean()
            materials[name] = "polymer"
        # Closed stop outside the actual card width, bearing on the end ears.
        for end, a, b in [("L", 112.7, 114.7), ("R", 225.3, 227.3)]:
            adds[prefix + end + "_CLOSED_STOP"] = box(
                [111.8 if end == "L" else a, y + 1.8, 55.1, b if end == "L" else 228.2, y + 3, 55.7]
            )
            cuts[prefix + end + "_EAR_SWEEP"] = cylinder(
                (a - 0.2, y, hinge_z), (1, 0, 0), 3.1, b - a + 0.4
            ).intersect(box([a - 0.2, y - 0.5, hinge_z - 3.1, b + 0.2, y + 3.1, 55.1]))
            moving[prefix + "LEAF"] = (
                moving[prefix + "LEAF"].fuse(box([a, y + 1.3, 54.3, b, y + 3, 55.1])).clean()
            )
            leaf_service = leaf_service.fuse(box([a, y + 1.3, 54.3, b, y + 3, 131]))
        moving[prefix + "LEAF"] = (
            moving[prefix + "LEAF"]
            .cut(cylinder((112.55, y, 53.6), (1, 0, 0), 0.15, 1.3))
            .cut(leaf_relief(SPEC["slot_centres_XY_mm"][slot]))
            .clean()
        )
        leaf_service_shapes[prefix + "LEAF"] = leaf_service.cut(
            leaf_relief(SPEC["slot_centres_XY_mm"][slot], (53.0, 131.1))
        ).clean()
        anchor = box([107.8, y - 0.5, 51.4, 109.2, y + 3, 52.4]).fuse(
            box([107.8, y + 1.5, 52.4, 109.2, y + 3, 54])
        )
        adds[prefix + "FIXED_SPRING_ANCHOR"] = anchor
        cuts[prefix + "FIXED_SPRING_ANCHOR_BORE"] = cylinder((108.5, y, 51.3), (0, 0, 1), 0.15, 1.3)
        cuts[prefix + "SPRING_CAVITY"] = box([108.2, y - 1.5, 52.4, 110.1, y + 1.5, 56.2])
        adds[prefix + "SPRING_HOOD"] = box([108, y - 1.7, 53, 110.3, y + 1.7, 56.7])
        # Positive pin retention at the far end: removable transverse cotter.
        fixed[prefix + "PIN_RETAINING_CLIP"] = cylinder((231.5, y - 1.3, 54.7), (0, 1, 0), 0.2, 2.6)
        fixed[prefix + "STEEL_PIN"] = fixed[prefix + "STEEL_PIN"].cut(
            cylinder((231.5, y - 1.4, 54.7), (0, 1, 0), 0.22, 2.8)
        )
        materials[prefix + "PIN_RETAINING_CLIP"] = "steel"
        cuts[prefix + "PIN_HEAD_CAVITY"] = box([106.8, y - 1.2, 48.5, 108.1, y + 1.2, 55.9])
        cuts[prefix + "PIN_CLIP_CAVITY"] = box([230.9, y - 1.6, 48.5, 232.2, y + 1.6, 55.6])
    # Build current received cards directly, retaining each exact native shape.
    cards = {}
    for entry in bank["parts"]:
        if entry["slot"] != 0 or entry["role"] == "SOCKET":
            continue
        path = ROOT / entry["brep"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"]
        source_paths.append(path)
        shift = frame_plan["slots"][0]["translation_mm"]
        name = "BANK__" + entry["name"]
        cards[name] = cq.Shape.importBrep(str(path)).translate(tuple(shift))
        if entry["role"] == "SHELL":
            cards[name] = shell_with_channel(cards[name], SPEC["slot_centres_XY_mm"][0])
        materials[name] = "card_native"

    def lift_for_angle(angle):
        theta = math.radians(angle)
        required = 0
        for s in cards.values():
            b = bounds(s)
            z = 54.7 - (b[1] - 100.1) * math.tan(theta) + 0.4 / math.cos(theta)
            required = max(required, z - b[2])
        return required

    lo, hi = 80.0, 89.9
    for _ in range(60):
        angle = (lo + hi) / 2
        if lift_for_angle(angle) > 0:
            lo = angle
        else:
            hi = angle
    seated = hi
    insertion = 45.0
    lift = lift_for_angle(insertion)
    states = {}
    exportmap = {}
    checks = []
    hits = []

    def record(name, shape, tag):
        assert shape.isValid(), name
        if name.startswith("FLAP__"):
            assert len(shape.Solids()) == 1, (name, len(shape.Solids()))
        path = out / (tag + "__" + name + ".brep")
        shape.exportBrep(str(path))
        return {
            "brep": str(path.relative_to(ROOT)),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bounds_mm": bounds(shape),
            "regions_mm": [bounds(shape)],
            "module": "bank" if name in cards else "cartridge-flaps",
            "material": materials[name],
            "solids": len(shape.Solids()),
        }

    for state, angle, zlift in [
        ("closed", 0, 0),
        ("insertion", insertion, lift),
        ("seated", seated, 0),
    ]:
        parts = dict(fixed)
        for name, s in moving.items():
            parts[name] = rotate(
                s, 100.1 if "SLOT0" in name else 130.1, angle if "SLOT0" in name else 0
            )
        spring_geometry = {}
        for slot, (y, hinge_z) in enumerate(spec["hinge_axes"]):
            name = f"FLAP__SLOT{slot}__TORSION_SPRING_PROPOSAL"
            spring, _, metadata = build_return_spring(y, hinge_z, angle if slot == 0 else 0)
            parts[name] = spring
            materials[name] = "spring_steel"
            spring_geometry[name] = metadata
        if state != "closed":
            parts.update({n: s.translate((0, 0, zlift)) for n, s in cards.items()})
        names = list(parts)
        for n, part in parts.items():
            assert part.isValid() and len(part.Solids()) > 0, (state, n, "invalid/empty")
        for i, n in enumerate(names):
            if not n.startswith("FLAP__"):
                continue
            for peer in names[i + 1 :]:
                if not peer.startswith("FLAP__") or not overlaps(
                    bounds(parts[n]), bounds(parts[peer])
                ):
                    continue
                v = parts[n].intersect(parts[peer]).Volume(tol=1e-10)
                checks.append({"state": state, "parts": [n, peer], "intersection_mm3": v})
                if v >= 1e-5:
                    hits.append(checks[-1])
        rows = {n: record(n, s, state) for n, s in parts.items()}
        assembly = cq.Assembly(name="BMSX_CARTRIDGE_KLEPPEN_" + state)
        for n, s in parts.items():
            assembly.add(s, name=n)
        target = ROOT / ("build/exports/BMSX_CARTRIDGE_KLEPPEN_" + state + ".step")
        assembly.export(str(target))
        restored = {
            n.rsplit("/", 1)[-1]: s.located(loc)
            for s, n, loc, c in cq.Assembly.importStep(str(target))
        }
        assert restored.keys() == parts.keys()
        assert all(s.isValid() for s in restored.values())
        assert (
            abs(
                sum(s.Volume(tol=1e-10) for s in parts.values())
                - sum(s.Volume(tol=1e-10) for s in restored.values())
            )
            < 1e-4
        )
        exportmap[str(target.relative_to(ROOT))] = hashlib.sha256(target.read_bytes()).hexdigest()
        states[state] = {
            "angle_degrees": angle,
            "cartridge_lift_mm": zlift,
            "parts": rows,
            "named_STEP_roundtrip": True,
            "spring_geometry": spring_geometry,
        }
        leaf = parts["FLAP__SLOT0__LEAF"]
        if state != "closed":
            for n in cards:
                v = leaf.intersect(parts[n]).Volume(tol=1e-10)
                checks.append(
                    {
                        "state": state,
                        "parts": ["FLAP__SLOT0__LEAF", n],
                        "intersection_mm3": v,
                        "distance_mm": leaf.distance(parts[n]),
                    }
                )
                assert v < 1e-5, (state, n, v)
    ledger = {"additions": [], "cuts": []}
    for op, shapes in [("additions", adds), ("cuts", cuts)]:
        for n, s in shapes.items():
            path = out / (op + "__" + n + ".brep")
            s.exportBrep(str(path))
            ledger[op].append(
                {
                    "source_BRep": str(path.relative_to(ROOT)),
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "target": "removable_lid",
                    "bounds_mm": bounds(s),
                }
            )
    leaf_service_rows = {}
    for name, shape in leaf_service_shapes.items():
        path = out / ("SERVICE__" + name + ".brep")
        assert shape.isValid() and shape.exportBrep(str(path))
        leaf_service_rows[name] = {
            "brep": str(path.relative_to(ROOT)),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bounds_mm": bounds(shape),
        }
    result = {
        "scope": __doc__,
        "physical_parts": states["closed"]["parts"],
        "receiving_spaces": {},
        "actuation_by_slot": {
            str(i): [f"FLAP__SLOT{i}__LEAF", f"FLAP__SLOT{i}__TORSION_SPRING_PROPOSAL"]
            for i in [0, 1]
        },
        "states": states,
        "lid_leaf_service_envelopes": leaf_service_rows,
        "case_modifications": ledger,
        "kinematic_card_checks": checks,
        "presentation": {
            "section_bounds_mm": [170, 96, 32, 174, 124, 84],
            "section_focus_mm": [172, 110, 58],
        },
        "exports": exportmap,
        "material_intersections": hits,
        "input_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in source_paths
        },
        "not_proven": [
            "Spring rate, exact loaded-wire geometry and force/life qualification",
            "Plastic strength, manufacturing tolerances and repeated service",
        ],
        "fabrication_release": False,
        "elapsed_seconds": perf_counter() - start,
    }
    print(json.dumps({"material_intersections": hits}, indent=2))
    assert not hits, hits
    (ROOT / "build/reports/compact-cartridge-flaps.json").write_text(
        json.dumps(result, indent=2) + "\n"
    )
    print(
        json.dumps(
            {
                "states": {
                    s: {"angle": r["angle_degrees"], "lift": r["cartridge_lift_mm"]}
                    for s, r in states.items()
                },
                "elapsed_seconds": result["elapsed_seconds"],
            }
        )
    )


if __name__ == "__main__":
    main()
