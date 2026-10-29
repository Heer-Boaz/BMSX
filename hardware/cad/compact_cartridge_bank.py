"""Build one compact bank from preserved native parts and owned shell channels.

CadQuery's native assembly export/import owns named STEP round trips, as in the
existing case producer. This owner uses rigid placements and local
hashed BRep inputs; neither an installed source checkout nor an old case is
needed to rebuild the bank. No geometry exception or intersection suppression
is used for nominal mating contacts.
"""

import hashlib
import json
from itertools import combinations
from pathlib import Path
from time import perf_counter

import cadquery as cq
from cartridge_polarisation import SPEC_PATH, shell_with_channel

ROOT = Path(__file__).resolve().parents[1]


def main():
    started = perf_counter()
    plan_path = ROOT / "design/compact_cartridge_bank.json"
    plan = json.loads(plan_path.read_text())
    appearance_path = ROOT / "design/enclosure_appearance.json"
    appearance = json.loads(appearance_path.read_text())
    cache_path = ROOT / plan["input_manifest"]
    cache = json.loads(cache_path.read_text())
    slots = {s["slot"]: s for s in plan["slots"]}
    shapes = {}
    rows = []
    paths = [
        Path(__file__),
        plan_path,
        cache_path,
        appearance_path,
        SPEC_PATH,
        ROOT / "cad/cartridge_polarisation.py",
    ]
    output = ROOT / "build/cad/compact_cartridge_bank"
    output.mkdir(parents=True, exist_ok=True)
    output_hashes = {}
    assembly = cq.Assembly(name="BMSX_COMPACT_CARTRIDGE_BANK_CANDIDATE_1")
    palette = {
        "SOCKET": (0.19, 0.20, 0.21),
        "SHELL": appearance["palette"]["cartridge_body"],
        "COVER": appearance["palette"]["cartridge_body"],
        "PCB": (0.12, 0.37, 0.23),
        "FINGERS": (0.78, 0.61, 0.18),
        "ROMS": (0.12, 0.12, 0.13),
    }
    for entry in cache["parts"]:
        path = ROOT / entry["brep"]
        paths.append(path)
        assert hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"], entry["name"]
        source = cq.Shape.importBrep(str(path))
        assert source.isValid(), entry["name"]
        shift = slots[entry["slot"]]["translation_mm"]
        shape = source.translate(tuple(shift))
        assert shape.isValid(), entry["name"]
        b = shape.BoundingBox()
        bounds = [b.xmin, b.ymin, b.zmin, b.xmax, b.ymax, b.zmax]
        assert (
            max(abs(bounds[i] - entry["source_bounds_mm"][i] - shift[i % 3]) for i in range(6))
            < 1e-6
        ), entry["name"]
        assert abs(shape.Volume() - source.Volume()) < 1e-6, entry["name"]
        if entry["role"] == "SHELL":
            shape = shell_with_channel(shape, slots[entry["slot"]]["target_socket_centre_XY_mm"])
            assert shape.isValid() and len(shape.Solids()) == 1, entry["name"]
        shapes[entry["name"]] = shape
        native_path = output / (entry["name"] + ".brep")
        assert shape.exportBrep(str(native_path))
        native_hash = hashlib.sha256(native_path.read_bytes()).hexdigest()
        output_hashes[str(native_path.relative_to(ROOT))] = native_hash
        rows.append(
            {
                "name": entry["name"],
                "slot": entry["slot"],
                "role": entry["role"],
                "bounds_mm": bounds,
                "native_volume_mm3": shape.Volume(),
                "native_solid_count": len(shape.Solids()),
                "translation_mm": shift,
                "input_BRep": entry["brep"],
                "shell_channel_applied": entry["role"] == "SHELL",
                "brep": str(native_path.relative_to(ROOT)),
                "sha256": native_hash,
            }
        )
        assembly.add(shape, name=entry["name"], color=cq.Color(*palette[entry["role"]]))
    assert len(shapes) == 12
    pairs = []
    hits = []
    for a, b in combinations(rows, 2):
        overlap = [
            min(a["bounds_mm"][i + 3], b["bounds_mm"][i + 3])
            - max(a["bounds_mm"][i], b["bounds_mm"][i])
            for i in range(3)
        ]
        candidate = all(v > 0 for v in overlap)
        volume = shapes[a["name"]].intersect(shapes[b["name"]]).Volume() if candidate else 0
        row = {
            "parts": [a["name"], b["name"]],
            "between_slots": a["slot"] != b["slot"],
            "positive_AABB_overlap": candidate,
            "material_intersection_mm3": volume,
        }
        pairs.append(row)
        if volume > 1e-6:
            hits.append(row)
    socket_extents = [
        {
            "name": r["name"],
            "native_length_mm": r["bounds_mm"][3] - r["bounds_mm"][0],
            "native_depth_mm": r["bounds_mm"][4] - r["bounds_mm"][1],
            "native_total_height_including_tails_mm": r["bounds_mm"][5] - r["bounds_mm"][2],
            "body_height_above_board_mm": r["bounds_mm"][5]
            - plan["preserved_seating_Z_mm"]["motherboard_top"],
            "tail_projection_below_board_mm": plan["preserved_seating_Z_mm"]["motherboard_top"]
            - r["bounds_mm"][2],
        }
        for r in rows
        if r["role"] == "SOCKET"
    ]
    groups = [
        cq.Compound.makeCompound([shapes[e["name"]] for e in rows if e["slot"] == i])
        for i in range(2)
    ]
    group_clearance = groups[0].distance(groups[1])
    shell_rows = [r for r in rows if r["role"] in ["SHELL", "COVER"]]
    shell_bounds = [min(r["bounds_mm"][i] for r in shell_rows) for i in range(3)] + [
        max(r["bounds_mm"][i + 3] for r in shell_rows) for i in range(3)
    ]
    shell_span = [shell_bounds[i + 3] - shell_bounds[i] for i in range(2)]
    assert (
        max(
            abs(a - b)
            for a, b in zip(shell_span, plan["expected_native_shell_plan_span_mm"], strict=True)
        )
        < 1e-6
    )
    assert abs(group_clearance - plan["expected_native_shell_gap_mm"]) < 1e-6
    assert not hits, hits
    export = ROOT / "build/exports/compact_cartridge_bank.step"
    assembly.export(str(export))
    restored = {
        n.rsplit("/", 1)[-1]: s.located(loc)
        for s, n, loc, color in cq.Assembly.importStep(str(export))
    }
    assert restored.keys() == shapes.keys()
    for name, shape in restored.items():
        assert shape.isValid(), name
        b = shape.BoundingBox()
        bounds = [b.xmin, b.ymin, b.zmin, b.xmax, b.ymax, b.zmax]
        expected = next(r["bounds_mm"] for r in rows if r["name"] == name)
        assert max(abs(a - b) for a, b in zip(bounds, expected, strict=True)) < 1e-5, name
        assert abs(shape.Volume() - shapes[name].Volume()) < 1e-5, name
    report = {
        "scope": __doc__,
        "input_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths
        },
        "parts": rows,
        "native_socket_extents": socket_extents,
        "shell_group_bounds_mm": shell_bounds,
        "shell_plan_span_mm": shell_span,
        "minimum_between_slot_native_clearance_mm": group_clearance,
        "pair_checks": pairs,
        "material_intersections": hits,
        "material_intersection_allowlist": [],
        "no_overlap_suppression": True,
        "all_non_shell_input_volumes_and_seating_preserved": True,
        "shell_channel_owner": "design/cartridge_polarisation.json",
        "named_STEP_roundtrip": {
            "named_objects": len(restored),
            "valid_unique_names_bounds_and_volumes_pass": True,
        },
        "output_sha256": output_hashes
        | {str(export.relative_to(ROOT)): hashlib.sha256(export.read_bytes()).hexdigest()},
        "maker_nominal_data": plan["selected_connector"],
        "not_proven": plan["not_proven"],
        "whole_board_or_enclosure_fit_approved": False,
        "fabrication_release": False,
        "elapsed_seconds": perf_counter() - started,
    }
    (ROOT / "build/reports/compact-cartridge-bank.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )
    print(
        json.dumps(
            {
                k: report[k]
                for k in [
                    "shell_plan_span_mm",
                    "minimum_between_slot_native_clearance_mm",
                    "material_intersections",
                    "named_STEP_roundtrip",
                    "elapsed_seconds",
                ]
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
