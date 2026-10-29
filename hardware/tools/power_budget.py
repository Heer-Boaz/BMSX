"""Native rail inventory and electrical sizing, not power qualification.

Parameter sweeps retain explicit axes and results, as in NumPy's benchmark code:
https://github.com/numpy/numpy/blob/main/benchmarks/benchmarks/bench_core.py
The BeagleBone Black reference separates input, rail and sequencer ownership:
https://github.com/beagleboard/beaglebone-black/blob/master/BBB_SRM.pdf
Only build outputs are written; no electrical source or component value is changed.
"""

import csv
import hashlib
import json
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAILS = ("RAW9", "FUSED9", "VIN9", "VCTRL3V3", "V3V3", "V5")
EFFICIENCIES = (0.80, 0.85, 0.90, 0.95)
CAPACITANCE_SCALES = (0.5, 0.75, 1.0)
CURRENT_DEFICITS_A = (0.25, 1.0, 3.0, 6.0)


def component_nominal(value):
    """Read the native engineering-value token in SI units, not its tolerances."""
    magnitude, unit = re.fullmatch(r"([\d.]+)(nF|uF|uH|k|R)", value.split()[0]).groups()
    return float(magnitude) * {"nF": 1e-9, "uF": 1e-6, "uH": 1e-6, "k": 1000, "R": 1}[unit]


def main():
    netlist = ROOT / "build/exports/BMSX_netlist.xml"
    bom_path = ROOT / "build/exports/BMSX_components.csv"
    tree = ET.parse(netlist).getroot()
    components = {c.attrib["ref"]: c for c in tree.findall("./components/comp")}
    with bom_path.open(newline="") as stream:
        bom = {row["Reference"]: row for row in csv.DictReader(stream)}
    nets = {n.attrib["name"]: list(n) for n in tree.findall("./nets/net")}
    pin_nets = {
        (n.attrib["ref"], n.attrib["pin"]): name for name, nodes in nets.items() for n in nodes
    }
    shared_cart_signals = []
    for name, nodes in nets.items():
        refs = {node.attrib["ref"] for node in nodes}
        if {"J_CART0", "J_CART1"} <= refs and name not in ("GND", "V3V3", "V5"):
            shared_cart_signals.append(
                {
                    "net": name,
                    "socket_contacts": {
                        node.attrib["ref"]: node.attrib["pin"]
                        for node in nodes
                        if node.attrib["ref"] in ("J_CART0", "J_CART1")
                    },
                    "console_connections": [
                        {"ref": node.attrib["ref"], "pin": node.attrib["pin"]}
                        for node in nodes
                        if node.attrib["ref"] in ("U1", "U51")
                    ],
                }
            )
    values = {ref: c.findtext("value") for ref, c in components.items()}
    cart_socket_connections = {}
    for socket in ("J_CART0", "J_CART1"):
        connections = []
        for name, nodes in nets.items():
            contacts = [node.attrib["pin"] for node in nodes if node.attrib["ref"] == socket]
            if not contacts:
                continue
            bias = []
            for node in nodes:
                ref, pin = node.attrib["ref"], node.attrib["pin"]
                if ref.startswith("R"):
                    other = pin_nets[ref, "2" if pin == "1" else "1"]
                    if other in ("V3V3", "GND"):
                        bias.append({"reference": ref, "value": values[ref], "other_net": other})
            connections.append(
                {
                    "net": name,
                    "contacts": contacts,
                    "other_socket_connected": any(
                        node.attrib["ref"] == ("J_CART1" if socket == "J_CART0" else "J_CART0")
                        for node in nodes
                    ),
                    "console_pins": [
                        {"reference": node.attrib["ref"], "pin": node.attrib["pin"]}
                        for node in nodes
                        if node.attrib["ref"] in ("U1", "U51")
                    ],
                    "bias": bias,
                }
            )
        cart_socket_connections[socket] = connections
    pad_series_paths = []
    for pin in range(1, 14):
        net = pin_nets["J300", str(pin)]
        series = [node for node in nets[net] if node.attrib["ref"].startswith("R")]
        assert len(series) == 1
        resistor = series[0].attrib["ref"]
        other_pin = "2" if series[0].attrib["pin"] == "1" else "1"
        pad_series_paths.append(
            {
                "J300_contact": pin,
                "external_net": net,
                "series_resistor": resistor,
                "series_resistance_ohm_nominal": component_nominal(values[resistor]),
                "internal_net": pin_nets[resistor, other_pin],
            }
        )
    keyboard_paths = []
    for signal, contact, fet, low_pullup, high_pullup in (
        ("clock", "4", "Q300", "R460", "R461"),
        ("data", "1", "Q301", "R462", "R463"),
    ):
        low_net = pin_nets[fet, "2"]
        high_net = pin_nets[fet, "3"]
        assert pin_nets["J301", contact] == high_net
        assert pin_nets[fet, "1"] == "V3V3"
        assert pin_nets[low_pullup, "1"] == "V3V3"
        assert pin_nets[low_pullup, "2"] == low_net
        assert pin_nets[high_pullup, "1"] == "V5"
        assert pin_nets[high_pullup, "2"] == high_net
        keyboard_paths.append(
            {
                "signal": signal,
                "J301_contact": int(contact),
                "level_shift": fet,
                "FET_value": values[fet],
                "gate_net": pin_nets[fet, "1"],
                "low_side_net": low_net,
                "high_side_net": high_net,
                "low_pullup": low_pullup,
                "low_pullup_net": "V3V3",
                "low_pullup_ohm_nominal": component_nominal(values[low_pullup]),
                "high_pullup": high_pullup,
                "high_pullup_net": "V5",
                "high_pullup_ohm_nominal": component_nominal(values[high_pullup]),
            }
        )
    assert pin_nets["J301", "3"] == pin_nets["J300", "15"] == "V5"
    assert pin_nets["J300", "14"] == "V3V3"
    assert values["U62"] == "TPS259474LRPWR"
    assert component_nominal(values["R76"]) == 750
    assert pin_nets["U62", "9"] == pin_nets["R76", "1"] == "EFUSE_ILM"
    assert pin_nets["R76", "2"] == "GND"

    capacitor_rows, rail_inventory, voltages = [], {}, {}
    for rail in RAILS:
        connections, rail_caps = [], []
        for node in nets[rail]:
            ref, pin = node.attrib["ref"], node.attrib["pin"]
            if not ref.startswith("C"):
                connections.append({"value": values[ref], **node.attrib})
                continue
            if bom[ref]["DNP"]:
                continue
            other_net = pin_nets[ref, "2" if pin == "1" else "1"]
            assert values[ref] == bom[ref]["Value"]
            row = {
                "rail": rail,
                "reference": ref,
                "value": values[ref],
                "nominal_uF": component_nominal(values[ref]) * 1e6,
                "other_net": other_net,
                "connection": "grounded" if other_net == "GND" else "other_net",
                "MPN": components[ref].findtext("./fields/field[@name='MPN']"),
                "datasheet": bom[ref]["Datasheet"],
                "footprint": bom[ref]["Footprint"],
            }
            rail_caps.append(row)
            capacitor_rows.append(row)
        rail_inventory[rail] = {
            "capacitor_count": len(rail_caps),
            "all_connected_nominal_uF": math.fsum(c["nominal_uF"] for c in rail_caps),
            "grounded_nominal_uF": math.fsum(
                c["nominal_uF"] for c in rail_caps if c["other_net"] == "GND"
            ),
            "noncapacitor_connections": connections,
        }
    for rail, converter, top, bottom, fb, ground in (
        ("V3V3", "U20", "R21", "R22", "A_FB", "A_SGND"),
        ("V5", "U21", "R26", "R27", "B_FB", "B_SGND"),
    ):
        assert values[converter] == "TPS56637RPAR"
        assert pin_nets[top, "1"] == rail
        assert pin_nets[top, "2"] == pin_nets[bottom, "1"] == pin_nets[converter, "2"] == fb
        assert pin_nets[bottom, "2"] == pin_nets[converter, "3"] == ground
        assert pin_nets[converter, "1"] == "BUCK_EN"
        voltages[rail] = 0.600 * (
            1 + component_nominal(values[top]) / component_nominal(values[bottom])
        )
        rail_inventory[rail]["feedback"] = {
            "converter": converter,
            "top_ref": top,
            "top_value": values[top],
            "bottom_ref": bottom,
            "bottom_value": values[bottom],
            "reference_nominal_V": 0.600,
            "setpoint_nominal_V": voltages[rail],
        }
        top_tolerance = float(re.search(r"([\d.]+)%", values[top])[1]) / 100
        bottom_tolerance = float(re.search(r"([\d.]+)%", values[bottom])[1]) / 100
        rail_inventory[rail]["feedback"]["reference_error_screen"] = {
            "top_fitted_tolerance_fraction": top_tolerance,
            "bottom_fitted_tolerance_fraction": bottom_tolerance,
            "VFB_min_V": 0.591,
            "VFB_max_V": 0.609,
            "calculated_min_V": 0.591
            * (
                1
                + component_nominal(values[top])
                * (1 - top_tolerance)
                / (component_nominal(values[bottom]) * (1 + bottom_tolerance))
            ),
            "calculated_max_V": 0.609
            * (
                1
                + component_nominal(values[top])
                * (1 + top_tolerance)
                / (component_nominal(values[bottom]) * (1 - bottom_tolerance))
            ),
            "conditions": "TI VFB limits: VOUT=5 V, continuous mode, TJ=-40 to150 C. Applying that reference interval to either fitted divider is a reference/resistor-error screen, not a measured rail or complete output guarantee.",
            "excluded": "Feedback bias, resistor temperature drift, line/load regulation, ripple, PCB and harness drop.",
        }

    # The Vishay current entries are typical DC characteristics at 25 C, not
    # independent minimum guarantees. The 80% L case applies the zero-current
    # 100 kHz tolerance as an algebraic sensitivity, not an operating bound.
    inductor_screen = []
    for rail, inductor, converter, switch_net, mpn, heat_typ, saturation_typ, dcr_max_mohm in (
        ("V3V3", "L1", "U20", "A_SW", "IHLP3232DZER2R2M11", 14.5, 10.2, 9.41),
        ("V5", "L2", "U21", "B_SW", "IHLP3232DZER3R3M11", 10.5, 9.7, 14.9),
    ):
        assert components[inductor].findtext("./fields/field[@name='MPN']") == mpn
        assert pin_nets[inductor, "1"] == pin_nets[converter, "6"] == switch_net
        assert pin_nets[inductor, "2"] == rail
        nominal_H = component_nominal(values[inductor])
        reference_V, output_A, switching_Hz = 9.0, 6.0, 500000
        for inductance_factor in (1.0, 0.8):
            inductance_H = nominal_H * inductance_factor
            ripple_A = (
                voltages[rail]
                * (reference_V - voltages[rail])
                / (reference_V * inductance_H * switching_Hz)
            )
            rms_A = math.sqrt(output_A**2 + ripple_A**2 / 12)
            inductor_screen.append(
                {
                    "rail": rail,
                    "reference": inductor,
                    "MPN": mpn,
                    "nominal_inductance_uH": nominal_H * 1e6,
                    "inductance_scenario_factor": inductance_factor,
                    "input_scenario_V": reference_V,
                    "output_scenario_V": voltages[rail],
                    "current_scenario_A": output_A,
                    "switching_scenario_kHz": switching_Hz / 1000,
                    "calculated_ripple_peak_to_peak_A": ripple_A,
                    "calculated_peak_A": output_A + ripple_A / 2,
                    "calculated_rms_A": rms_A,
                    "valley_current_limit_spec_max_A": 8.6,
                    "peak_at_max_valley_same_ripple_scenario_A": 8.6 + ripple_A,
                    "vishay_saturation_current_typ_A": saturation_typ,
                    "vishay_heat_rating_current_typ_A": heat_typ,
                    "winding_DCR_max_25C_mohm": dcr_max_mohm,
                    "winding_DCR_loss_25C_scenario_W": rms_A**2 * dcr_max_mohm / 1000,
                }
            )

    assert values["F60"] == "0451005.MRL 5A fast"
    assert pin_nets["F60", "1"] == "RAW9"
    assert pin_nets["F60", "2"] == "FUSED9"
    input_V, breaker_min_A, buck_rating_A = 9.0, 3.960, 6.0
    fuse_rating_A, fuse_continuous_derating = 5.0, 0.75
    fuse_reference_A = fuse_rating_A * fuse_continuous_derating
    envelope = []
    for efficiency in EFFICIENCIES:
        budget_W = input_V * breaker_min_A * efficiency
        fuse_reference_W = input_V * fuse_reference_A * efficiency
        for half_amp in range(13):
            current_3V3_A = half_amp / 2
            current_5V_A = min(
                buck_rating_A, (budget_W - voltages["V3V3"] * current_3V3_A) / voltages["V5"]
            )
            envelope.append(
                {
                    "aggregate_efficiency_scenario": efficiency,
                    "input_reference_V": input_V,
                    "breaker_test_min_A": breaker_min_A,
                    "main_rail_power_budget_W": budget_W,
                    "I3V3_A": current_3V3_A,
                    "I5_boundary_A": current_5V_A,
                    "output_power_at_boundary_W": voltages["V3V3"] * current_3V3_A
                    + voltages["V5"] * current_5V_A,
                    "fuse_25C_continuous_design_reference_A": fuse_reference_A,
                    "fuse_25C_main_rail_reference_W": fuse_reference_W,
                    "I5_at_fuse_25C_design_reference_A": min(
                        buck_rating_A,
                        (fuse_reference_W - voltages["V3V3"] * current_3V3_A) / voltages["V5"],
                    ),
                }
            )
    thresholds = []
    for (
        event,
        rail,
        top,
        bottom,
        owner,
        pin,
        sense_min,
        sense_typ,
        sense_max,
        leak_min,
        leak_max,
    ) in (
        ("U60 input reset", "VIN9", "R60", "R61", "U60", "3", 0.980, 1.000, 1.007, -15e-9, 15e-9),
        ("U62 PG rising", "VIN9", "R74", "R75", "U62", "4", 1.183, 1.200, 1.223, -0.1e-6, 0.3e-6),
        ("U62 PG falling", "VIN9", "R74", "R75", "U62", "4", 1.076, 1.090, 1.116, -0.1e-6, 0.3e-6),
        (
            "U62 UVLO rising",
            "FUSED9",
            "R70",
            "R71",
            "U62",
            "1",
            1.183,
            1.200,
            1.223,
            -0.1e-6,
            0.1e-6,
        ),
        (
            "U62 UVLO falling",
            "FUSED9",
            "R70",
            "R71",
            "U62",
            "1",
            1.076,
            1.090,
            1.116,
            -0.1e-6,
            0.1e-6,
        ),
        (
            "U62 OVLO rising",
            "FUSED9",
            "R72",
            "R73",
            "U62",
            "2",
            1.183,
            1.200,
            1.223,
            -0.1e-6,
            0.1e-6,
        ),
        (
            "U62 OVLO falling",
            "FUSED9",
            "R72",
            "R73",
            "U62",
            "2",
            1.076,
            1.090,
            1.116,
            -0.1e-6,
            0.1e-6,
        ),
    ):
        assert pin_nets[top, "1"] == rail
        assert pin_nets[top, "2"] == pin_nets[bottom, "1"] == pin_nets[owner, pin]
        assert pin_nets[bottom, "2"] == "GND"
        rt, rb = component_nominal(values[top]), component_nominal(values[bottom])
        tt = float(re.search(r"([\d.]+)%", values[top])[1]) / 100
        tb = float(re.search(r"([\d.]+)%", values[bottom])[1]) / 100
        thresholds.append(
            {
                "event": event,
                "monitored_rail": rail,
                "top_reference": top,
                "bottom_reference": bottom,
                "nominal_no_leakage_V": sense_typ * (1 + rt / rb),
                "initial_tolerance_and_leakage_min_V": sense_min
                * (1 + rt * (1 - tt) / (rb * (1 + tb)))
                + leak_min * rt * (1 - tt),
                "initial_tolerance_and_leakage_max_V": sense_max
                * (1 + rt * (1 + tt) / (rb * (1 - tb)))
                + leak_max * rt * (1 + tt),
                "sense_threshold_min_V": sense_min,
                "sense_threshold_max_V": sense_max,
                "sense_input_current_min_A": leak_min,
                "sense_input_current_max_A": leak_max,
            }
        )
    input_reset, _, pg_falling = thresholds[:3]
    # KCL at the specified absolute-minimum signal-pin voltage, not a model
    # of the IC's reverse-polarity clamp. Positive current leaves the IC pin.
    reverse_input = []
    for pin, top, bottom in (("EN/UVLO", "R70", "R71"), ("OVLO", "R72", "R73")):
        rt, rb = component_nominal(values[top]), component_nominal(values[bottom])
        top_tolerance = float(re.search(r"([\d.]+)%", values[top])[1]) / 100
        for reverse_V in (9.0, 9.45, 15.0):
            reverse_input.append(
                {
                    "pin": pin,
                    "top_reference": top,
                    "bottom_reference": bottom,
                    "input_V": -reverse_V,
                    "assumed_pin_V": -0.3,
                    "required_pin_current_out_uA": ((reverse_V - 0.3) / rt - 0.3 / rb) * 1e6,
                    "upper_branch_current_at_zero_pin_uA_initial_tolerance": reverse_V
                    / (rt * (1 - top_tolerance))
                    * 1e6,
                }
            )
    static_input_loss_margin = (
        input_reset["initial_tolerance_and_leakage_min_V"]
        - pg_falling["initial_tolerance_and_leakage_max_V"]
    )
    assert static_input_loss_margin > 0
    assert pin_nets["C62", "1"] == pin_nets["U60", "3"]
    assert pin_nets["C62", "2"] == "GND"
    v9_filter_tau_us = (
        component_nominal(values["C62"])
        / (1 / component_nominal(values["R60"]) + 1 / component_nominal(values["R61"]))
        * 1e6
    )
    for ref, pin, net in (
        ("R77", "1", "VCTRL3V3"),
        ("R77", "2", "EFUSE_PG"),
        ("R80", "1", "EFUSE_PG"),
        ("R80", "2", "PG_SCALED"),
        ("R81", "1", "PG_SCALED"),
        ("R81", "2", "GND"),
        ("R82", "1", "VCTRL3V3"),
        ("R82", "2", "RUN_REF"),
        ("R64", "1", "RUN_REF"),
        ("R64", "2", "POWER_SW"),
        ("U64", "3", "PG_SCALED"),
        ("U64", "4", "RUN_REF"),
    ):
        assert pin_nets[ref, pin] == net
    control_R = {
        ref: (component_nominal(values[ref]), float(re.search(r"([\d.]+)%", values[ref])[1]) / 100)
        for ref in ("R77", "R80", "R81", "R82", "R64")
    }
    control_min = {ref: r * (1 - t) for ref, (r, t) in control_R.items()}
    control_max = {ref: r * (1 + t) for ref, (r, t) in control_R.items()}
    control_V = 3.3
    pg_high_plus_min = (
        control_min["R81"]
        * (control_V - 3e-6 * control_max["R77"])
        / (control_max["R77"] + control_max["R80"] + control_min["R81"])
    )
    pg_high_plus_max = (
        control_V
        * control_max["R81"]
        / (control_min["R77"] + control_min["R80"] + control_max["R81"])
    )
    run_minus_min = control_V * control_min["R64"] / (control_max["R82"] + control_min["R64"])
    run_minus_max = control_V * control_max["R64"] / (control_min["R82"] + control_max["R64"])
    pg_low_plus_screen = 1.0 * control_max["R81"] / (control_min["R80"] + control_max["R81"])
    comparator_screen = {
        "VCTRL3V3_reference_V": control_V,
        "RUN_PG_high_minimum_passive_differential_V": pg_high_plus_min - run_minus_max,
        "OFF_PG_high_minimum_passive_differential_magnitude_V": control_V - pg_high_plus_max,
        "RUN_PG_low_1V_minimum_passive_differential_magnitude_V": run_minus_min
        - pg_low_plus_screen,
        "RUN_PG_high_nominal_differential_V": control_V
        * (
            component_nominal(values["R81"])
            / sum(component_nominal(values[r]) for r in ("R77", "R80", "R81"))
            - component_nominal(values["R64"])
            / sum(component_nominal(values[r]) for r in ("R82", "R64"))
        ),
        "conditions": "Passive network at a 3.3 V reference, initial resistor errors and up to3 uA PG sinking leakage. Low-PG screen uses the maker's1 V unpowered PG characterization. Not a full comparator/output-driver or rail-voltage guarantee.",
        "comparator_reference": "TLV7031 offset +/-8 mV at VS=1.8/5 V, VCM=VS/2; hysteresis2..17 mV at25 C under those conditions. These are not max hysteresis or input-bias bounds for every actual condition.",
        "excluded": "Resistor drift, control-rail error, input bias and common-mode effects, actual power-up/output drive and timing.",
    }
    assert pin_nets["R83", "1"] == pin_nets["U62", "7"] == "EFUSE_DVDT"
    assert pin_nets["C70", "1"] == pin_nets["R83", "2"] == "EFUSE_DVDT_CAP"
    assert pin_nets["C70", "2"] == "GND"
    assert component_nominal(values["R83"]) == 100
    assert pin_nets["U60", "1"] == pin_nets["U33", "37"] == "V3V3"
    assert pin_nets["U60", "6"] == pin_nets["U33", "12"] == "RESET_N"
    assert values["U60"] == "LTC1326IS8"
    assert values["U33"] == "SST39VF6401B-70-4I-EKE"
    dvdt_V_ms = 2000 / (component_nominal(values["C70"]) * 1e12)
    reference_voltages = {
        "RAW9": input_V,
        "FUSED9": input_V,
        "VIN9": input_V,
        "VCTRL3V3": 3.3,
        **voltages,
    }
    capacitor_energy = [
        {
            "rail": rail,
            "reference_V": reference_voltages[rail],
            "grounded_nominal_uF": rail_inventory[rail]["grounded_nominal_uF"],
            "stored_energy_mJ": 0.0005
            * rail_inventory[rail]["grounded_nominal_uF"]
            * reference_voltages[rail] ** 2,
        }
        for rail in RAILS
    ]
    transient, brownout = [], []
    for rail in voltages:
        nominal_uF = rail_inventory[rail]["grounded_nominal_uF"]
        for scale in CAPACITANCE_SCALES:
            for deficit_A in CURRENT_DEFICITS_A:
                for gap_us in (1, 5, 10, 13, 20):
                    transient.append(
                        {
                            "rail": rail,
                            "capacitance_scale_scenario": scale,
                            "capacitance_scenario_uF": nominal_uF * scale,
                            "net_current_deficit_scenario_A": deficit_A,
                            "support_gap_scenario_us": gap_us,
                            "capacitive_droop_V": deficit_A * gap_us / (nominal_uF * scale),
                        }
                    )
                if rail == "V3V3":
                    for trip_V in (3.052, 3.143):
                        brownout.append(
                            {
                                "capacitance_scale_scenario": scale,
                                "capacitance_scenario_uF": nominal_uF * scale,
                                "net_current_deficit_scenario_A": deficit_A,
                                "supervisor_trip_endpoint_V": trip_V,
                                "flash_minimum_V": 2.7,
                                "capacitor_only_trip_to_flash_min_us": nominal_uF
                                * scale
                                * (trip_V - 2.7)
                                / deficit_A,
                                "capacitor_only_one_percent_overdrive_to_flash_min_us": nominal_uF
                                * scale
                                * (trip_V * 0.99 - 2.7)
                                / deficit_A,
                                "supervisor_detection_reference_typ_us": 13,
                            }
                        )
    result = {
        "scope": "Native capacitance/connectivity, conditional shared-current, reference-error, inductor-current and lumped charge/energy arithmetic only.",
        "rail_inventory": rail_inventory,
        "load_envelope": envelope,
        "startup": {
            "C70_value": values["C70"],
            "eFuse_slew_nominal_V_ms": dvdt_V_ms,
            "eFuse_zero_to_9V_nominal_s": input_V / dvdt_V_ms / 1000,
            "VIN9_direct_capacitor_charging_nominal_mA": rail_inventory["VIN9"][
                "grounded_nominal_uF"
            ]
            * dvdt_V_ms,
            "buck_internal_softstart_typ_ms": 2,
            "alternative_ramp_capacitor_screen": {
                "status": "Alternative for assessment only; C70 and the native board remain unchanged.",
                "example_part": "WIMA MKS2C021001A00JSSD: 10 nF, 63 V, 5%, 5 mm lead pitch, PET",
                "nominal_output_slew_V_per_ms": 0.2,
                "nominal_0_to_9V_ms": 45,
                "nominal_VIN9_grounded_capacitor_charge_mA": rail_inventory["VIN9"][
                    "grounded_nominal_uF"
                ]
                * 0.2,
                "sensitivity_slew_V_per_ms": [0.81 / 10.5, 3.82 / 9.5],
                "sensitivity_0_to_9V_ms": [9 * 9.5 / 3.82, 9 * 10.5 / 0.81],
                "sensitivity_scope": "Illustrative pin-current/C arithmetic with 10 nF +/-5% initial capacitance and TI's 0.81-3.82 uA dVdt pin-current limits at its stated 12 V open-pin test condition. The relationship is assumed linear and ignores temperature drift, component and device parasitics. This is not a specified output-slew or console-startup guarantee at 9 V.",
                "other_loads": "The nominal grounded VIN9 capacitance calculation excludes U63 control-domain startup and load, U20/U21 disabled or transient input currents, resistor currents, input-source impedance and real capacitor bias/tolerance. PG qualification, U64 startup and its downstream enable must also be checked in the actual sequencing and fault conditions.",
                "source": "https://www.ti.com/lit/ds/symlink/tps25947.pdf",
                "part_source": "https://www.wima.de/wp-content/uploads/media/e_WIMA_MKS_2.pdf",
            },
            "buck_softstart_conditions": "TI specifies typical internal softstart only, with no min/max. Its block diagram marks 90% VOUT; do not turn 2 ms into a guaranteed full-output rise time.",
            "PG_assertion_requires": "HFET gate at full overdrive/inrush complete AND PGTH above rising threshold, followed by assertion deglitch. Merely crossing the PGTH voltage during the VIN9 ramp cannot enable the bucks.",
            "PG_assertion_deglitch_typ_us": 12,
            "PG_deassertion_deglitch_typ_us": 12,
            "sequence": "The control supply can rise during the input ramp, but PG stays low through inrush. With RUN selected, U64 enables both bucks after qualified PG; each buck then soft-starts. Moving POWER with the adapter already established does not repeat the adapter-connection ramp. VIN9 C*dV/dt excludes control/load current and downstream converter startup.",
            "capacitor_energy_at_reference_voltages": capacitor_energy,
        },
        "protection_thresholds": thresholds,
        "reverse_input_screen": {
            "cases": reverse_input,
            "scope": "Nominal-resistor KCL with the signal pin fixed at its -0.3 V absolute minimum; branch-current maximum uses top resistor initial tolerance and a pin fixed at 0 V. For a pin between -0.3 and 0 V the latter bounds current drawn through that resistor without credit for the ground leg. Neither calculation models the IC clamp or proves the pin voltage remains within absolute limits. TI recommends less than 10 uA pin current under reverse polarity; these conditional figures are not measured behavior or a damage prediction. IN must also be at least VOUT minus 21 V; output hold-up during reversal is separate.",
        },
        "protection_threshold_scope": "Vrail=Vsense*(1+Rtop/Rbottom)+Iinput*Rtop. Uses native initial resistor tolerance and published sense/leakage intervals; excludes resistor drift/aging, transient filters and propagation delay. TI limits use its stated electrical test conditions, including12 V VIN; not new permitted adapter-voltage ratings.",
        "adapter_reference_screen": {
            "candidate_family": "Mean Well GST40A09, 9 V / 4.45 A nominal",
            "status": "conditional OEM custom assembly, not selected or confirmed stocked",
            "adapter_output_at_its_plug_V": [8.55, 9.45],
            "output_tolerance_basis": "9 V +/-5%; manufacturer includes setup, line and load regulation, with listed general conditions of 230 VAC, rated load, 25 C and 70% RH. The stock P1J is not the selected locking mating plug. Custom-cord electrical tolerance and applicable certifications require manufacturer confirmation.",
            "custom_plug_option": "P2S (S761K), 5.53 mm OD, 2.03 mm ID, 12.06 mm length, floating locking, specified as original Switchcraft or equivalent; factory custom cable, MOQ may apply. No quick adapter listed for this locking option.",
            "selected_console_jack": "Switchcraft L722A, 2.0 mm nominal centre pin and long threaded bushing",
            "selected_jack_mating_part": "Switchcraft S761K, 2.0 mm nominal, 12 mm long, locking",
            "reference_complete_cable": "Switchcraft CAS761K07984, 2 m, straight locking S761K-type plug and stripped/tinned opposite end; separate component, not a finished certified power supply",
            "stock_P1J_plug": "5.5/2.1 mm, length 11 +/-0.5 mm, nonlocking. Not confirmed as a proper mating plug for the selected L722A; not a substitute for P2S/S761K.",
            "initial_passive_screens_V": {
                "plug_min_above_U62_UVLO_rising_max": 8.55
                - thresholds[3]["initial_tolerance_and_leakage_max_V"],
                "plug_max_below_U62_OVLO_rising_min": thresholds[5][
                    "initial_tolerance_and_leakage_min_V"
                ]
                - 9.45,
                "plug_min_above_U60_reset_max": 8.55
                - thresholds[0]["initial_tolerance_and_leakage_max_V"],
            },
            "limits": "Voltage differences compare different nodes with no credit or allowance for jack, return, fuse, eFuse, harness, temperature, ripple or fast transients. The adapter's 4.45 A rating does not override the input fuse's 3.75 A reference at 25 C, guarantee system power, or define an individual port current. Final assembly, correct centre-positive P2S connection, custom cable drop, applicable certification, source availability and real load/temperature must be verified; no user modification of a certified adapter is prescribed.",
            "manufacturer_sources": [
                "https://www.meanwell.com/Upload/PDF/GST40A/GST40A-SPEC.PDF",
                "https://www.switchcraft.com/file.aspx?DocumentId=359",
                "https://www.switchcraft.com/assets/1/24/S761K-S766K_CD.pdf",
            ],
        },
        "cartridge_fault_protection_screen": {
            "status": "design alternatives, not fitted or qualified",
            "shared_signal_nets": shared_cart_signals,
            "socket_connections_from_native_netlist": cart_socket_connections,
            "fitted_bus_topology": "Both sockets presently share each listed net, with CAD through U51 and eight control lines directly at U1. Both socket supply rails and ground are common. No separate per-socket power switch or signal isolation is fitted.",
            "fault_contract": "Book III defines normal card access, but does not promise live insertion, isolated supply faults, or operation of a healthy socket during a fault on the other. A selective shutdown is a protection option, not an existing product guarantee. The present converters' overcurrent behavior does not by itself establish safe current in each connector, card or board path.",
            "isolated_slot_candidate": {
                "signal_paths_per_socket": "The 16 CAD signals, eight shared control outputs, individual select and five individual card inputs all require consideration. Bias networks on READY, IRQ and PRESENT connect the latter inputs to V3V3; DREQ inputs are biased to ground. Ground remains connected.",
                "partial_power_down_example": "SN74LVC16T245 is a candidate 16-bit dual-supply bidirectional transceiver, not a selected complete design. A port is high impedance when either supply is at ground, and Ioff supports partial power down. OE must hold the outputs disabled during power-up and power-down; zero-volt isolation does not establish behavior during a supply ramp, a short on the other rail, or a powered card fault. Fixed-direction controls and return/bias paths require their own appropriate isolation and logic.",
                "switching_data": "At both supplies 3.3 V ±0.3 V, specified A-to-B and B-to-A propagation max are 6.1 ns; OE-to-high-impedance max is 6.2 ns on A and 8.6 ns on B. These are manufacturer test conditions, not an assembled bus timing guarantee. Replacement versus retaining U51 changes the signal path; card load, interconnect, turnaround, enables and READY timing require analysis.",
                "rail_coordination": "Sensing only the 3.3 V output cannot establish isolation when the 5 V output alone collapses; the selected policy must separately account for both rails, their ramp thresholds, threshold tolerances and detection/disable latency. Determine fault behavior and recovery explicitly before wiring logic or choosing trip currents.",
                "source": "https://www.ti.com/lit/ds/symlink/sn74lvc16t245.pdf",
            },
            "load_switch_example": {
                "part_family": "TPS2553-1 latch-off power switch",
                "R_ILIM_ohm": 20000,
                "specified_steady_short_circuit_current_A": [1.2, 1.295, 1.375],
                "current_test_conditions": "RILIM=20 kohm; 1.2/1.375 A are min/max over -40 to 125 C, 1.295 A typical at 25 C. Resistor tolerance, source variation and transient overshoot are not included.",
                "overcurrent_fault_deglitch_ms": [5, 7.5, 10],
                "fault_scope": "Specified assertion/deassertion interval for the overcurrent FAULT condition, not a general lower bound on thermal shutdown or any other fault. Current limiting begins earlier and the output may already be low during this interval.",
                "zero_volt_output_rectangular_scenarios": [
                    {
                        "rail": rail,
                        "input_V": voltages[rail],
                        "assumed_constant_current_A": 1.375,
                        "assumed_duration_ms": milliseconds,
                        "illustrative_switch_dissipation_W": voltages[rail] * 1.375,
                        "illustrative_energy_mJ": voltages[rail] * 1.375 * milliseconds,
                    }
                    for rail in ("V3V3", "V5")
                    for milliseconds in (5, 7.5, 10)
                ],
                "energy_scope": "Ideal VOUT=0, constant 1.375 A and nominal rail for the listed interval, excluding transient overshoot, actual I/V waveform, output capacitance, switching and thermal response. Not a device-safe-operating-area or a worst-case energy guarantee.",
                "source": "https://www.ti.com/lit/ds/symlink/tps2553.pdf",
            },
            "system_implication": "Wiring the proposed switch's delayed FAULT to a common shutdown does not by itself prevent active common signals from reaching a socket whose supply has already collapsed. Separate signal isolation, a sufficiently fast and qualified power-fault/driver-disable scheme, or an explicitly compatible card I/O contract are possible approaches; no single one has been selected or qualified. Keep ground connected.",
            "remaining": "Define actual supported socket and accessory loads, startup current and capacitance, component and branch limits, signal-pad powered-off behavior, failure ordering and recovery. These conditional calculations do not establish safe fault operation or approve a new hardware limit.",
        },
        "accessory_fault_protection_screen": {
            "status": "unfitted example, not an accessory current rating or fault-safety qualification",
            "keyboard_supply": "J301.3 is on common V5; its data and clock high-side pull-ups are also on V5. A series switch in J301.3 alone would not disconnect these pull-ups from an unpowered keyboard.",
            "keyboard_signal_paths_from_native_netlist": keyboard_paths,
            "pad_supply": "J300.14 and J300.15 are on common V3V3 and V5, shared by all four front sockets. A pair of switches at J300 would provide group current limiting, not isolate individual pad sockets or by itself establish fault safety for the supply conductors.",
            "pad_signal_paths_from_native_netlist": pad_series_paths,
            "keyboard_example": {
                "candidate": "TPS2553-1 DBV, separate keyboard V5 path; not fitted",
                "candidate_topology": "Common V5 feeds switch IN; switch OUT feeds J301.3 and relocated R461/R463 high-side pull-ups. Q300/Q301, low-side pull-ups and gate remain at V3V3. The exact enable, reset, bypass, ESD and board layout are not selected.",
                "R_ILIM_ohm": 49900,
                "manufacturer_limit_A_at_exact_resistor": [0.475, 0.520, 0.565],
                "limit_scope": "TI's min/typ/max at the exact 49.9 kOhm setting over the specified junction-temperature test range; external resistor tolerance, transient overshoot and supply conditions require separate design.",
                "illustrative_load_A": 0.250,
                "switch_on_resistance_max_ohm": 0.135,
                "illustrative_switch_drop_max_V": 0.250 * 0.135,
                "illustrative_switch_loss_max_W": 0.250 * 0.250 * 0.135,
                "illustrative_two_lead_length_m_each": 0.20,
                "wire_20C_resistance_nominal_ohm_per_m": 62.5 / 304.8,
                "illustrative_two_lead_drop_V": 0.250 * 0.40 * 62.5 / 304.8,
                "normal_operation_scope": "The 250 mA load and two 0.20 m leads are calculations only, not allowed load, measured lead length, PS/2 compatibility or guarantee. Switch and wire voltage drops exclude connectors, PCB, resistance drift and supply tolerance; switch heatsinking, startup current and short energy are not assessed.",
                "residual_signal_path": "Relocating the 5 V pull-ups is necessary to remove their direct common-V5 feed, but does not remove all injection: Q300/Q301 and R460/R462 still connect the 3.3 V domain to the external clock/data pins. At an ideal zero-voltage high-side fault, two ideal zero-drop paths can draw up to 2*3.3/4700 = 1.404 mA from an assumed 3.3 V through those nominal pull-ups, excluding pin leakage. This screening bound assumes the 3.3 V logic pins do not also drive the nets and is not a fault, back-power or leakage qualification.",
                "fitted_direct_high_pullup_zero_drop_scenario_mA": 2 * 5 / 4700 * 1000,
                "scenario_scope": "The fitted 5 V pull-ups alone can each source 5/4700 A into an ideal 0 V signal short: 2.128 mA combined. This is a nominal hypothetical, not a measured keyboard current or proof of powered-off clamp behavior.",
                "sources": [
                    "https://www.ti.com/lit/ds/symlink/tps2553.pdf",
                    "https://catalog.belden.com/techdata/EN/39128_techdata.pdf",
                ],
            },
            "decision_required": "Define compatible keyboard/pad currents, inrush, voltage at the accessory and recovery behavior; verify the 28 AWG loom and connector for the actual fault waveform. Define or characterize powered-off pad/keyboard signal injection. A parts-only current setting cannot establish those contracts.",
        },
        "input_loss_sequence": {
            "static_reset_before_PG_fall_margin_V": static_input_loss_margin,
            "V9_sense_filter_C62_nominal_us": v9_filter_tau_us,
            "interpretation": "For slowly falling VIN9, the input supervisor threshold is above the PG falling threshold in this initial-tolerance screen. C62 filters the supervisor sense and both ICs have delays; the voltage margin is not a guaranteed time budget. Local V3V3 collapse is a different path. No new supervisor is selected merely because typical delays lack maxima.",
        },
        "enable_comparator_screen": comparator_screen,
        "private_dram_current_screen": {
            "installed_devices": {"U10": values["U10"], "U11": values["U11"]},
            "device_current_A": 0.160,
            "device_current_conditions": "ISSI IS41LV16100-50 ICC3 random read/write and ICC6 CBR average supply current, minimum tRC, output open, recommended operating conditions. This is not a transient peak, a normal-utilisation measurement, or a bound under other loading conditions.",
            "cases": [
                {
                    "public_banks": 1,
                    "private_banks": private_banks,
                    "device_count": 2 * (1 + private_banks),
                    "sum_of_test_condition_currents_A": 2 * (1 + private_banks) * 0.160,
                    "power_at_nominal_3V3_W": 2 * (1 + private_banks) * 0.160 * voltages["V3V3"],
                    "increment_over_fitted_bank_A": 2 * private_banks * 0.160,
                    "increment_at_nominal_3V3_W": 2 * private_banks * 0.160 * voltages["V3V3"],
                }
                for private_banks in (0, 1, 2)
            ],
            "scope": "Arithmetic sum of each device's specified test-condition average, not a qualified total-system or instantaneous peak. The selected two-bank RTL accesses one bank at a time and refreshes both together; shared CAS, device outputs and operating load differ from the isolated data-sheet conditions. Extra devices are candidates only, not fitted. ASIC drive, capacitors, signal loss, buck efficiency, other loads, duty cycle, rail transient and thermal coupling are excluded. No subtraction from an unknown whole-system budget establishes headroom.",
            "source": "https://www.mouser.com/catalog/specsheets/issi_IS41C16100.pdf#page=6",
        },
        "inductor_current_screen": {
            "cases": inductor_screen,
            "high_saturation_alternate": {
                "status": "candidate_only_no_bom_change",
                "data_source": "https://www.vishay.com/docs/34316/ihlp-3232dz-01.pdf",
                "case_scope": "Same stated zero-bias L and tolerance as each installed -11, with identical 3232DZ body and recommended pad geometry. This is a manufacturer-data comparison, not verified compatibility, control-loop stability, a guaranteed saturation limit or a temperature qualification.",
                "cases": [
                    {
                        "rail": case["rail"],
                        "installed_MPN": case["MPN"],
                        "alternate_MPN": alternate[0],
                        "inductance_scenario_factor": case["inductance_scenario_factor"],
                        "input_scenario_V": case["input_scenario_V"],
                        "output_scenario_V": case["output_scenario_V"],
                        "current_scenario_A": case["current_scenario_A"],
                        "switching_scenario_kHz": case["switching_scenario_kHz"],
                        "estimated_rms_A": case["calculated_rms_A"],
                        "alternate_saturation_current_typ_A": alternate[1],
                        "alternate_heat_rating_typ_A": alternate[2],
                        "alternate_DCR_max_25C_mohm": alternate[3],
                        "alternate_winding_DCR_loss_25C_W": case["calculated_rms_A"] ** 2
                        * alternate[3]
                        / 1000,
                        "incremental_DCR_loss_25C_W": case["calculated_rms_A"] ** 2
                        * (alternate[3] - case["winding_DCR_max_25C_mohm"])
                        / 1000,
                        "peak_at_max_valley_same_ripple_scenario_A": case[
                            "peak_at_max_valley_same_ripple_scenario_A"
                        ],
                    }
                    for case in inductor_screen
                    for alternate in [
                        ("IHLP3232DZER2R2M01", 23.0, 10.5, 13.7)
                        if case["rail"] == "V3V3"
                        else ("IHLP3232DZER3R3M01", 20.0, 9.2, 17.7)
                    ]
                ],
                "saturation_scope": "Vishay's 20% reduction currents are typical at 25 C, not specified minima. Comparing a hypothetical valley-plus-normal-ripple peak to those numbers does not bound actual fault transients, loaded inductance or temperature.",
                "thermal_scope": "Higher 25 C DCR increases winding loss compared with the installed -11; heat-current figures and losses omit AC/core losses, temperature-dependent DCR, actual thermal mounting, tolerances and enclosure. Neither this comparison nor part footprint implies adequate cooling.",
                "remaining": "Verify supplier and lot, loop/transient performance with the actual effective output capacitors and layout, loaded L and dynamic overcurrent, thermal behavior, mounting, and component endurance before changing BOM.",
            },
            "scope": "Continuous-conduction triangular-current estimate at stated 9 V input, nominal setpoint, 6 A output and 500 kHz. Each rail is evaluated independently; the shared input does not guarantee both 6 A. The 0.8 nominal L case is a sensitivity based on Vishay's +/-20% zero-current 100 kHz tolerance, not minimum inductance under load or a worst-case bound. 500 kHz is a TI typical-condition design value, not a guaranteed frequency interval.",
            "ratings": "Vishay values are typical DC currents at 25 C: heat rating is approximately 40 C part rise and saturation rating is approximately 20% inductance reduction. They are not guaranteed minima, AC-current ratings, limits at operating temperature or proof of safety. For 3.3 uH the Vishay labels (10.5 A heating, 9.7 A saturation) differ in order from the TPS56637 example's peak/RMS labels; use the component manufacturer's own definitions.",
            "current_limit_scope": "TI's 6.3-8.6 A limit applies to sensed valley current, not peak current. A hypothetical 8.6 A valley plus the normal-running scenario's ripple yields a peak near or above Vishay's typical 20% L-drop current. This is not a measured fault waveform or a proof of saturation/failure: ripple, switching, L versus current and heat all change under overcurrent. Verify protection transients with actual inductance, layout and thermals.",
            "loss_scope": "DCR loss uses the manufacturer's 25 C maximum DCR with calculated RMS current. Copper DCR increases with temperature; core/switching losses and enclosure thermal coupling are excluded. End-use inductor temperature must be measured and remain within manufacturer part-temperature limits.",
        },
        "transient_sensitivity": transient,
        "brownout_sensitivity": brownout,
        "dynamic_interpretation": [
            "Ceff scales 0.5/0.75/1.0 are sensitivity axes, not measured or guaranteed capacitance bounds; grounded nominal sums are not minimum effective C.",
            "Current deficits and support gaps are diagnostic inputs, not ASIC loads, allowed ripple or converter response times. DeltaV=deficit*time/C excludes ESR/ESL/distribution drop and continuing converter support.",
            "Brownout times assume a constant net current deficit on an ideal lumped V3V3 capacitor, not a model of adapter/buck input collapse or actual flash-pin voltage.",
            "The LTC1326 typical 13 us detect delay applies after more than 1% threshold overdrive; no maximum is published. Both the threshold-to-2.7 V interval and its remaining interval after 1% overdrive are shown.",
            "ASIC reset synchronisation, flash CE#/OE# stopping, pin waveforms and other devices' voltage minima remain outside this charge screen. A comparison with 13 us is neither a pass nor a proven failure.",
        ],
        "equation": "V3V3 * I3V3 + V5 * I5 <= efficiency * 9 V * 3.960 A; each I <= 6 A",
        "fuse_reference_equation": "V3V3 * I3V3 + V5 * I5 <= efficiency * 9 V * 3.750 A; each I <= 6 A, at the 25 C fuse-selection reference",
        "scenario_basis": {
            "efficiency": "Aggregate RAW9-to-main-rails sensitivity includes protection, control and conversion losses; not measured or guaranteed efficiency.",
            "input_reference_V": input_V,
            "breaker_test_min_A": breaker_min_A,
            "breaker_programming_ref": "R76",
            "breaker_programming_value": values["R76"],
            "fuse_reference": "F60",
            "fuse_rating_A": fuse_rating_A,
            "fuse_standard_continuous_rating_factor": fuse_continuous_derating,
            "fuse_25C_continuous_design_reference_A": fuse_reference_A,
            "fuse_reference_conditions": "Littelfuse 451/453 calls for a standard 25% derating for continuous operation, with its ambient-temperature rerating applied additionally. The 25 C design reference is not a guaranteed console current or a fuse opening threshold.",
            "buck_component_rating_A_each": buck_rating_A,
            "both_6A_nominal_output_W": buck_rating_A * sum(voltages.values()),
            "effective_COUT_recommended_uF": [20, 100],
        },
        "interpretation": [
            "Capacitance is nominal; other-net capacitors are not counted as grounded decoupling.",
            "TI's 20-100 uF effective COUT range is a recommendation, not an absolute rating; the nominal inventory is not a stability violation.",
            "External cartridge/peripheral capacitance and current are unknown; no maximum is invented.",
            "Each rail's 6 A component rating is not permission to draw 6 A from both rails.",
            "3.960 A is TI's minimum at the nominal 750-ohm test point; resistor tolerance and adapter/cable margins are not qualified.",
            "F60's 3.75 A design reference at 25 C is distinct from U62's 3.960 A test-point minimum. Temperature rerating, actual loads, efficiency, transients and assembly are not established; neither comparison guarantees continuous system capability or predicts fuse opening.",
            "This closes inventory and conditional shared-current arithmetic, not actual ASIC consumption, effective capacitance/ESR, control-loop response, brownout or pin waveforms.",
        ],
        "primary_sources": {
            "TPS56637_Table4_and_sections_8_2_2_1_8_2_2_2": components["U20"].findtext("datasheet"),
            "Vishay_IHLP3232DZ11_inductance_and_typical_current_definitions": components[
                "L1"
            ].findtext("datasheet"),
            "TPS25947_section_6_5_750ohm_test_point": components["U62"].findtext("datasheet"),
            "Littelfuse_451_453_continuous_and_temperature_rerating": "https://www.littelfuse.com/assetdocs/fuse-451-and-453-datasheet?assetguid=533cd5cc-956c-4243-867f-6ab5a62f6ba1",
            "LTC1326_electrical_characteristics": "https://www.analog.com/media/en/technical-documentation/data-sheets/132625fc.pdf",
            "LTC1326_native_package_reference": components["U60"].findtext("datasheet"),
            "TPS25947_PG_semantics_and_thresholds": "https://www.ti.com/lit/ds/symlink/tps25947.pdf#page=39",
            "TLV7031_single_comparator_characteristics": components["U64"].findtext("datasheet"),
            "SST39VF6401B_supply_range": components["U33"].findtext("datasheet"),
        },
        "input_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (netlist, bom_path, ROOT / "ecad/mainboard/BMSX.kicad_pcb", Path(__file__))
        },
    }
    report = ROOT / "build/reports/power-budget.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(result, indent=2) + "\n")
    for name, rows in (
        ("Power_rail_capacitance.csv", capacitor_rows),
        ("Power_load_envelope.csv", envelope),
        ("Power_transient_sensitivity.csv", transient),
        ("Power_brownout_sensitivity.csv", brownout),
        ("Power_protection_thresholds.csv", thresholds),
    ):
        with (ROOT / "build/exports" / name).open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
    print(
        json.dumps(
            {
                "grounded_V3V3_nominal_uF": rail_inventory["V3V3"]["grounded_nominal_uF"],
                "grounded_V5_nominal_uF": rail_inventory["V5"]["grounded_nominal_uF"],
                "envelope_rows": len(envelope),
                "nominal_setpoints_V": voltages,
            }
        )
    )


if __name__ == "__main__":
    main()
