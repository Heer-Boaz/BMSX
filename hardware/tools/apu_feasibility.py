"""Project actual mirrored-mixer word traces onto measured physical APU paths.

A finite service-window/capacity analysis, not a replacement decoder, voice
engine, batch-commit controller or timing-qualified ASIC. Cold PLAY, per-epoch
bursts and sustained traffic are reported independently. Optional fixed-ROM
word caches are explicit proposals, never assumed to exist in the source reader.
"""

import csv
import hashlib
import json
import re
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    config_path = ROOT / "design/apu_workloads.json"
    ts_path = ROOT / "build/reports/apu-workloads-ts.json"
    cpp_path = ROOT / "build/reports/apu-workloads-cpp.json"
    memory_path = ROOT / "build/reports/apu-mixed-memory.json"
    publication_path = ROOT / "build/reports/apu-upload-commit.json"
    rom_path = ROOT / "build/reports/apu-rom-integration.txt"
    config, ts, cpp, memory = [
        json.loads(p.read_text()) for p in (config_path, ts_path, cpp_path, memory_path)
    ]
    cases = {s["id"]: s for s in ts["scenarios"]}
    cpp_cases = {s["id"]: s for s in cpp["scenarios"]}
    for name, case in cases.items():
        assert case["checksum32"] == cpp_cases[name]["checksum32"], name
        assert case["ended_mask"] == cpp_cases[name]["ended_mask"], name
    for channels in (1, 2):
        single = cases[f"badp_{channels}ch_b256_44100_1x"]
        sixteen = cases[f"badp_{channels}ch_16_simultaneous"]
        assert len(sixteen["cold"]["word_runs"]) == 16 * len(single["cold"]["word_runs"])
        for a, b, c, d in zip(
            single["frames"],
            sixteen["frames"],
            single["frame_nibbles"],
            sixteen["frame_nibbles"],
            strict=True,
        ):
            assert len(b) == 16 * len(a)
            assert d == 16 * c
    core_hz = json.loads((ROOT / "design/system_bus.json").read_text())["clock_hz"]
    frame_clocks = core_hz // ts["output_hz"]
    assert frame_clocks * ts["output_hz"] == core_hz
    assert memory["frame_clocks"] == frame_clocks
    read_clocks = max(c["last_read_only_accept_interval"] for c in memory["cases"])
    write_clocks = max(c["max_write_latency"] for c in memory["cases"]) + 1
    match = re.search(
        r"source_reader64words systemROM_clocks=(\d+) cartridgeROM_clocks=(\d+)",
        rom_path.read_text(),
    )
    system_clocks, cart_clocks = (int(n) // 64 for n in match.groups())
    assert all(int(n) % 64 == 0 for n in match.groups())
    word_costs = {"ram": read_clocks, "system": system_clocks, "cart": cart_clocks}
    for case in memory["cases"]:
        if case["upload_release_period_clocks"] == 0 or case["uploads_per_frame"] == 0:
            assert case["max_elapsed_clocks"] == (
                case["reads_per_frame"] * read_clocks + case["uploads_per_frame"] * write_clocks
            )
    results = []

    for load in config["loads"]:
        assert load["generators"] + sum(g["count"] for g in load["groups"]) == load["active_voices"]
        for alignment in ("synchronous", "spread"):
            for cache_words in config["fixed_rom_cache_words_per_voice"]:
                for core_extra in config["CORE_clocks_per_ROM_word_sensitivity"]:
                    voices = []
                    resident_bytes = 0
                    shared = set()
                    cold = {"ram": 0, "system": 0, "cart": 0}
                    cold_nibbles = 0
                    for group in load["groups"]:
                        case = cases[group["case"]]
                        assert case["voices"] == 1
                        assert case["mutate_frame"] == -1
                        if group["storage"] == "ram":
                            identity = group["case"]
                            if not group["shared_source"] or identity not in shared:
                                resident_bytes += case["storage_bytes"] * (
                                    1 if group["shared_source"] else group["count"]
                                )
                                shared.add(identity)
                        for _ in range(group["count"]):
                            capacity = cache_words if group["storage"] != "ram" else 0
                            cache = OrderedDict()

                            def count_reads(words):
                                if capacity == 0:
                                    return len(words)
                                misses = 0
                                for word in words:
                                    if word in cache:
                                        cache.move_to_end(word)
                                    else:
                                        misses += 1
                                        if len(cache) == capacity:
                                            cache.popitem(last=False)
                                        cache[word] = None
                                return misses

                            cold[group["storage"]] += count_reads(case["cold"]["word_runs"])
                            cold_nibbles += case["cold"]["nibbles"]
                            phase = 0 if alignment == "synchronous" else len(voices) * 17 % 256
                            counts = [count_reads(words) for words in case["frames"]]
                            voices.append((case, group["storage"], phase, counts))
                    frames = ts["output_frames"] - max((v[2] for v in voices), default=0)
                    rom_cycles = []
                    nibble_counts = []
                    word_counts = {name: [] for name in word_costs}
                    for frame in range(frames):
                        counts = {name: 0 for name in word_costs}
                        nibbles = 0
                        for case, storage, phase, trace in voices:
                            counts[storage] += trace[frame + phase]
                            nibbles += case["frame_nibbles"][frame + phase]
                        # Continuous full16-word transfer batches have16/32
                        # committed words in alternating768-clock windows.
                        # These are physical writeback workload windows only;
                        # a future commit/forwarding owner must publish atomically.
                        rom_cycles.append(
                            sum(
                                counts[s] * (word_costs[s] + core_extra) for s in ("system", "cart")
                            )
                        )
                        nibble_counts.append(nibbles)
                        for name in counts:
                            word_counts[name].append(counts[name])
                    # Both relative batch/audio phases are considered. The
                    # per-epoch adverse burst is32writes; meanpressure remains
                    # the correct24writes, not32in every epoch.
                    adverse_ram = [
                        n * read_clocks + (32 * write_clocks if load["uploads"] else 0)
                        for n in word_counts["ram"]
                    ]
                    max_ram, max_rom = max(adverse_ram), max(rom_cycles)
                    missed = sum(
                        r > frame_clocks or s > frame_clocks
                        for r, s in zip(adverse_ram, rom_cycles, strict=True)
                    )
                    mean_ram = sum(word_counts["ram"]) * read_clocks / frames + (
                        24 * write_clocks if load["uploads"] else 0
                    )
                    mean_rom = sum(rom_cycles) / frames
                    steady_ram, steady_rom = adverse_ram[1:], rom_cycles[1:]
                    steady_missed = sum(
                        r > frame_clocks or s > frame_clocks
                        for r, s in zip(steady_ram, steady_rom, strict=True)
                    )
                    steady_mean_ram = sum(word_counts["ram"][1:]) * read_clocks / (frames - 1) + (
                        24 * write_clocks if load["uploads"] else 0
                    )
                    steady_mean_rom = sum(steady_rom) / (frames - 1)
                    status = "warm_memory_windows_fit"
                    if steady_mean_ram > frame_clocks or steady_mean_rom > frame_clocks:
                        status = "sustained_memory_overload"
                    elif steady_missed:
                        status = "warm_burst_windows_not_closed"
                    if resident_bytes > config["sample_RAM_bytes"]:
                        status = "resident_fixture_does_not_fit"
                    results.append(
                        {
                            "load": load["id"],
                            "active_voices": load["active_voices"],
                            "alignment": alignment,
                            "fixed_ROM_cache_words_per_voice_PROPOSAL": cache_words,
                            "CORE_extra_clocks_per_ROM_word_ASSUMPTION": core_extra,
                            "frames": frames,
                            "local_fixture_bytes": resident_bytes,
                            "status": status,
                            "memory_windows_missing_768_clock_budget": missed,
                            "steady_memory_windows_missing_budget": steady_missed,
                            "steady_local_max_clocks": max(steady_ram),
                            "steady_ROM_max_clocks": max(steady_rom),
                            "steady_local_mean_clocks": steady_mean_ram,
                            "steady_ROM_mean_clocks": steady_mean_rom,
                            "first_output_local_clocks": adverse_ram[0],
                            "first_output_ROM_clocks": rom_cycles[0],
                            "local_max_clocks": max_ram,
                            "local_mean_clocks": mean_ram,
                            "ROM_max_clocks": max_rom,
                            "ROM_mean_clocks": mean_rom,
                            "combined_memory_mean_clocks_if_NOT_overlapped": mean_ram + mean_rom,
                            "minimum_independent_resource_margin_clocks": frame_clocks
                            - max(max_ram, max_rom),
                            "raw_words_mean": {k: sum(v) / frames for k, v in word_counts.items()},
                            "raw_words_peak": {k: max(v) for k, v in word_counts.items()},
                            "decode_nibbles_peak": max(nibble_counts),
                            "decode_nibbles_mean": sum(nibble_counts) / frames,
                            "all_filters_enabled_products_per_frame": 14 * len(voices)
                            + 12 * load["generators"],
                            "cold_PLAY_raw_words": cold,
                            "cold_PLAY_memory_clocks_SERIAL": sum(
                                cold[s] * word_costs[s] for s in cold
                            ),
                            "cold_PLAY_decode_nibbles": cold_nibbles,
                            "fixed_ROM_data_cache_bytes_PROPOSAL": cache_words
                            * 4
                            * sum(v[1] != "ram" for v in voices),
                        }
                    )
    # ROM-prefetch sizing is a deliberately conditional design alternative.
    # The actual eight-voice trace below proves only the cacheless, no-prefetch
    # reference workload. The budget treats the existing measured reader as a
    # fixed per-word service cost; it is not a bound on READY, arbitration or
    # changes to a card's visible ROM bytes.
    rom_load = next(
        row
        for row in results
        if row["load"] == "8_stereoBADP44_CART"
        and row["alignment"] == "synchronous"
        and row["fixed_ROM_cache_words_per_voice_PROPOSAL"] == 0
        and row["CORE_extra_clocks_per_ROM_word_ASSUMPTION"] == 0
    )
    block_frames = 256
    block_bytes = 4 + 2 * 4 + block_frames
    unaligned_words = (block_bytes + 3 + 3) // 4
    voices = 8
    buffered_words = voices * 2 * unaligned_words
    refill_words = voices * unaligned_words
    allocation_clocks = word_costs["cart"] + 9
    block_period_clocks = block_frames * frame_clocks
    variable_upload_words = json.loads(publication_path.read_text())["variable_batch_words_in_768_clock_window"]
    lane_comparison = []
    for load_id in ("8_stereoBADP44_RAM", "16_monoBADP44_RAM"):
        workload = next(
            row
            for row in results
            if row["load"] == load_id
            and row["alignment"] == "synchronous"
            and row["fixed_ROM_cache_words_per_voice_PROPOSAL"] == 0
            and row["CORE_extra_clocks_per_ROM_word_ASSUMPTION"] == 0
        )
        source_reads = workload["raw_words_peak"]["ram"]
        memory_cost = source_reads * read_clocks + variable_upload_words * write_clocks
        # The existing 14 products/voice include stereo interpolation, biquad
        # and master gain. Add the two proposed per-channel level products;
        # retaining both filter histories is necessary after live source changes.
        products = workload["all_filters_enabled_products_per_frame"] + 2 * workload["active_voices"]
        issue_cost = ((products + 3) // 4) * 2
        source_clocks = source_reads * read_clocks
        per_slot_products = products // workload["active_voices"]
        per_slot_issue = ((per_slot_products + 3) // 4) * 2
        # Optimistic issue calendar: one voice's source words arrive as a
        # contiguous group, the four lanes issue its products immediately,
        # and all upload writebacks drain after the reads. A slot has 21/28
        # input clocks against 8 issue clocks here. No execution latency,
        # inter-stage dependency, availability or admission delay is assumed.
        assert source_reads % workload["active_voices"] == 0
        assert source_clocks // workload["active_voices"] >= per_slot_issue
        optimistic_parallel_completion = max(memory_cost, source_clocks + per_slot_issue)
        lane_comparison.append({
            "load": load_id,
            "source_reads_trace_peak": source_reads,
            "adverse_variable_upload_words": variable_upload_words,
            "independent_memory_screen_clocks": memory_cost,
            "all_filters_and_proposed_channel_gain_products": products,
            "hypothetical_four_lanes_ii2_issue_clocks": issue_cost,
            "serial_budget_if_no_overlap": memory_cost + issue_cost,
            "optimistic_grouped_input_and_issue_completion_clocks": optimistic_parallel_completion,
        })
    report = {
        "scope": config["scope"],
        "measured_costs": {
            "system_hz": core_hz,
            "output_hz": ts["output_hz"],
            "frame_clocks": frame_clocks,
            "read_word_clocks": read_clocks,
            "write_word_clocks": write_clocks,
            "ROM_word_clocks": {k: v for k, v in word_costs.items() if k != "ram"},
        },
        "actual_mirrored_mixer_cases_equal": len(cases),
        "mono_stereo_equal_source_channels_comparison": {
            "scope": "Eight stereo and sixteen mono local BADP slots, both 44.1 kHz unity rate, 256-frame source blocks, synchronous phases. These are individual measured traces and arithmetic capacity screens, not a proof for all mixed configurations or a realized APU.",
            "sample_channels_each": 16,
            "comparisons": lane_comparison,
            "qualification": [
                "The 39-write case is an adverse admitted-batch window from the physical publication test; the figures screen its coincidence with source peaks rather than proving an executed full APU calendar.",
                "The four-lane two-clock initiation interval is a hypothetical multiplier organization. Fill, dependencies, decode, work control and I2S handoff are not assigned zero cost.",
                "Independent memory and arithmetic can overlap. A serial sum above 768 does not prove the workload impossible, while a sum below 768 does not prove it meets the deadline.",
                "The optimistic overlap calendar assumes the existing single-port 7/9-clock service, contiguous source reads per slot, instantly issuable independent products and immediately drainable writes; it counts issue, not latency or stage dependencies. It is not a scheduled or measured completion, nor a lower bound for every possible memory architecture.",
                "Mono sources do not always permit collapsing two filter histories: live replacement can leave distinct left and right state. Different active-slot counts, phase relations, mono/stereo mixtures, loops and cold starts need separate qualification.",
            ],
        },
        "conditional_rom_block_prefetch_candidate": {
            "scope": "Sizing candidate, not implemented hardware, ROM-stability contract, READY bound, or complete audio-frame guarantee.",
            "reference": "Eight independent stereo BADP sources, 256-frame blocks, forward unity-rate and synchronous block boundaries; fixed source bytes and no earlier prefetched block for the cacheless trace.",
            "cacheless_warm_peak_words": rom_load["raw_words_peak"]["cart"],
            "cacheless_warm_peak_clocks": rom_load["steady_ROM_max_clocks"],
            "cacheless_warm_windows_over_period": rom_load["steady_memory_windows_missing_budget"],
            "reference_cold_play_service_clocks": rom_load["cold_PLAY_memory_clocks_SERIAL"],
            "frame_period_clocks": frame_clocks,
            "block_frames": block_frames,
            "stereo_block_bytes_including_header": block_bytes,
            "maximum_aligned_words_for_any_byte_alignment": unaligned_words,
            "slots": voices,
            "raw_buffers_per_slot": 2,
            "raw_buffer_bytes_excluding_tags": buffered_words * 4,
            "refill_words_eight_slots": refill_words,
            "block_period_clocks": block_period_clocks,
            "reference_read_clocks_per_word": word_costs["cart"],
            "refill_clocks_using_reference_reader": refill_words * word_costs["cart"],
            "refill_clocks_with_assumed_9_core_clocks_per_word": refill_words * allocation_clocks,
            "mean_reference_refill_clocks_per_output": refill_words * word_costs["cart"] / block_frames,
            "full_initial_prefill_clocks": refill_words * word_costs["cart"],
            "qualification": [
                "Only stable ROM content may be prefetched without changing live source reads; Book III does not explicitly prohibit every MMIO-controlled remapping of a physical card. System flash is likewise conditional on no programming during playback.",
                "Buffers are additional internal raw storage and do not consume or reduce the public 512 KiB sample RAM. Tags, ownership, invalidation, unaligned tails and access routing are additional hardware.",
                "The reference word time is measured for one reader/card, not a certified worst case. The extra 9 clocks are a workload assumption, not an arbitration or READY guarantee.",
                "A subsequent block must be completely available before its deadline; a bus grant and bounded READY across the whole refill interval must be established. Other external voices, core traffic and long packets consume the same resource.",
                "The full initial prefill is one proposed preparation strategy, not the minimum necessary PLAY delay. No preparation time, miss behavior, start scheduling or public restrictions have been selected.",
                "Fixed 256-frame blocks and forward unity playback are just this workload. Reverse, variable frame rates, loops, live source changes, mutable sample RAM and format edge cases need their own scheduling and ordering analysis.",
                "Arithmetic, snapshot epochs, transfer publication, decoder context, filter/gain, I2S handoff and physical cell timing remain outside this calculation.",
            ],
        },
        "single_to_actual_16_voice_trace_composition_equal": ["BADP_mono256", "BADP_stereo256"],
        "word_cost_formula_checked_against_real_pin_cases": True,
        "assumptions": config["assumptions"],
        "unclosed": config["unclosed"],
        "results": results,
        "input_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (
                config_path,
                ts_path,
                cpp_path,
                memory_path,
                publication_path,
                rom_path,
                ROOT / "design/system_bus.json",
                Path(__file__),
            )
        },
    }
    target = ROOT / "build/reports/apu-feasibility.json"
    target.write_text(json.dumps(report, indent=2) + "\n")
    csv_target = ROOT / "build/exports/APU_workload_matrix.csv"
    csv_target.parent.mkdir(parents=True, exist_ok=True)
    fields = [k for k, v in results[0].items() if not isinstance(v, dict)]
    with csv_target.open("w", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(results)
    print(
        json.dumps(
            {
                "mirrored_cases": len(cases),
                "load_models": len(config["loads"]),
                "resource_cases": len(results),
                "read_clocks": read_clocks,
                "write_clocks": write_clocks,
            }
        )
    )


if __name__ == "__main__":
    main()
