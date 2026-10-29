"""Numerical reference for the proposed bounded physical video sampler.

Not an emulator, RTL simulation, TV-sync generator or silicon timing proof.
The programmed/display register owners and all native CAD are read-only.
"""

import hashlib
import json
import os
import xml.etree.ElementTree as ET
from collections import deque
from fractions import Fraction
from pathlib import Path
from random import Random

ROOT = Path(__file__).resolve().parents[1]
SPEC = json.loads((ROOT / "design/video_baseline.json").read_text())
VIDEO_HZ = SPEC["clocks"]["sampler_and_dac_hz"]
MEM_HZ = SPEC["clocks"]["gfx_local_memory_hz"]


def decode_timing_words(words):
    """Physical-model register boundary; matches the public bit fields.

    Raw words stay intact in the caller. This is not a supported-mode filter.
    """
    smode1 = words["SMODE1_LOW"]
    synch1 = words["SYNCH1_LOW"]
    synch2 = words["SYNCH2_LOW"]
    syncv = words["SYNCV_LOW"]
    syncv_high = words["SYNCV_HIGH"]
    fields = {
        "HFP": synch1 & 0x7FF,
        "HBP": (synch1 >> 11) & 0x7FF,
        "HS": (words["SYNCH1_HIGH"] >> 11) & 0xFFFF,
        "HF": synch2 & 0x7FF,
        "HB": (synch2 >> 11) & 0xFFFF,
        "RC": smode1 & 7,
        "LC": (smode1 >> 3) & 0x7F,
        "divider": (smode1 >> 10) & 3,
        "StepX": (smode1 >> 21) & 15,
        "CMOD": (smode1 >> 13) & 3,
        "U": 1 + ((words["SMODE1_HIGH"] >> 4) & 1),
        "INT": words["SMODE2_LOW"] & 1,
        "FFMD": (words["SMODE2_LOW"] >> 1) & 1,
        "VFP": syncv & 0x3FF,
        "VFPE": (syncv >> 10) & 0x3FF,
        "VBP": syncv >> 20,
        "VBPE": syncv_high & 0x3FF,
        "VDP": (syncv_high >> 10) & 0x7FF,
        "VS": (syncv_high >> 21) & 0x7FF,
    }
    fields["D"] = fields["RC"] * (fields["divider"] + 1)
    return fields


def advance(phase, modulus, quotient, remainder):
    total = phase + remainder
    carry = int(total >= modulus)
    return quotient + carry, total - carry * modulus


def crossings(start, distance, period, landmark):
    """Periodic crossings for bounded arithmetic tests, not a CSR scheduler."""
    offset = (start + period - landmark) % period
    return (offset + distance) // period


def sampler_case(horizontal, divider, lc, step, samples=12):
    modulus = horizontal * divider
    quotient, remainder = divmod(2 * lc, modulus)
    phase = half_line = 0
    rows = []
    for tick in range(samples):
        numerator = (half_line & 1) * modulus + phase
        index = numerator // (2 * divider * step)
        rows.append(
            {
                "sample": tick,
                "logical_pixel": index,
                "signal_coordinate": index * step,
                "half_line": half_line,
                "phase": phase,
            }
        )
        crossed, phase = advance(phase, modulus, quotient, remainder)
        half_line += crossed
    return rows


def check_phase():
    checked = 0
    dividers = sorted({rc * (field + 1) for rc in range(1, 8) for field in range(4)})
    for horizontal in (1, 2, 3, 127, 254, 255, 3456, SPEC["widths"]["H_max"]):
        for divider in dividers:
            modulus = horizontal * divider
            for lc in range(128):
                quotient, remainder = divmod(2 * lc, modulus)
                for phase in {0, modulus // 2, modulus - 1}:
                    actual = advance(phase, modulus, quotient, remainder)
                    assert actual == divmod(phase + 2 * lc, modulus)
                    assert actual[0] <= 254
                    assert actual[1] < 1 << 22
                    checked += 1
    random = Random(0xB054)
    for _ in range(10000):
        horizontal = random.randrange(1, 137212)
        divider = random.choice(dividers)
        modulus = horizontal * divider
        lc = random.randrange(128)
        phase = random.randrange(modulus)
        q0, r0 = divmod(2 * lc, modulus)
        assert advance(phase, modulus, q0, r0) == divmod(phase + 2 * lc, modulus)
        checked += 1
    return checked


def check_field_reduction():
    checked = 0
    for base_crossed in range(255):
        for period in (1, 2, 3, 625, 628, 22516):
            reduced = [divmod(base_crossed + carry, period) for carry in (0, 1)]
            for half_line in {0, period // 2, period - 1}:
                for carry in (0, 1):
                    q0, r0 = reduced[carry]
                    assert advance(half_line, period, q0, r0) == divmod(
                        half_line + base_crossed + carry, period
                    )
                    checked += 1
    return checked


def check_events():
    checked = 0
    random = Random(0xB0E7)
    for _ in range(5000):
        period = random.choice((1, 2, 3, 625, 628, 22516))
        start = random.randrange(period)
        distance = random.randrange(255)
        landmark = random.randrange(period + 1)
        actual = crossings(start, distance, period, landmark)
        expected = sum((p - landmark) % period == 0 for p in range(start + 1, start + distance + 1))
        assert actual == expected
        assert 0 <= actual <= 254
        checked += 1
    return checked


def check_schedule():
    """Worst 3-read jobs, each phase of the64-slot schedule and4:1 clock.

    Each queued job is one physical sample (two circuits), not a raw-word
    FIFO entry. Decode takes two further local slots after its last read.
    RGB and sync share the assumed eight-sample pipeline latency.
    """
    cases = []
    for schedule_phase in range(64):
        jobs = deque()
        completed = deque()
        current = None
        samples = 4096
        read_count = 0
        min_slack = 1 << 30
        max_queue = max_decoded = max_latency = 0
        for slot in range(samples * 4 + 32):
            if slot % 4 == 0 and slot // 4 < samples:
                jobs.append([slot // 4, 3, slot])
            if (slot + schedule_phase) % 64 < 48:
                if current is None and jobs:
                    current = jobs.popleft()
                if current is not None:
                    current[1] -= 1
                    read_count += 1
                    if current[1] == 0:
                        ready = slot + SPEC["memory"]["model_decode_latency_slots"]
                        deadline = current[2] + 32
                        min_slack = min(min_slack, deadline - ready)
                        max_latency = max(max_latency, ready - current[2])
                        completed.append((current[0], ready))
                        current = None
            if slot >= 32 and slot % 4 == 0:
                sample = (slot - 32) // 4
                assert completed and completed[0][0] == sample
                assert completed[0][1] <= slot
                completed.popleft()
            max_queue = max(max_queue, len(jobs) + int(current is not None))
            max_decoded = max(max_decoded, len(completed))
        assert read_count == 3 * samples
        assert not jobs and not completed and current is None
        assert max_decoded <= 128
        cases.append(
            {
                "phase": schedule_phase,
                "samples": samples,
                "minimum_ready_slack_local_slots": min_slack,
                "maximum_request_to_decoded_slots": max_latency,
                "maximum_pending_sample_jobs": max_queue,
                "maximum_decoded_pairs": max_decoded,
            }
        )
    return {
        "cases": len(cases),
        "samples_per_case": samples,
        "minimum_ready_slack_local_slots": min(c["minimum_ready_slack_local_slots"] for c in cases),
        "maximum_request_to_decoded_slots": max(
            c["maximum_request_to_decoded_slots"] for c in cases
        ),
        "maximum_pending_sample_jobs": max(c["maximum_pending_sample_jobs"] for c in cases),
        "maximum_decoded_pairs": max(c["maximum_decoded_pairs"] for c in cases),
        "underruns": 0,
        "scope": "Exact integer slot schedule under stated service/decode/latency assumptions; not arbitration RTL or CDC/STA.",
    }


def native_parts():
    tree = ET.parse(ROOT / "build/exports/BMSX_netlist.xml").getroot()
    components = {c.attrib["ref"]: c.findtext("value") for c in tree.findall("./components/comp")}
    refs = ("U2", "U30", "U31", "U35", "U40", "R410", "R515", "Y1", "Y2")
    result = {ref: components[ref] for ref in refs}
    assert result["U30"] == result["U31"] == SPEC["memory"]["sram_mpn"]
    assert SPEC["analog"]["dac_mpn"] in result["U35"]
    assert result["Y1"] == "SG-8018CA 33.8688M-TJHPA0"
    assert result["Y2"] == "SG-8018CA 13.5000M-TJHPA0"
    nets = {
        n.attrib["name"]: sorted((p.attrib["ref"], p.attrib["pin"]) for p in n.findall("node"))
        for n in tree.findall("./nets/net")
    }
    expected = {
        "CLK_OSC": [("R232", "1"), ("Y1", "3")],
        "CLK_BEAM_OSC": [("R410", "1"), ("Y2", "3")],
        "CLK_BEAM": [("R410", "2"), ("U2", "193")],
        "VIDEO_PCLK": [("U2", "96"), ("U40", "2")],
        "VIDEO_PCLK_BUF": [("R515", "1"), ("U40", "4")],
        "VIDEO_PCLK_DAC": [("R515", "2"), ("U35", "24")],
    }
    for name, pads in expected.items():
        assert nets[name] == pads
    return {"parts": result, "dac_clock_nets": expected}


def check_independent_clocks():
    """Clock-pacing boundaries; no CDC or real-time pipeline signoff.

    Both identified Epson SG-8018CA oscillators have a +/-50 ppm stability
    specification. Relative endpoints are independent; calculate in exact
    rational arithmetic before printing any numbers. Product reference:
    https://www.epsondevice.com/crystal/en/products/crystal-oscillator/sg8018ca.html
    """
    ppm = 50
    p = Fraction(ppm, 1_000_000)
    system_hz = SPEC["clocks"]["system_hz"]
    video_hz = SPEC["clocks"]["sampler_and_dac_hz"]
    system_min, system_max = system_hz * (1 - p), system_hz * (1 + p)
    video_min, video_max = video_hz * (1 - p), video_hz * (1 + p)
    min_ratio, max_ratio = system_min / video_max, system_max / video_min
    assert min_ratio > 2
    # A nominal SYS-ratio pacing NCO drifts against the independent video
    # oscillator. This is a continuous limiting example, not a discrete FIFO
    # failure time, initial-fill rule, or certified crystal frequency history.
    max_drift = video_max - video_hz * (1 - p)
    assert max_drift == 1350
    # Two-flop observation plus a downstream SYS register can take up to
    # three slow SYS periods. One live video payload may already have changed
    # at the next fast video edge by then: toggle sync alone is not a bundled
    # data hold protocol.
    worst_sync_ns = Fraction(3 * 1_000_000_000, 1) / system_min
    shortest_pixel_ns = Fraction(1_000_000_000, 1) / video_max
    assert worst_sync_ns > shortest_pixel_ns

    # Conditional arrival/service screen for the unbackpressured PCRTC FIFO.
    # An interval contains at most one bootstrap OR previously dirty-bank
    # publication in addition to one publication/reset per accepted write.
    # The endpoint accepts write DATA edges at least four SYS clocks apart.
    # Thus alpha(t) = 2 + floor(t/(4*Tsys_fast)), counting both endpoints.
    #
    # Assume a continuously ready sink and an ordered credit service with
    # latency L <= 3*Tvideo_slow + 3*Tsys_slow and then one credit per video
    # period while work is available. The three edges per domain cover two
    # synchronizer stages plus acceptance on a following edge. This is a
    # service-curve hypothesis, not yet a refinement proof of async_fifo.
    # For beta(t)=max(0,1+floor((t-L)/Tvideo_slow)), alpha-beta <= 4 if
    # L < 12*Tsys_fast and Tvideo_slow < 4*Tsys_fast: before L the arrival
    # bound is at most four; after L service grows faster than arrivals.
    # The separate L+Tvideo < 16*Tsys check covers the interval immediately
    # before the second credit, including closed-endpoint counting.
    fast_sys_ns = Fraction(1_000_000_000, 1) / system_max
    slow_sys_ns = Fraction(1_000_000_000, 1) / system_min
    slow_video_ns = Fraction(1_000_000_000, 1) / video_min
    cdc_service_latency_ns = 3 * slow_video_ns + 3 * slow_sys_ns
    cdc_fifth_arrival_ns = 12 * fast_sys_ns
    cdc_second_credit_window_ns = 16 * fast_sys_ns
    assert cdc_service_latency_ns < cdc_fifth_arrival_ns
    assert cdc_service_latency_ns + slow_video_ns < cdc_second_credit_window_ns
    assert slow_video_ns < 4 * fast_sys_ns
    return {
        "sys_oscillator": "Y1 SG-8018CA 33.8688M-TJHPA0",
        "video_oscillator": "Y2 SG-8018CA 13.5000M-TJHPA0",
        "independent_frequency_stability_each_ppm": ppm,
        "source": "https://www.epsondevice.com/crystal/en/products/crystal-oscillator/sg8018ca.html",
        "sys_periods_per_video_period": {"min": float(min_ratio), "max": float(max_ratio)},
        "nominal_nco_extreme_relative_drift_samples_per_second": int(max_drift),
        "32_samples_of_accumulated_drift_seconds": float(Fraction(32, 1) / max_drift),
        "shortest_video_period_ns": float(shortest_pixel_ns),
        "three_slowest_system_periods_ns": float(worst_sync_ns),
        "pcrtc_four_entry_abstract_credit_screen": {
            "fast_system_period_ns": float(fast_sys_ns),
            "slow_system_period_ns": float(slow_sys_ns),
            "slow_video_period_ns": float(slow_video_ns),
            "assumed_service_latency_ns": float(cdc_service_latency_ns),
            "earliest_fifth_event_ns": float(cdc_fifth_arrival_ns),
            "latency_margin_ns": float(cdc_fifth_arrival_ns - cdc_service_latency_ns),
            "max_abstract_backlog_entries": 4,
            "arrival_bound": "2 + floor(t/(4*Tsys_fast)); includes one bootstrap or pre-existing dirty-bank event plus endpoint writes.",
            "service_assumption": "Ordered, continuously ready video consumption; at most 3 slow video plus 3 slow SYS periods for the first credit, then one credit per slow video period when backlogged.",
            "scope": "Conditional rate/latency calculation for reset-free normal operation, not a refinement proof of the actual FIFO, physical clock jitter, bounded synchronizer resolution, metastability, startup/reset protocol or full GFX system. A stopped video clock has no finite service bound and loses updates in the existing test.",
        },
        "scope": (
            "Steady nominal rate and independent-frequency limits, not startup, jitter, "
            "metastability MTBF, clock-stop behavior, pixel deadline or ASIC STA. "
            "The 32-sample result is an illustrative drift interval; actual FIFO "
            "failure depends on fill level and discrete crossings."
        ),
        "architectural_implications": [
            "Use the actual Y2-derived physical video clock for output pacing, not an independent SYS-clock nominal NCO.",
            "The one-bit clock-event crossing requires qualified synchronizer placement and metastability analysis; rate alone is not an event-delivery proof.",
            "Keep each sample's video-domain coordinate/sync payload stable until accepted using an ordered physical CDC; a synchronized toggle does not hold multi-bit data.",
            "A SYS-domain sample can atomically take displayed configuration and current FIELD at its selected SYS edge, but this is a proposed quantized sampling rule, not proof of their exact state on the earlier video edge.",
            "Prove bounded arbitration, memory service, return buffering and fixed end-to-end latency; no underflow or reset policy is implied by this frequency calculation.",
        ],
    }


def main():
    assert 3 * 2047 + 2 * 65535 == SPEC["widths"]["H_max"]
    assert SPEC["widths"]["H_max"] * 28 == SPEC["widths"]["N_max"]
    assert 2 * (3 * 1023 + 4095 + 2 * 2047) == SPEC["widths"]["total_half_lines_max"]
    assert SPEC["widths"]["N_max"] - 1 + 254 == SPEC["widths"]["phase_sum_max"]
    assert SPEC["widths"]["phase_sum_max"] < 1 << SPEC["widths"]["phase_sum_bits"]
    phase_checks = check_phase()
    field_checks = check_field_reduction()
    event_checks = check_events()
    reset = sampler_case(3456, 8, 32, 4)
    step1 = sampler_case(3456, 8, 32, 1)
    step15 = sampler_case(3456, 8, 32, 15)
    extreme = sampler_case(1, 1, 127, 1)
    assert [r["logical_pixel"] for r in reset] == list(range(12))
    assert [r["logical_pixel"] for r in step1] == [4 * n for n in range(12)]
    assert [r["signal_coordinate"] for r in step15] == [15 * ((4 * n) // 15) for n in range(12)]
    assert [r["half_line"] for r in extreme] == [254 * n for n in range(12)]
    report = {
        "status": SPEC["status"],
        "native_sources": native_parts(),
        "physical_clocks_hz": SPEC["clocks"],
        "independent_clock_pacing": check_independent_clocks(),
        "phase_reduction_checks": phase_checks,
        "field_reduction_checks": field_checks,
        "multiple_landmark_count_checks": event_checks,
        "reset_first_samples": reset,
        "reset_step_one_first_samples": step1,
        "reset_step_fifteen_first_samples": step15,
        "H1_LC127_first_samples": extreme,
        "direct_unbounded_interpretation_hz": {
            "reset": 13500000,
            "reset_step_one": 54000000,
            "maximum": 1714500000,
        },
        "physical_output_hz_all_cases": VIDEO_HZ,
        "local_slot_ns": float(Fraction(1000000000, MEM_HZ)),
        "non_sram_read_budget_ns": float(Fraction(1000000000, MEM_HZ) - 10),
        "minimum_nominal_dac_clock_high_low_ns": float(Fraction(1000000000, 2 * VIDEO_HZ)),
        "scanout_reads_per_second": MEM_HZ * 48 // 64,
        "render_two_slot_writes_per_second": MEM_HZ * 7 // 64,
        "continuous_worst_scanout_schedule": check_schedule(),
        "reset_line_ns": float(Fraction(3456 * 8 * 1000000000, VIDEO_HZ * 32)),
        "reset_field_hz": float(Fraction(2 * VIDEO_HZ * 32, 3456 * 8 * 628)),
        "hs254_signal_units_at_reset_sample_width": {
            "exact": "127/2",
            "uniform_sample_width_bounds_depending_on_phase": [63, 64],
            "waveform_simulated": False,
            "TV_qualified": False,
        },
        "implemented_RTL": False,
        "STA_qualified": False,
        "analog_TV_qualified": False,
        "native_CAD_written_by_this_model": False,
        "emulator_or_books_modified": False,
        "source_sha256": {},
    }
    for path in (
        ROOT / "build/exports/BMSX_netlist.xml",
        ROOT / "design/video_baseline.json",
        ROOT / "tools/video_timing.py",
        ROOT / "rtl/gfx_pcrtc_sys_endpoint.sv",
        ROOT / "rtl/gfx_pcrtc_control.sv",
        ROOT / "rtl/gfx_pcrtc_status.sv",
        ROOT / "rtl/gfx_pcrtc_beam_phase.sv",
        ROOT / "rtl/gfx_pcrtc_system_beam.sv",
        ROOT / "rtl/gfx_pcrtc_cdc_startup.sv",
        ROOT / "rtl/async_fifo.sv",
        ROOT.parent / "docs/book1/pcrtc.md",
        ROOT.parent / "machine/ts/machine/devices/gx/gpu_pcrtc.ts",
        ROOT.parent / "machine/cpp/machine/devices/gx/gpu_pcrtc.cpp",
    ):
        report["source_sha256"][os.path.relpath(path, ROOT)] = hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
    output = ROOT / "build/reports/video-timing.json"
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                "phase_checks": phase_checks,
                "field_checks": field_checks,
                "event_checks": event_checks,
                "physical_sampler_hz": VIDEO_HZ,
                "RTL_implemented": False,
            }
        )
    )


if __name__ == "__main__":
    main()
