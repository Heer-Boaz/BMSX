"""Reference thermal network of the current passive enclosure and lower cover.

Fourier conduction and gray-surface radiation use the same physical separation
as Modelica ThermalConductor and BodyRadiation. The vent balance is a steady
hydrostatic/orifice model, not CFD. All transfer coefficients and loads remain
declared sensitivity assumptions; the result is not a product approval.
"""

import hashlib
import json
from math import copysign, pi, sqrt
from pathlib import Path

import numpy as np
from scipy.optimize import brentq, root

ROOT = Path(__file__).resolve().parents[1]
SIGMA = 5.670374419e-8
NODES = [
    "sink",
    "air",
    "roof_inside",
    "roof_outside",
    "walls_inside",
    "walls_outside",
    "al_left",
    "al_right",
    "al_remote",
    "tray_inside_left",
    "tray_inside_right",
    "tray_inside_remote",
    "tray_outside_left",
    "tray_outside_right",
    "tray_outside_remote",
]


def projected_slot_area_m2(row, vertical_axis):
    x, y, z, X, Y, Z = row["bounds_mm"]
    width = X - x
    length = (Z - z) if vertical_axis else (Y - y)
    return (width * length - (4 - pi) * row["radius_mm"] ** 2) * 1e-6


def radiation(area, emissivity, first_C, second_C):
    return area * emissivity * SIGMA * ((first_C + 273.15) ** 4 - (second_C + 273.15) ** 4)


def main():
    source_paths = [
        ROOT / "design" / name
        for name in ["thermal.json", "enclosure_structure.json", "enclosure_cooling.json"]
    ]
    spec, structure, cooling = [json.loads(path.read_text()) for path in source_paths]
    chassis_intake = sum(
        projected_slot_area_m2(row, False) for row in structure["vents"]["base_intake_slots"]
    )
    tray_intake = sum(
        projected_slot_area_m2(row, False) for row in structure["bottom_cover"]["intake_slots"]
    )
    outlet = sum(
        projected_slot_area_m2(row, True) for row in structure["vents"]["rear_outlet_slots"]
    )
    case = structure["case"]["outer_bounds_mm"]
    width, depth, height = [(case[i + 3] - case[i]) * 1e-3 for i in range(3)]
    roof_opening = sum(
        (row["size_XY_mm"][0] * row["size_XY_mm"][1] - (4 - pi) * row["radius_mm"] ** 2) * 1e-6
        for row in structure["cartridge_roof_apertures"]
    )
    roof_area = width * depth - roof_opening
    wall_area = 2 * (width + depth) * height - outlet
    base_area = width * depth - chassis_intake
    patch = spec["post_patch_area_m2_each"]
    regions = [patch, patch, base_area - 2 * patch]
    gap = (
        structure["base"]["bounds_mm"][2] - structure["bottom_cover"]["inner_bounds_mm"][2]
    ) * 1e-3
    floor = structure["bottom_cover"]["floor_mm"] * 1e-3
    wall = structure["case"]["wall_mm"] * 1e-3
    post = cooling["support_posts"][0]
    post_bulk_R = (
        (post["range_Z_mm"][1] - post["range_Z_mm"][0])
        * 1e-3
        / (spec["aluminium_conductivity_assumption_W_mK"] * pi * (post["OD_mm"] * 0.0005) ** 2)
    )
    profiles = {"reference": spec["reference_profile"]} | {
        name: spec["reference_profile"] | changes
        for name, changes in spec["sensitivity_profiles"].items()
    }
    rows = []
    inlet_height = (structure["base"]["bounds_mm"][2] + structure["base"]["bounds_mm"][5]) * 0.0005
    for name, profile in profiles.items():
        inlet = profile["intake_free_fraction"] / sqrt(chassis_intake**-2 + tray_intake**-2)
        # Uniform-area vertical quadrature of each actual outlet. Rounded ends
        # retain their total projected area; this is not a local-flow solution.
        openings = [(inlet_height, inlet)]
        for slot in structure["vents"]["rear_outlet_slots"]:
            lower, upper = slot["bounds_mm"][2], slot["bounds_mm"][5]
            area = projected_slot_area_m2(slot, True) * profile["outlet_free_fraction"]
            openings += [
                ((lower + (i + 0.5) * (upper - lower) / 12) * 1e-3, area / 12) for i in range(12)
            ]
        lowest, highest = min(z for z, _ in openings), max(z for z, _ in openings)
        openings = [(z, area) for z, area in openings if area > 0]
        neutral = brentq(
            lambda n: sum(area * copysign(sqrt(abs(z - n)), z - n) for z, area in openings),
            lowest,
            highest,
        )
        flow_coefficient = sum(area * sqrt(z - neutral) for z, area in openings if z > neutral)
        for ambient in spec["room_temperature_examples_C"]:
            for load in spec["internal_heat_diagnostics_W"]:
                hi, ho, hu = [
                    profile[key]
                    for key in [
                        "inside_convection_W_m2K",
                        "outside_convection_W_m2K",
                        "underside_convection_W_m2K",
                    ]
                ]
                plastic = profile["plastic_conductivity_assumption_W_mK"]
                eps_skin = profile["plastic_emissivity"]
                eps_sink_skin = 1 / (1 / profile["sink_emissivity"] + 1 / eps_skin - 1)
                eps_gap = 1 / (1 / profile["aluminium_emissivity"] + 1 / eps_skin - 1)
                gl = 1 / (post_bulk_R + 2 * profile["post_contact_R_each_interface_K_W"])
                gr = 1 / (1 / gl + profile["right_bridge_R_K_W"])
                spread = 1 / profile["base_spreading_R_each_patch_K_W"]
                rho = 101325 / (287.05 * (ambient + 273.15))

                def balances(v):
                    sink, air, ri, ro, wi, wo = v[:6]
                    aluminium, tray_in, tray_out = v[6:9], v[9:12], v[12:15]
                    sa = hi * profile["sink_effective_convection_area_m2"] * (sink - air)
                    sr = radiation(spec["sink_to_roof_view_area_m2"], eps_sink_skin, sink, ri)
                    sw = radiation(spec["sink_to_walls_view_area_m2"], eps_sink_skin, sink, wi)
                    posts = [gl * (sink - aluminium[0]), gr * (sink - aluminium[1])]
                    air_roof, air_wall = hi * roof_area * (air - ri), hi * wall_area * (air - wi)
                    air_base = (
                        hi * spec["base_air_exposed_reference_area_m2"] * (air - aluminium[2])
                    )
                    qr, qw = (
                        plastic * roof_area / wall * (ri - ro),
                        plastic * wall_area / wall * (wi - wo),
                    )
                    out_roof = ho * roof_area * (ro - ambient) + radiation(
                        roof_area, eps_skin, ro, ambient
                    )
                    out_wall = ho * wall_area * (wo - ambient) + radiation(
                        wall_area, eps_skin, wo, ambient
                    )
                    gap_heat = [
                        spec["air_conductivity_assumption_W_mK"] * area / gap * (al - inner)
                        + radiation(area, eps_gap, al, inner)
                        for area, al, inner in zip(regions, aluminium, tray_in)
                    ]
                    floor_heat = [
                        plastic * area / floor * (inner - outer)
                        for area, inner, outer in zip(regions, tray_in, tray_out)
                    ]
                    out_tray = [
                        hu * area * (outer - ambient) + radiation(area, eps_skin, outer, ambient)
                        for area, outer in zip(regions, tray_out)
                    ]
                    lateral = [spread * (aluminium[i] - aluminium[2]) for i in [0, 1]]
                    delta = air - ambient
                    vent = (
                        rho
                        * 1005
                        * profile["discharge_coefficient"]
                        * flow_coefficient
                        * sqrt(2 * 9.81 / ((air + ambient) / 2 + 273.15))
                        * delta
                        * sqrt(abs(delta))
                    )
                    equations = [
                        spec["common_sink_heat_diagnostic_W"] - sa - sr - sw - sum(posts),
                        load
                        - spec["common_sink_heat_diagnostic_W"]
                        + sa
                        - air_roof
                        - air_wall
                        - air_base
                        - vent,
                        air_roof + sr - qr,
                        qr - out_roof,
                        air_wall + sw - qw,
                        qw - out_wall,
                        posts[0] - lateral[0] - gap_heat[0],
                        posts[1] - lateral[1] - gap_heat[1],
                        air_base + sum(lateral) - gap_heat[2],
                    ]
                    equations += [gap_heat[i] - floor_heat[i] for i in range(3)]
                    equations += [floor_heat[i] - out_tray[i] for i in range(3)]
                    return np.array(equations), {
                        "vent_W": vent,
                        "roof_to_room_W": out_roof,
                        "walls_to_room_W": out_wall,
                        "tray_to_room_W": sum(out_tray),
                    }

                initial = np.full(len(NODES), ambient + 35.0)
                initial[0] += 15
                solved = root(lambda values: balances(values)[0], initial, tol=1e-9)
                residual, flows = balances(solved.x)
                error = float(np.max(np.abs(residual)))
                assert solved.success and error < 1e-7, (name, ambient, load, solved.message, error)
                assert abs(sum(flows.values()) - load) < 1e-7
                rows.append(
                    {
                        "profile": name,
                        "room_example_C": ambient,
                        "internal_heat_diagnostic_W": load,
                        "temperatures_C": dict(zip(NODES, map(float, solved.x))),
                        "heat_to_room_W": flows,
                        "maximum_energy_residual_W": error,
                    }
                )
    report = {
        "scope": __doc__,
        "input_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in source_paths + [Path(__file__)]
        },
        "geometry": {
            "projection_basis_mm": [width * 1000, depth * 1000],
            "projection_scope": "Nominal chassis footprint; sloped outer-skin enlargement and cartridge surfaces are not thermal credit.",
            "chassis_intake_mm2": chassis_intake * 1e6,
            "tray_intake_mm2": tray_intake * 1e6,
            "outlet_mm2": outlet * 1e6,
            "gap_mm": gap * 1000,
            "plastic_floor_mm": floor * 1000,
            "base_regions_m2": regions,
        },
        "nodes": NODES,
        "rows": rows,
        "interpretation": spec["interpretation"],
        "qualification": False,
    }
    output = ROOT / "build/reports/thermal.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                "cases": len(rows),
                "nodes": len(NODES),
                "maximum_energy_residual_W": max(row["maximum_energy_residual_W"] for row in rows),
                "qualification": False,
            }
        )
    )


if __name__ == "__main__":
    main()
