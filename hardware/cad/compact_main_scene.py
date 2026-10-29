"""Place scoped component geometry from the current native KiCad mainboard.

Models are footprint-local source geometry. KiCad owns actual component pose
and population; neither historical board snapshots nor generated reports are
editable placement specifications. Each representation retains its scope.
"""

import hashlib
import json
from collections import defaultdict
from itertools import combinations
from pathlib import Path
from time import perf_counter

import cadquery as cq
from geometry import bounds, overlaps

ROOT = Path(__file__).resolve().parents[1]


def main():
    started = perf_counter()
    manifest_path = ROOT / "models/mainboard/manifest.json"
    board_path = ROOT / "build/reports/mainboard.json"
    manifest = json.loads(manifest_path.read_text())
    board = json.loads(board_path.read_text())
    population = {row["ref"]: row for row in board["placements"]}
    paths = [
        Path(__file__),
        ROOT / "cad/geometry.py",
        manifest_path,
        board_path,
        ROOT / board["board_source"],
    ]
    pieces, sources = defaultdict(list), defaultdict(list)
    for model in manifest["parts"]:
        path = ROOT / model["brep"]
        paths.append(path)
        assert hashlib.sha256(path.read_bytes()).hexdigest() == model["sha256"]
        native = cq.Shape.importBrep(str(path))
        pose = population[model["ref"]]
        x, y = pose["position_mm"]
        shape = native.rotate((0, 0, 0), (0, 0, 1), -pose["rotation_degrees"]).translate((x, y, 0))
        assert shape.isValid() and len(shape.Solids()) == model["solid_count"]
        assert abs(shape.Volume(tol=1e-10) - native.Volume(tol=1e-10)) < 1e-5
        pieces[model["ref"]].append(shape)
        sources[model["ref"]].append(
            {
                "model": model["brep"],
                "sha256": model["sha256"],
                "representation": model["representation"],
            }
        )
    generated = ROOT / "build/cad/compact_main_scene"
    generated.mkdir(parents=True, exist_ok=True)
    assembly = cq.Assembly(name="BMSX_MAINBOARD_COMPONENTS")
    shapes, rows, outputs = {}, [], []
    for ref, components in sorted(pieces.items()):
        # An owner's nominal body and explicit assembly allocations are one
        # occupied component, not falsely reported as independent overlaps.
        shape = components[0].fuse(*components[1:]) if len(components) > 1 else components[0]
        assert shape.isValid()
        name = "MAIN__" + ref
        shapes[name] = shape
        target = generated / (name + ".brep")
        shape.exportBrep(str(target))
        outputs.append(target)
        assembly.add(shape, name=name, color=cq.Color(0.33, 0.36, 0.38))
        rows.append(
            {
                "name": name,
                "ref": ref,
                "bounds_mm": bounds(shape),
                "volume_mm3": shape.Volume(tol=1e-10),
                "solid_count": len(shape.Solids()),
                "source_pieces": sources[ref],
                "brep": str(target.relative_to(ROOT)),
                "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                "regions_mm": [bounds(shape)],
                "module": "main",
            }
        )
    export = ROOT / "build/exports/BMSX_COMPACT_components.step"
    export.parent.mkdir(parents=True, exist_ok=True)
    assembly.export(str(export))
    outputs.append(export)
    restored = {
        name.rsplit("/", 1)[-1]: shape.located(loc)
        for shape, name, loc, color in cq.Assembly.importStep(str(export))
    }
    assert restored.keys() == shapes.keys()
    for name, shape in restored.items():
        assert shape.isValid() and len(shape.Solids()) == len(shapes[name].Solids())
        assert (
            max(abs(a - b) for a, b in zip(bounds(shape), bounds(shapes[name]), strict=True)) < 1e-5
        )
        assert abs(shape.Volume(tol=1e-10) - shapes[name].Volume(tol=1e-10)) < 1e-4
    checks, hits = [], []
    for first, second in combinations(rows, 2):
        if not overlaps(first["bounds_mm"], second["bounds_mm"]):
            continue
        volume = shapes[first["name"]].intersect(shapes[second["name"]]).Volume(tol=1e-10)
        row = {"a": first["name"], "b": second["name"], "material_intersection_mm3": volume}
        checks.append(row)
        if volume > 1e-5:
            hits.append(row)
    represented = set(pieces)
    external = set(manifest["external_refs"])
    fitted = {
        ref for ref, row in population.items() if not row["dnp"] and not row["excluded_from_bom"]
    }
    missing = sorted(fitted - represented - external)
    result = {
        "scope": __doc__,
        "physical_parts": {
            row["name"]: {k: v for k, v in row.items() if k != "name"} for row in rows
        },
        "receiving_spaces": {},
        "represented_fitted_main_refs": len(represented),
        "preserved_input_BRep_pieces": len(manifest["parts"]),
        "source_board": board["board_source"],
        "missing_required_main_bindings": missing,
        "external_component_owners": {"cartridge": sorted(external)},
        "native_nonbody_features_without_invented_models": [
            row for ref, row in population.items() if ref not in represented | external
        ],
        "new_main_component_pair_checks": {
            "exact_material_intersection_tests": len(checks),
            "checks": checks,
            "material_intersections": hits,
        },
        "named_STEP_roundtrip": {
            "named_objects": len(restored),
            "unique_names_validity_bounds_solids_volumes_pass": True,
        },
        "input_sha256": {
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in paths
        },
        "output_sha256": {
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in outputs
        },
        "fabrication_release": False,
        "elapsed_seconds": perf_counter() - started,
    }
    report = ROOT / "build/reports/compact-main-scene.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(result, indent=2) + "\n")
    print(
        json.dumps(
            {
                "parts": len(rows),
                "missing": missing,
                "intersections": hits,
                "elapsed_seconds": result["elapsed_seconds"],
            },
            indent=2,
        )
    )
    assert not (missing or hits)


if __name__ == "__main__":
    main()
