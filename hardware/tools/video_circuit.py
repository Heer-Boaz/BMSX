"""Focused DC/corner and idealized RC/video-filter screen, not a SPICE signoff.

The manufacturer topology is DC-coupled gain-two video drive with series75ohm
termination. scipy.signal owns analog-filter synthesis and response; no router,
transmission-line lumping, parameter fitting or exhaustive layout search.
https://github.com/scipy/scipy/blob/main/scipy/signal/_filter_design.py
"""

import argparse
import hashlib
import itertools
import json
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from scipy import signal

ROOT = Path(__file__).resolve().parents[1]


def parallel(*resistances):
    return 1 / sum(1 / r for r in resistances)


def dc(swing, rtop, rbottom, rin, gain, series, load):
    return (
        swing
        * parallel(rbottom, rin)
        / (rtop + parallel(rbottom, rin))
        * gain
        * load
        / (series + load)
    )


def edge(rth_ohms, cap_farads, bandwidth_hz):
    # Microseconds normalize polynomial coefficients; fifth-order filter plus
    # one physical input RC. 2001 points cover settling without slow search.
    b, a = signal.butter(5, 2 * np.pi * bandwidth_hz / 1e6, analog=True)
    a = np.polymul(a, [rth_ohms * cap_farads * 1e6, 1])
    t, y = signal.step((b, a), T=np.linspace(0, 2, 2001))
    crossings = []
    for level in (0.1, 0.5, 0.9):
        i = np.flatnonzero(y >= level)[0]
        crossings.append(float(np.interp(level, y[i - 1 : i + 1], t[i - 1 : i + 1]) * 1e-6))
    return {
        "t10_s": crossings[0],
        "t50_s": crossings[1],
        "t90_s": crossings[2],
        "rise_10_90_s": crossings[2] - crossings[0],
        "ideal_step_peak_ratio": float(y.max()),
    }


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--native-netlist", type=Path, required=True)
    args = cli.parse_args()
    owner = ROOT / "design/video_output.json"
    d = json.loads(owner.read_text())
    c, a, op = d["components"], d["amplifier"], d["operating_acceptance"]
    top, bottom, series = (c[r]["ohms"] for r in ("R533", "R534", "R528"))
    rin = a["input_resistance_typical_ohms"]
    load = op["reference_receiver_ohms"]
    rth = parallel(top, bottom, rin)
    gain = a["gain_nominal_V_per_V"]
    tol = c["R533"]["initial_tolerance_fraction"]
    gains = [10 ** (g / 20) for g in a["gain_full_temperature_dB"]]
    swings = [
        op["V3V3_V"][0]
        - d["buffer"]["VOH_min_below_VCC_V_at_low_current"]
        - d["buffer"]["VOL_max_V_at_low_current"],
        op["V3V3_V"][1],
    ]
    corners = []
    for swing, rt, rb, ri, g, rs, rl in itertools.product(
        swings,
        [top * (1 - tol), top * (1 + tol)],
        [bottom * (1 - tol), bottom * (1 + tol)],
        a["input_resistance_sensitivity_ohms_NOT_manufacturer_limits"],
        gains,
        [series * (1 - tol), series * (1 + tol)],
        [
            load * (1 - op["reference_receiver_tolerance_fraction"]),
            load * (1 + op["reference_receiver_tolerance_fraction"]),
        ],
    ):
        corners.append(dc(swing, rt, rb, ri, g, rs, rl))
    # Declared engineering whole-life screen, NOT a vendor ageing guarantee.
    rail = d["rail_design_screen"]

    def aged(r):
        delta = (
            r
            * (
                tol
                + rail["TCR_per_K"] * rail["delta_temperature_K_screen"]
                + rail["age_fraction_screen_NOT_product_guarantee"]
            )
            + rail["age_ohms_screen_NOT_product_guarantee"]
        )
        return [r - delta, r + delta]

    aged_corners = [
        dc(*p)
        for p in itertools.product(
            swings,
            aged(top),
            aged(bottom),
            a["input_resistance_sensitivity_ohms_NOT_manufacturer_limits"],
            gains,
            aged(series),
            aged(load),
        )
    ]
    input_caps = d["layout_acceptance"]["total_scaled_node_capacitance_design_F"]
    edge_corners = [
        edge(parallel(rt, rb, ri), cap, bw)
        for rt, rb, ri, cap, bw in itertools.product(
            [top * (1 - tol), top * (1 + tol)],
            [bottom * (1 - tol), bottom * (1 + tol)],
            a["input_resistance_sensitivity_ohms_NOT_manufacturer_limits"],
            input_caps,
            a["filter_bandwidth_characterized_range_Hz"],
        )
    ]
    nominal = edge(
        rth,
        c["C533"]["farads"] + a["input_capacitance_typical_F"],
        a["filter_bandwidth_typical_Hz"],
    )
    feedback_top, feedback_bottom = rail["R21_ohms"], rail["R22_ohms"]
    low, high = rail["VFB_published_V"]
    ratios = [
        low * (1 + aged(feedback_top)[0] / aged(feedback_bottom)[1]),
        high * (1 + aged(feedback_top)[1] / aged(feedback_bottom)[0]),
    ]
    rail_screen = [
        ratios[0]
        - rail["ripple_half_width_V_acceptance"]
        - rail["additional_DC_error_budget_V_acceptance"],
        ratios[1]
        + rail["ripple_half_width_V_acceptance"]
        + rail["additional_DC_error_budget_V_acceptance"],
    ]
    hashes = {
        "design/video_output.json": hashlib.sha256(owner.read_bytes()).hexdigest(),
        "tools/video_circuit.py": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    }
    native_path = args.native_netlist.resolve()
    tree = ET.parse(native_path).getroot()
    pin_rows = {
        (n.attrib["ref"], n.attrib["pin"]): n
        for net in tree.findall("./nets/net")
        for n in net.findall("node")
    }
    pin_nets = {
        (n.attrib["ref"], n.attrib["pin"]): net.attrib["name"]
        for net in tree.findall("./nets/net")
        for n in net.findall("node")
    }
    checked = []
    for ref, component in c.items():
        for pin, expected in component["pins"].items():
            actual = pin_nets[(ref, pin)]
            # Explicit NC is emitted by KiCad, not invented or decoded here.
            if expected is not None:
                assert actual == expected, (ref, pin, actual, expected)
            else:
                assert "no_connect" in pin_rows[(ref, pin)].attrib["pintype"].split("+"), (
                    ref,
                    pin,
                    actual,
                )
            checked.append({"ref": ref, "pin": pin, "native_net": actual, "intent": expected})
    for pin, expected in d["buffer"]["pins_unchanged"].items():
        assert pin_nets[("U42", pin)] == expected
    hashes[str(native_path.relative_to(ROOT))] = hashlib.sha256(
        native_path.read_bytes()
    ).hexdigest()
    native = {
        "pins": checked,
        "unchanged_U42_pins_checked": True,
        "explicit_NC_type_proof_owner": "ecad/mainboard/av_harness.kicad_sch",
    }
    report = {
        "scope": __doc__,
        "source_sha256": hashes,
        "native_graph_checked": native,
        "nominal_3V3_comparison_sync_amplitude_V": dc(
            op["comparison_buffer_swing_V"], top, bottom, rin, gain, series, load
        ),
        "nominal_actual_buck_sync_amplitude_V": dc(
            op["nominal_buck_setpoint_V"], top, bottom, rin, gain, series, load
        ),
        "nominal_terminated_tip_V": a["output_bias_nominal_V"] * load / (series + load),
        "initial_corners_with_explicit_Rin_sensitivity_V": [min(corners), max(corners)],
        "whole_life_engineering_sensitivity_NOT_guarantee_V": [
            min(aged_corners),
            max(aged_corners),
        ],
        "buffer_divider_branch_peak_A_at_3p6V": 3.6 / (top * (1 - tol)),
        "buffer_divider_branch_peak_A_at_3p6V_aged_screen": 3.6 / aged(top)[0],
        "scaled_node_Rth_nominal_ohms": rth,
        "nominal_ideal_filter_response": nominal,
        "conditional_response_corners": {
            "rise_10_90_s": [
                min(e["rise_10_90_s"] for e in edge_corners),
                max(e["rise_10_90_s"] for e in edge_corners),
            ],
            "t50_s": [min(e["t50_s"] for e in edge_corners), max(e["t50_s"] for e in edge_corners)],
            "peak_ratio_max": max(e["ideal_step_peak_ratio"] for e in edge_corners),
        },
        "output_source": {
            "series_R_ohms": series,
            "amplifier_typical_output_Z_at5MHz_ohms": a["output_impedance_typical_ohms_at_5MHz"],
            "meaning": "75ohm series termination with low-Z video driver; typical IC Z not a guaranteed broadband impedance bound.",
        },
        "rail_engineering_screen_NOT_guarantee_V": rail_screen,
        "amplifier_quiescent_max_power_W": op["V3V3_V"][1]
        * a["quiescent_current_full_temperature_max_A_at_3V3"],
        "amplifier_allocated_power_W": a["power_allocation_W"],
        "interpretation": [
            "InputR and pinC sensitivity bounds are layout/acceptance assumptions, not manufacturer min/max.",
            "Idealized filter edges are not validated device/cable waveforms.",
            "Whole-life low amplitude falls slightly below own .25V prototype criterion; do not convert a sensitivity result into a guarantee.",
            "Prototype amplitude, ringing, sync/RGB threshold alignment, rail and thermal checks remain required; no silicon or manufacturing release.",
        ],
        "fabrication_release": False,
    }
    assert (
        report["buffer_divider_branch_peak_A_at_3p6V_aged_screen"]
        < d["buffer"]["low_current_test_A"]
    )
    assert (
        report["initial_corners_with_explicit_Rin_sensitivity_V"][0]
        >= op["terminated_sync_amplitude_V"][0]
    )
    assert (
        report["initial_corners_with_explicit_Rin_sensitivity_V"][1]
        <= op["terminated_sync_amplitude_V"][1]
    )
    assert rail_screen[0] >= op["V3V3_V"][0] and rail_screen[1] <= op["V3V3_V"][1]
    path = ROOT / "build/reports/video-circuit.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                "sync_nominal_V": report["nominal_actual_buck_sync_amplitude_V"],
                "native_pins_checked": len(native["pins"]),
                "fabrication_release": False,
            }
        )
    )


if __name__ == "__main__":
    main()
