"""Exact R4 machined frame interfaces in the compact two-slot receiving frame.

Only retained local rail zones are cropped. Keyed G10 parts and lug clamps are
rigid native inputs; native closure bars remain separately removable. New wing
stock is machined after fusion, so neither T-slots nor bar seats are filled in.
CadQuery production Boolean and assembly owners were studied:
https://github.com/CadQuery/cadquery/blob/master/cadquery/occ_impl/shapes.py
https://github.com/CadQuery/cadquery/blob/master/cadquery/assembly.py
"""

import hashlib
import json
from pathlib import Path
from time import monotonic

import cadquery as cq
from cartridge_polarisation import SPEC, SPEC_PATH, frame_key, shell_with_channel
from fasteners import fabricate_fasteners
from fixtures import hole_shape
from geometry import bounds, box, cylinder, overlaps

ROOT = Path(__file__).resolve().parents[1]


def main():
    started = monotonic()
    spec_path = ROOT / "design/enclosure_cartridge_frame.json"
    spec = json.loads(spec_path.read_text())
    manifest_path = ROOT / spec["input_manifest"]
    manifest = json.loads(manifest_path.read_text())
    sources = {}
    for name, row in manifest["parts"].items():
        path = ROOT / row["brep"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"], name
        sources[name] = cq.Shape.importBrep(str(path))
        assert sources[name].isValid() and len(sources[name].Solids()) == 1, name
    physical = {}
    materials = {}
    source_bindings = {}
    rail_pieces = []
    spreader_pieces = []
    for slot in spec["slots"]:
        shift = tuple(slot["translation_mm"])
        index = slot["slot"]
        rails = sources["FRAME_METAL_R2"].intersect(box(slot["upper_crop_mm"])).translate(shift)
        rail_pieces.append(rails)
        spreader_pieces.append(
            sources["LOAD_SPREADER_CURRENT"]
            .intersect(box(slot["spreader_crop_mm"]))
            .translate(shift)
        )
        for source_name in ["FRAME_KEY_RETAINER_FRONT", "FRAME_KEY_RETAINER_REAR"]:
            name = f"COMPACT_SLOT{index}__{source_name}"
            shape = sources[source_name].intersect(box(slot["upper_crop_mm"])).translate(shift)
            assert shape.isValid() and len(shape.Solids()) == 1, name
            physical[name] = shape
            materials[name] = "aluminium"
            source_bindings[name] = {
                "source": source_name,
                "crop_mm": slot["upper_crop_mm"],
                "translation_mm": shift,
            }
    for name, shape in sources.items():
        if name in [
            "FRAME_METAL_R2",
            "LOAD_SPREADER_CURRENT",
            "FRAME_KEY_RETAINER_FRONT",
            "FRAME_KEY_RETAINER_REAR",
        ]:
            continue
        tokens = name.split("_")
        if name.startswith(("FRAME_STOP_", "FRAME_GUIDE_")):
            index = int(tokens[2])
        elif name.startswith("FRAME_BOARD_BEARING_"):
            index = int(tokens[3])
        elif name.startswith(("FASTENER__LUG_", "FRAME__LUG_")):
            index = int(tokens[3]) // 2
        else:
            assert name.startswith("FASTENER__FRAME_KEY_"), name
            index = int(tokens[5]) // 2
        shift = tuple(spec["slots"][index]["translation_mm"])
        placed = shape.translate(shift)
        assert abs(placed.Volume() - shape.Volume()) < 1e-5, name
        physical[name] = placed
        materials[name] = (
            "steel"
            if name.startswith("FASTENER__")
            else "g10_insulator"
            if name.endswith("_G10")
            else "aluminium"
        )
        source_bindings[name] = {
            "source": name,
            "translation_mm": shift,
            "exact_rigid_volume_mm3": shape.Volume(),
        }
    metal = rail_pieces[0].fuse(rail_pieces[1])
    finish = json.loads((ROOT / "models/frame/frame_finish.json").read_text())
    frame_fasteners = json.loads((ROOT / "models/frame/frame_fasteners.json").read_text())
    for region in spec["wing_bounds_mm"]:
        wing = box(region)
        # Native rail stock is owned by the retained machined BRep, including
        # its stepped free-shank drill reliefs beyond the tapped pilots. New
        # side stock must not refill any of those existing native cavities.
        for slot in spec["slots"]:
            x, _, z, X, _, Z = slot["upper_crop_mm"]
            shift = tuple(slot["translation_mm"])
            for y, Y in [(138.5, 144.5), (153.5, 159.5)]:
                # The continuous lower1mm wing web joins all four cropped
                # rails; native keyed/threaded interfaces are aboveZ27.4.
                wing = wing.cut(box([x, y, 19.4, X, Y, 33.4]).translate(shift))
        # Do not fill a removable bar's stock or screw head space merely
        # because its native holes/rebates contain no positive material.
        for name, shape in physical.items():
            if "__FRAME_KEY_RETAINER_" in name:
                wing = wing.cut(box(bounds(shape)))
        for row in finish["parts"]:
            if not row["id"].startswith("FRAME_GUIDE_") or not row["id"].endswith("_FACE"):
                continue
            index = int(row["id"].split("_")[2])
            shift = spec["slots"][index]["translation_mm"]
            clearance = [
                v + shift[i % 3] + (-0.05 if i < 3 else 0.05)
                for i, v in enumerate(row["bounds_mm"])
            ]
            wing = wing.cut(box(clearance))
        for row in frame_fasteners["fastening_interfaces"]:
            index = int(row["id"].rsplit("_", 1)[1]) // 2
            shift = spec["slots"][index]["translation_mm"]
            origin = [v + shift[i] for i, v in enumerate(row["under_head_position_mm"])]
            direction = [-v for v in row["axis_direction"]]
            wing = wing.cut(cylinder(origin, direction, 2, 3.1))
        metal = metal.fuse(wing)
    for row in spec["columns"]:
        x, y = row["axis_XY_mm"]
        z, Z = row["z_range_mm"]
        metal = metal.fuse(cylinder([x, y, z], [0, 0, 1], row["diameter_mm"] / 2, Z - z))
    # Original post-fusion native machining operations are reapplied only to
    # their own retained slot. Exact bar BReps own the new wing bar recesses.
    operations = spec["frame_finish_operations"]
    for slot in spec["slots"]:
        shift = tuple(slot["translation_mm"])
        window = slot["upper_crop_mm"]
        for cut in operations["cutboxes"]:
            shape = box(cut["bounds_mm"])
            if overlaps(bounds(shape), window):
                metal = metal.cut(shape.translate(shift))
        for hole in operations["holes"]:
            shape = hole_shape(hole)
            if overlaps(bounds(shape), window):
                metal = metal.cut(shape.translate(shift))
    for name, shape in physical.items():
        if "__FRAME_KEY_RETAINER_" in name:
            metal = metal.cut(shape)
    for row in spec["columns"]:
        x, y = row["axis_XY_mm"]
        z, Z = row["pilot_z_range_mm"]
        metal = metal.cut(
            cylinder([x, y, z - 0.05], [0, 0, 1], row["tap_pilot_mm"] / 2, Z - z + 0.1)
        )
    for centre in SPEC["slot_centres_XY_mm"]:
        metal = metal.fuse(frame_key(centre))
    metal = metal.clean()
    assert metal.isValid() and len(metal.Solids()) == 1, (
        metal.isValid(),
        len(metal.Solids()),
        [bounds(s) for s in metal.Solids()],
    )
    physical["COMPACT_FRAME_METAL"] = metal
    materials["COMPACT_FRAME_METAL"] = "aluminium"
    spreader = spreader_pieces[0].fuse(spreader_pieces[1], box(spec["spreader_bridge_bounds_mm"]))
    for row in spec["columns"]:
        x, y = row["axis_XY_mm"]
        spreader = spreader.cut(
            cylinder([x, y, 4.4], [0, 0, 1], spec["spreader_column_clearance_diameter_mm"] / 2, 3.7)
        )
    spreader = spreader.clean()
    assert spreader.isValid() and len(spreader.Solids()) == 1
    physical["COMPACT_LOAD_SPREADER"] = spreader
    materials["COMPACT_LOAD_SPREADER"] = "aluminium"
    fasteners, fastener_materials, _ = fabricate_fasteners(spec["fastener_plan"])
    physical.update(fasteners)
    materials.update(fastener_materials)
    boxes = {name: bounds(shape) for name, shape in physical.items()}
    checks = []
    collisions = []
    names = list(physical)
    for i, name in enumerate(names):
        assert physical[name].isValid() and len(physical[name].Solids()) == 1, name
        for peer in names[i + 1 :]:
            if not overlaps(boxes[name], boxes[peer]):
                continue
            volume = physical[name].intersect(physical[peer]).Volume()
            row = {"parts": [name, peer], "intersection_mm3": volume}
            checks.append(row)
            if volume > 1e-5:
                collisions.append(row)
    main_path = ROOT / "build/reports/compact-main-scene.json"
    main = json.loads(main_path.read_text())
    main_checks = []
    for main_name, row in main["physical_parts"].items():
        candidates = [name for name in names if overlaps(boxes[name], row["bounds_mm"])]
        if not candidates:
            continue
        path = ROOT / row["brep"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == main["output_sha256"][row["brep"]]
        shape = cq.Shape.importBrep(str(path))
        for name in candidates:
            volume = physical[name].intersect(shape).Volume()
            check = {"parts": [name, main_name], "intersection_mm3": volume}
            main_checks.append(check)
            if volume > 1e-5:
                collisions.append(check)
    bank_manifest_path = ROOT / "models/cartridge/manifest.json"
    bank = json.loads(bank_manifest_path.read_text())
    bank_checks = []
    bearings = []
    for row in bank["parts"]:
        path = ROOT / row["brep"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"]
        shape = cq.Shape.importBrep(str(path)).translate(
            tuple(spec["slots"][row["slot"]]["translation_mm"])
        )
        if row["role"] == "SHELL":
            shape = shell_with_channel(shape, SPEC["slot_centres_XY_mm"][row["slot"]])
        for name in names:
            if not overlaps(boxes[name], bounds(shape)):
                continue
            volume = physical[name].intersect(shape).Volume()
            check = {"parts": [name, row["name"]], "intersection_mm3": volume}
            bank_checks.append(check)
            if volume > 1e-5:
                collisions.append(check)
            if name.startswith("FRAME_STOP_") and row["role"] in ["SHELL", "COVER"]:
                bearings.append(
                    {"parts": [name, row["name"]], "distance_mm": physical[name].distance(shape)}
                )
    result = {
        "scope": __doc__,
        "input_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [
                Path(__file__),
                spec_path,
                manifest_path,
                main_path,
                bank_manifest_path,
                SPEC_PATH,
                ROOT / "cad/cartridge_polarisation.py",
            ]
        },
        "receiving_spaces": {},
        "physical_parts": {},
        "targeted_frame_material_checks": checks,
        "targeted_main_material_checks": main_checks,
        "targeted_bank_material_checks": bank_checks,
        "material_interferences": collisions,
        "stop_card_contacts": bearings,
        "base_additions": spec["base_additions"],
        "base_holes": spec["base_holes"],
        "preserved_interfaces": spec["preserved_interfaces"],
        "not_proven": spec["not_proven"],
        "fabrication_release": False,
    }
    record = ROOT / "build/reports/compact-cartridge-frame.json"
    if collisions:
        record.write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps({"collisions": collisions}))
        assert not collisions
    generated = ROOT / "build/cad/compact_cartridge_frame"
    generated.mkdir(parents=True, exist_ok=True)
    source_bindings.update(
        {
            name: {
                "kind": "constructed_from_design",
                "owner": "design/enclosure_cartridge_frame.json",
            }
            for name in physical
            if name not in source_bindings
        }
    )
    assembly = cq.Assembly(name="BMSX_COMPACT_CARTRIDGE_FRAME")
    for name, shape in physical.items():
        path = generated / (name + ".brep")
        assert shape.exportBrep(str(path))
        assembly.add(shape, name=name)
        result["physical_parts"][name] = {
            "brep": str(path.relative_to(ROOT)),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bounds_mm": boxes[name],
            "regions_mm": [boxes[name]],
            "module": "cartridge-frame",
            "volume_mm3": shape.Volume(),
            "solids": len(shape.Solids()),
            "material": materials[name],
            "source_binding": source_bindings[name],
        }
    target = ROOT / "build/exports/BMSX_COMPACT_cartridge_frame.step"
    assembly.export(str(target))
    written = cq.importers.importStep(str(target)).val()
    assert written.isValid() and len(written.Solids()) == len(physical)
    assert abs(written.Volume() - sum(s.Volume() for s in physical.values())) < 1e-5
    result["STEP_roundtrip"] = {
        "valid": True,
        "solids": len(written.Solids()),
        "volume_sum_pass": True,
    }
    result["exports"] = {
        str(target.relative_to(ROOT)): hashlib.sha256(target.read_bytes()).hexdigest()
    }
    result["elapsed_seconds"] = monotonic() - started
    record.write_text(json.dumps(result, indent=2) + "\n")
    print(
        json.dumps(
            {
                "physical_parts": len(physical),
                "frame_checks": len(checks),
                "main_checks": len(main_checks),
                "bank_checks": len(bank_checks),
                "collisions": collisions,
                "elapsed_seconds": result["elapsed_seconds"],
            }
        )
    )


if __name__ == "__main__":
    main()
