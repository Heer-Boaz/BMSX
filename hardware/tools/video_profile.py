"""Finite sample/pulse reference for the proposed physical 625/50 profile.

No register writes, emulator changes, native CAD writes or RTL claims.
The central baseline owns register decoding and the bounded phase datapath.
"""

import hashlib
import json
import os
from collections import Counter
from fractions import Fraction
from pathlib import Path

from video_timing import ROOT, advance, decode_timing_words

PROFILE_PATH = ROOT / "design/analog_video_profile.json"
PROFILE = json.loads(PROFILE_PATH.read_text())


def sync_pulses(fields=2):
    """Return low intervals, using global parity, not local field parity."""
    timing = PROFILE["timing"]
    half_samples = timing["samples_per_half_line"]
    period = timing["half_lines_per_field"]
    waveform = PROFILE["waveform"]
    pulses = []
    for global_half in range(fields * period):
        local_half = global_half % period
        if (
            waveform["pre_equalizing_half_lines"][0]
            <= local_half
            < waveform["pre_equalizing_half_lines"][1]
        ):
            width, kind = timing["equalizing_samples"], "pre_equalizing"
        elif waveform["broad_half_lines"][0] <= local_half < waveform["broad_half_lines"][1]:
            width, kind = timing["broad_sync_samples"], "broad"
        elif (
            waveform["post_equalizing_half_lines"][0]
            <= local_half
            < waveform["post_equalizing_half_lines"][1]
        ):
            width, kind = timing["equalizing_samples"], "post_equalizing"
        elif (global_half & 1) == 0:
            width, kind = timing["line_sync_samples"], "line"
        else:
            continue
        start = global_half * half_samples
        pulses.append((start, start + width, kind))
    return pulses


def check_words():
    words = {name: int(word, 16) for name, word in PROFILE["raw_register_words"].items()}
    fields = decode_timing_words(words)
    assert fields == PROFILE["expected_fields"]
    horizontal = sum(fields[name] for name in ("HFP", "HBP", "HS", "HF", "HB"))
    period = fields["U"] * sum(fields[name] for name in ("VFP", "VFPE", "VBP", "VBPE", "VDP", "VS"))
    half_samples = Fraction(horizontal * fields["D"], 2 * fields["LC"])
    assert half_samples == PROFILE["timing"]["samples_per_half_line"] == 432
    assert period == PROFILE["timing"]["half_lines_per_field"] == 625
    assert Fraction(PROFILE["timing"]["dac_hz"], half_samples * period) == 50
    assert fields["CMOD"] != 0 and fields["VFP"] & 1
    assert (fields["VDP"] + fields["VFP"]) * fields["U"] == 577
    assert (fields["VDP"] + fields["VFP"] + fields["VFPE"]) * fields["U"] == 582
    assert 582 + fields["VS"] * fields["U"] == 587
    assert 587 + fields["VBPE"] * fields["U"] == 592
    assert Fraction(fields["HS"] * fields["D"], fields["LC"]) == 64
    assert (
        Fraction(fields["HFP"] * fields["D"], fields["LC"])
        == PROFILE["timing"]["front_porch_samples"]
    )
    assert (
        Fraction(fields["HBP"] * fields["D"], fields["LC"])
        == PROFILE["timing"]["back_porch_samples"]
    )
    assert (
        Fraction((fields["HFP"] + fields["HBP"] + fields["HS"]) * fields["D"], fields["LC"]) == 162
    )
    assert Fraction((fields["HF"] + fields["HB"]) * fields["D"], fields["LC"]) == 702
    return words, fields, horizontal


def check_two_fields(fields, horizontal):
    """540000 ticks; verify bounded recurrence and source-coordinate parity."""
    timing = PROFILE["timing"]
    period = timing["half_lines_per_field"]
    half_samples = timing["samples_per_half_line"]
    samples = 2 * period * half_samples
    modulus = horizontal * fields["D"]
    q0, r0 = divmod(2 * fields["LC"], modulus)
    global_half = phase = 0
    field_origins = []
    source_half_origins = []
    for tick in range(samples):
        assert global_half == tick // half_samples
        assert phase == (tick % half_samples) * 2 * fields["LC"]
        numerator = (global_half & 1) * modulus + phase
        # Physical position and source selection must agree through odd wraps.
        assert numerator // (2 * fields["D"] * fields["StepX"]) == tick % timing["samples_per_line"]
        if phase == 0:
            source_half_origins.append(numerator // (2 * fields["D"]))
            if global_half % period == 0:
                field_origins.append(
                    {
                        "field": global_half // period,
                        "global_half_line": global_half,
                        "horizontal_sample": tick % timing["samples_per_line"],
                        "signal_coordinate": numerator // (2 * fields["D"]),
                    }
                )
        crossed, phase = advance(phase, modulus, q0, r0)
        global_half += crossed
    assert (global_half, phase) == (1250, 0)
    assert field_origins == [
        {"field": 0, "global_half_line": 0, "horizontal_sample": 0, "signal_coordinate": 0},
        {"field": 1, "global_half_line": 625, "horizontal_sample": 432, "signal_coordinate": 1728},
    ]
    assert source_half_origins == [1728 * (half & 1) for half in range(1250)]
    return {
        "sample_ticks_checked": samples,
        "global_half_lines": global_half,
        "field_origins": field_origins,
        "two_field_repetition_samples": samples,
        "wrapped_local_half_line_would_wrongly_reset_source_phase": True,
    }


def check_pulses():
    timing = PROFILE["timing"]
    half_samples = timing["samples_per_half_line"]
    pulses = sync_pulses()
    counts = Counter(kind for _, _, kind in pulses)
    expected_width = {"line": 64, "pre_equalizing": 32, "broad": 368, "post_equalizing": 32}
    for index, (start, end, kind) in enumerate(pulses):
        assert end - start == expected_width[kind]
        assert start % half_samples == 0
        if index:
            assert start > pulses[index - 1][1]
        if kind == "line":
            assert start % timing["samples_per_line"] == 0
        if kind == "broad":
            assert half_samples - (end - start) == timing["broad_gap_samples"]
    assert counts == {"line": 610, "pre_equalizing": 10, "broad": 10, "post_equalizing": 10}
    for field in range(2):
        origin = field * timing["half_lines_per_field"] * half_samples
        for kind, first, width in (
            ("pre_equalizing", 577, 32),
            ("broad", 582, 368),
            ("post_equalizing", 587, 32),
        ):
            actual = [
                (start - origin, end - origin)
                for start, end, pulse_kind in pulses
                if pulse_kind == kind and origin <= start < origin + 625 * half_samples
            ]
            assert actual == [
                (half * half_samples, half * half_samples + width)
                for half in range(first, first + 5)
            ]
    # In field 1, half-line 0 is physically mid-line, so no artificial H pulse.
    assert not any(start == 625 * half_samples for start, _, _ in pulses)
    assert any(start == 626 * half_samples and kind == "line" for start, _, kind in pulses)
    us = {
        kind: str(Fraction(width * 1000000, timing["dac_hz"]))
        for kind, width in expected_width.items()
    }
    # BT.470-6 pulse-duration windows; these do not qualify analog edge shape.
    assert Fraction(45, 10) <= Fraction(64 * 1000000, timing["dac_hz"]) <= Fraction(49, 10)
    assert Fraction(225, 100) <= Fraction(32 * 1000000, timing["dac_hz"]) <= Fraction(245, 100)
    assert Fraction(272, 10) <= Fraction(368 * 1000000, timing["dac_hz"]) <= Fraction(274, 10)
    return {
        "low_intervals_checked": len(pulses),
        "pulse_counts_two_fields": dict(counts),
        "pulse_duration_us_exact": us,
        "broad_high_gap_samples": 64,
        "ordered_nonoverlapping_intervals": True,
        "field_1_origin_has_no_spurious_line_sync": True,
    }


def check_path_alignment():
    """Account from one falling U2 launch, never mix capture/launch edges."""
    analog = json.loads((ROOT / "build/reports/video-circuit.json").read_text())
    period_ns = Fraction(1000000000, PROFILE["timing"]["dac_hz"])
    capture_ns = period_ns / 2
    dac_pipeline_ns = period_ns
    # Manufacturer typical t6 values, not min/max PVT bounds.
    rgb_typical_ns = {
        str(supply): float(capture_ns + dac_pipeline_ns) + t6
        for supply, t6 in ((5, 5.5), (3.3, 7.5))
    }
    sync_model_ns = analog["nominal_ideal_filter_response"]["t50_s"] * 1e9
    sync_sensitivity_ns = [value * 1e9 for value in analog["conditional_response_corners"]["t50_s"]]
    deltas = [sync - rgb for sync in sync_sensitivity_ns for rgb in rgb_typical_ns.values()]
    assert max(abs(delta) for delta in deltas) < float(period_ns)
    return {
        "reference": "Time0: same falling U2 launch for a tagged RGB/control and CSYNC sample.",
        "DAC_capture_ns_exact": str(capture_ns),
        "DAC_one_cycle_pipeline_ns_exact": str(dac_pipeline_ns),
        "RGB_typical_50_percent_ns_from_U2_falling_launch_by_DAC_supply_V": rgb_typical_ns,
        "CSYNC_RC_ideal_filter_50_percent_ns_nominal": sync_model_ns,
        "CSYNC_RC_ideal_filter_50_percent_ns_sensitivity_NOT_PVT_limits": sync_sensitivity_ns,
        "nominal_sync_minus_RGB_ns_by_DAC_supply_V": {
            supply: sync_model_ns - rgb for supply, rgb in rgb_typical_ns.items()
        },
        "sensitivity_delta_ns_excludes_unmodeled_path_delays": [min(deltas), max(deltas)],
        "initial_extra_digital_CSYNC_sample_delay": 0,
        "remaining_terms": "U42 delay, ASIC pad tCO, U40 clock insertion/skew, PCB paths, RGB path analog response, actual DAC t6/PVT and connector/cable loading. The ideal-filter result is not a measured IC edge.",
        "loaded_connector_acceptance_residual_ns": float(period_ns),
        "prototype_acceptance_met": False,
    }


def main():
    words, fields, horizontal = check_words()
    report = {
        "status": PROFILE["status"],
        "decoded_fields": fields,
        "raw_register_words_hex": PROFILE["raw_register_words"],
        "horizontal_total_signal_units": horizontal,
        "phase_and_source_checks": check_two_fields(fields, horizontal),
        "pulse_checks": check_pulses(),
        "line_period_us": 64,
        "half_line_period_us": 32,
        "field_period_us": 20000,
        "frame_period_us": 40000,
        "horizontal_blank_us": 12,
        "horizontal_active_us": 52,
        "front_porch_us_exact": str(
            Fraction(
                PROFILE["timing"]["front_porch_samples"] * 1000000, PROFILE["timing"]["dac_hz"]
            )
        ),
        "dac_pipeline_samples": 1,
        "dac_pipeline_ns_exact": str(Fraction(1000000000, PROFILE["timing"]["dac_hz"])),
        "complete_relative_path_accounting": check_path_alignment(),
        "analog_alignment_measured": False,
        "RTL_implemented": False,
        "source_sha256": {},
    }
    for path in (
        PROFILE_PATH,
        Path(__file__),
        ROOT / "tools/video_timing.py",
        ROOT / "design/video_baseline.json",
        ROOT / "design/video_output.json",
        ROOT / "tools/video_circuit.py",
        ROOT / "build/reports/video-circuit.json",
        ROOT.parent / "docs/book1/pcrtc.md",
        ROOT.parent / "machine/ts/machine/devices/gx/gpu_pcrtc.ts",
        ROOT.parent / "machine/cpp/machine/devices/gx/gpu_pcrtc.cpp",
    ):
        key = os.path.relpath(path, ROOT)
        report["source_sha256"][key] = hashlib.sha256(path.read_bytes()).hexdigest()
    output = ROOT / "build/reports/video-profile.json"
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(
        f"PASS: 540000 physical samples, {report['pulse_checks']['low_intervals_checked']} low intervals; 625/50 RGB+CSYNC proposal, not RTL or TV qualification."
    )
    print(output)


if __name__ == "__main__":
    main()
