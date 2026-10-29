"""Check native READY pullup and the physical SYS release-current/timing budget.

First-order RC is an acceptance screen, not an extracted interconnect or pad
simulation. The ASIC implementation must meet the declared sink/setup/release
limits and the completed PCB must remain within the total capacitance budget.
"""

import hashlib
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    owner = ROOT / "design/system_bus.json"
    netlist = ROOT / "build/exports/BMSX_netlist.xml"
    design = json.loads(owner.read_text())
    limits = design["ready_electrical"]
    tree = ET.parse(netlist).getroot()
    values = {c.attrib["ref"]: c.findtext("value") for c in tree.findall("./components/comp")}
    nets = {
        net.attrib["name"]: {(n.attrib["ref"], n.attrib["pin"]) for n in net.findall("node")}
        for net in tree.findall("./nets/net")
    }
    assert values[limits["pullup_ref"]] == limits["pullup_value"]
    ready = nets["SYS_READY_N"]
    assert {ref for ref, _ in ready} == {"R247", "U1", "U2", "U4", "U7"}
    resistor_pins = {pin for ref, pin in ready if ref == "R247"}
    assert len(resistor_pins) == 1
    assert {("R247", "1"), ("R247", "2")} - {("R247", next(iter(resistor_pins)))} <= nets["V3V3"]
    resistance = limits["pullup_ohms"]
    rmin = resistance * (1 - limits["tolerance_fraction"])
    rmax = resistance * (1 + limits["tolerance_fraction"])
    rc_ns = rmax * limits["total_capacitance_max_pF"] * 0.001
    rise_ns = -rc_ns * math.log(1 - limits["input_high_fraction"])
    sink_mA = (limits["VDD_max_V"] - limits["VOL_max_V"]) / rmin * 1000
    budget_ns = limits["turn_response_clocks"] * 1e9 / design["clock_hz"]
    used_ns = rise_ns + sum(
        limits[name]
        for name in ("pad_release_max_ns", "board_delay_max_ns", "receiver_setup_max_ns")
    )
    assert sink_mA <= limits["pad_sink_min_mA_at_VOL"]
    assert used_ns < budget_ns
    bias = design["control_pad_bias"]
    bias_rmin = bias["ohms_nominal"] * (1 - bias["tolerance_fraction"])
    bias_rmax = bias["ohms_nominal"] * (1 + bias["tolerance_fraction"])
    bias_rise_ns = (
        -bias_rmax
        * bias["total_capacitance_max_pF"]
        * 0.001
        * math.log(1 - bias["input_high_fraction"])
    )
    bias_sink_mA = (bias["VDD_max_V"] - bias["VOL_max_V"]) / bias_rmin * 1000
    assert bias_rise_ns < bias["minimum_board_reset_ns"]
    assert bias_sink_mA < bias["control_pad_sink_min_mA"]
    for name in (
        "SYS_AS_N",
        "SYS_RD_N",
        "SYS_WR_N",
        "SYS_BE0_N",
        "SYS_BE1_N",
        "SYS_BE2_N",
        "SYS_BE3_N",
    ):
        assert {ref for ref, _ in nets[name]} == {"U1", "U2", "U4", "U7"}
    result = {
        "U1_control_bias_rise_from_zero_to_VIH_max_ns": bias_rise_ns,
        "U1_control_bias_reset_settling_margin_ns": bias["minimum_board_reset_ns"] - bias_rise_ns,
        "U1_control_bias_extra_sink_per_low_pin_mA": bias_sink_mA,
        "U1_control_bias_all_seven_low_max_mW": bias["count"]
        * bias["VDD_max_V"] ** 2
        / bias_rmin
        * 1000,
        "scope": limits["scope"],
        "native_READY_nodes": sorted(ready),
        "pullup_value": values["R247"],
        "rc_max_ns": rc_ns,
        "rise_to_VIH_max_ns": rise_ns,
        "sink_at_VOL_max_mA": sink_mA,
        "pullup_power_at_zero_VOL_max_mW": limits["VDD_max_V"] ** 2 / rmin * 1000,
        "release_rc_board_setup_max_ns": used_ns,
        "turn_response_budget_ns": budget_ns,
        "remaining_release_margin_ns": budget_ns - used_ns,
        "input_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (owner, netlist, Path(__file__))
        },
    }
    target = ROOT / "build/reports/system-bus-timing.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: result[k] for k in ("rise_to_VIH_max_ns", "remaining_release_margin_ns")}))


if __name__ == "__main__":
    main()
