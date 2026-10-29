"""Local pad-loom bracket and receiving-space candidate, not an installed assembly.

Checks nominal CadQuery solids against the retained assembly and inserted-card
study.  The former frame screw is removed for this alternate-placement study;
only the proposed new screw head and its tool approach are represented.
"""

import hashlib
import json
from pathlib import Path
from time import perf_counter

import cadquery as cq
from geometry import bounds, box, cylinder, overlaps

ROOT = Path(__file__).resolve().parents[1]


def main():
    start = perf_counter()
    assembly_path = ROOT / "build/reports/compact-assembly.json"
    cards_path = ROOT / "build/reports/compact-packaging-fit.json"
    assembly = json.loads(assembly_path.read_text())
    cards = json.loads(cards_path.read_text())
    bracket = box([118, 151, 29.6, 137, 153, 35.4]).fuse(box([118, 151, 33.4, 137, 164.5, 35.4]))
    bracket = bracket.cut(cylinder([121, 150.5, 32], [0, 1, 0], 1.1, 3))
    for y in (152.7, 161.5):
        bracket = bracket.cut(box([126.2, y, 29, 129.8, y + 1.6, 36]))
    bracket = bracket.clean()
    assert bracket.isValid() and len(bracket.Solids()) == 1

    vector = cq.Vector
    edges = [
        cq.Edge.makeLine(vector(232.75, 80, 41.5), vector(232.75, 139, 41.5)),
        cq.Edge.makeThreePointArc(
            vector(232.75, 139, 41.5),
            vector(228.06370849898477, 150.31370849898477, 41.5),
            vector(216.75, 155, 41.5),
        ),
        cq.Edge.makeLine(vector(216.75, 155, 41.5), vector(160, 155, 41.5)),
        cq.Edge.makeBezier(
            [
                vector(160, 155, 41.5),
                vector(153, 155, 41.5),
                vector(147, 156.5, 41.5),
                vector(140, 156.5, 41.5),
            ]
        ),
        cq.Edge.makeLine(vector(140, 156.5, 41.5), vector(115, 156.5, 41.5)),
        cq.Edge.makeBezier(
            [
                vector(115, 156.5, 41.5),
                vector(108, 156.5, 41.5),
                vector(102, 155, 41.5),
                vector(95, 155, 41.5),
            ]
        ),
        cq.Edge.makeLine(vector(95, 155, 41.5), vector(90, 155, 41.5)),
    ]
    centreline = cq.Wire.assembleEdges(edges)
    profile = (
        cq.Workplane(cq.Plane(origin=(232.75, 80, 41.5), normal=(0, 1, 0), xDir=(1, 0, 0)))
        .rect(6.5, 9.5)
        .val()
    )
    bundle = cq.Solid.sweep(profile, [], centreline, makeSolid=True, isFrenet=True)
    assert bundle.isValid()
    probes = {
        "bracket": bracket,
        "receiving_bundle": bundle,
        "proposed_screw_head_envelope": cylinder([121, 153, 32], [0, 1, 0], 1.9, 2),
        "driver_approach_envelope": cylinder([121, 155, 32], [0, 1, 0], 1.3, 20),
    }
    hashes = {
        str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in (Path(__file__), ROOT / "cad/geometry.py", assembly_path, cards_path)
    }
    checks, hits = [], []
    candidates = [(name, row, "brep") for name, row in assembly["physical_parts"].items()] + [
        (name, row, "source_BRep") for name, row in cards["card_study_parts"].items()
    ]
    for probe_name, shape in probes.items():
        for name, row, brep_key in candidates:
            # This one old screw is physically replaced in the proposal, not
            # a clearance exception in the currently installed assembly.
            if name == "FASTENER__FRAME_KEY_REAR_2_SCREW":
                continue
            if not overlaps(bounds(shape), row["bounds_mm"]):
                continue
            path = ROOT / row[brep_key]
            path_key = str(path.relative_to(ROOT))
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            expected = row["sha256"] if brep_key == "brep" else cards["output_sha256"][path_key]
            assert digest == expected, path_key
            hashes[path_key] = digest
            other = cq.Shape.importBrep(str(path))
            volume = shape.intersect(other).Volume()
            check = {"probe": probe_name, "part": name, "intersection_mm3": volume}
            checks.append(check)
            if volume > 1e-6:
                hits.append(check)
    bundle_overlap = bracket.intersect(bundle).Volume()
    assert bundle_overlap <= 1e-6
    assert not hits, hits

    card_clearances = []
    for name in (
        "BANK__SLOT0__SHELL",
        "BANK__SLOT0__COVER",
        "BANK__SLOT1__SHELL",
        "BANK__SLOT1__COVER",
    ):
        row = cards["card_study_parts"][name]
        path_key = row["source_BRep"]
        path = ROOT / path_key
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        assert digest == cards["output_sha256"][path_key], path_key
        hashes[path_key] = digest
        card_clearances.append(
            {"part": name, "distance_mm": bracket.distance(cq.Shape.importBrep(str(path)))}
        )

    output = ROOT / "build/exports/BMSX_PAD_LOOM_CANDIDATE.step"
    output.parent.mkdir(parents=True, exist_ok=True)
    drawing = cq.Assembly(name="PAD_LOOM_CANDIDATE_NOT_INSTALLED")
    drawing.add(bracket, name="CANDIDATE_BRACKET", color=cq.Color(0.7, 0.7, 0.7))
    drawing.add(bundle, name="RECEIVING_VOLUME_NOT_WIRES", color=cq.Color(0.2, 0.5, 0.9, 0.3))
    drawing.add(probes["proposed_screw_head_envelope"], name="HEAD_ENVELOPE_NOT_SCREW")
    drawing.add(probes["driver_approach_envelope"], name="DRIVER_APPROACH_ENVELOPE")
    drawing.save(str(output), exportType="STEP")
    report = {
        "scope": __doc__,
        "status": "candidate only; not installed, assembled, or qualified",
        "source_assembly": "Retained complete assembly snapshot from R57; no new full assembly validation.",
        "explicit_replacement": "The existing FRAME_KEY_REAR_2 M2x6 is absent from the candidate scene. An M2x8 is proposed, but the full screw, its threads, retention and engagement have not been modelled or verified.",
        "geometry_mm": {name: bounds(shape) for name, shape in probes.items()},
        "receiving_bundle_centreline_length_mm": centreline.Length(),
        "original_corner_centreline_radius_mm": 16,
        "checks": checks,
        "material_intersections": hits,
        "bracket_bundle_intersection_mm3": bundle_overlap,
        "nominal_bracket_to_inserted_card_clearances": card_clearances,
        "limitations": [
            "Only the screw head envelope and a straight driver-volume envelope were checked. The full M2x8, tool operation and engagement were not checked.",
            "Both stationary inserted reference cartridge geometries were checked. The smallest bracket-to-card clearance is nominal; manufacturing, positioning and assembly tolerances are not included.",
            "The receiving bundle is not twenty individual wire paths and does not represent a cable tie, its head or band path.",
            "Only assembly material and inserted-card solids are checked; supplier receiving allocations and envelope-to-envelope clearances are not covered.",
            "Slot edge radii, real band passage, local wire bending, traction, joint loads, fatigue, vibration, assembly tolerances and service loop remain unproven.",
            "The existing removable lid was stationary; its motion and removal were not verified. Nothing is fastened to the lid in this candidate.",
            "The preexisting main assembly, current case construction and native console STEP are not altered by this isolated candidate.",
        ],
        "input_sha256": hashes,
        "step": str(output.relative_to(ROOT)),
        "step_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "elapsed_seconds": perf_counter() - start,
        "fabrication_release": False,
    }
    target = ROOT / "build/reports/pad-loom-candidate.json"
    target.write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                "checks": len(checks),
                "hits": hits,
                "seconds": report["elapsed_seconds"],
                "report": str(target),
                "step": str(output),
            }
        )
    )


if __name__ == "__main__":
    main()
