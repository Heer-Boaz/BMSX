"""Summarize physical BADP execution, publication and qualification evidence.

The unchanged TS/C++ decoders supply samples and exact state. RTL supplies
execution time and SRAM waveforms. A failed deadline remains a failed deadline;
this report neither changes a public limit nor assigns command startup grace.
"""

import csv
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def system_budget(execution, publication):
    """Closed-form sizing of the proposed service lanes, not an RTL schedule."""
    voices = 8
    channels = 2
    frame_clocks = execution["frame_clocks"]
    clock_hz = execution["clock_hz"]
    product_breakdown = {"interpolation": channels, "biquad": channels * 5, "gain": channels}
    products = voices * sum(product_breakdown.values())
    candidate_issue_interval = 2
    transfer_word_clocks = 32
    batch_words = 16
    # An already-running batch contributes at most16 words at the left edge.
    # Later serialized deadlines inside [T,T+768) contribute at most23 more.
    burst_words = batch_words + (frame_clocks - 1) // transfer_word_clocks
    assert burst_words == publication["variable_batch_words_in_768_clock_window"]
    reads = voices * 4
    raw_memory_clocks = reads * 7 + burst_words * 9
    issue_clocks = products * candidate_issue_interval

    # Candidate for a historically conventional time-multiplexed mixer:
    # eight stereo logical slots, each consuming two mono decode paths.  The
    # extra gain products are for the proposed independent L/R levels, not the
    # existing master-gain-only interface. Four multipliers with II=2 consume
    # 64 issue clocks in the conservative all-distinct case. This arithmetic
    # is only a capacity screen; dependency stalls and control still matter.
    candidate_products = voices * (channels + channels * 5 + channels * 2)
    candidate_lanes = 4
    candidate_ii = 2
    candidate_issue_clocks = (
        (candidate_products + candidate_lanes - 1) // candidate_lanes
    ) * candidate_ii
    candidate_unassigned = frame_clocks - raw_memory_clocks - candidate_issue_clocks
    assert candidate_products == 128
    assert raw_memory_clocks == 575 and candidate_issue_clocks == 64
    assert candidate_unassigned == 129

    signed16 = (-(1 << 15), (1 << 15) - 1)
    signed32 = (-(1 << 31), (1 << 31) - 1)
    coefficient_products = [x * c for x in signed16 for c in signed16]
    y_min = (min(coefficient_products) + signed32[0]) >> 14
    y_max = (max(coefficient_products) + signed32[1]) >> 14
    assert -(1 << 18) <= y_min <= y_max < (1 << 18)
    gain_products = [x * g for x in signed16 for g in signed32]
    assert 16 * max(abs(v) for v in gain_products) < (1 << 63)
    # Gain normalization is after the complete sum, never per voice.
    assert ((-32768 * -4096) + (-32768 * 4096)) >> 12 == 0

    large_frames = 60000
    stereo_header_bytes = 4 + channels * 4
    block_bytes = stereo_header_bytes + large_frames
    chosen_prefix_bytes = 64 + 8  # A chosen layout, not a required source header size.
    source_bytes = chosen_prefix_bytes + block_bytes
    assert large_frames < (1 << 16) and block_bytes < (1 << 16)
    assert voices * source_bytes <= 512 * 1024
    # Third reverse-unity output after starting at59999: n59997, neighbor59998.
    prefix_bytes = large_frames - 1
    halfword_reads = voices * ((prefix_bytes + 1) >> 1)
    read_cycle_ns = 10  # Fitted BLL -10 data-sheet tRC, not a proposed ASIC clock.
    raw_reverse_ns = halfword_reads * read_cycle_ns
    assert raw_reverse_ns * clock_hz > frame_clocks * 1_000_000_000
    # Repeat the large-block reverse screen with mono sources. Frame 59997
    # requires 59998 nibble steps from this block's starting predictor. Read
    # bytes are rounded to x16 accesses using the same best-case tRC as above.
    # This is a no-retained-prefix-memory organization, not a bound on a
    # parallel decoder, a raw-payload cache, or precomputed decoder states.
    mono_voices = 16
    mono_block_bytes = 4 + 4 + ((large_frames + 1) >> 1)
    mono_source_bytes = chosen_prefix_bytes + mono_block_bytes
    mono_prefix_nibbles = large_frames - 2
    mono_prefix_bytes = (mono_prefix_nibbles + 1) >> 1
    mono_halfword_reads_per_voice = (mono_prefix_bytes + 1) >> 1
    mono_reads_8 = 8 * mono_halfword_reads_per_voice
    mono_reads_16 = mono_voices * mono_halfword_reads_per_voice
    assert mono_block_bytes < (1 << 16)
    assert mono_voices * mono_source_bytes <= 512 * 1024
    assert mono_halfword_reads_per_voice * read_cycle_ns * clock_hz > frame_clocks * 1_000_000_000
    return {
        "scope": "Closed-form service sanity checks for the public master-gain contract and a separately labelled proposed channel-level candidate; not measured MAC timing or a qualified whole-APU calendar.",
        "selected_next_hardware_boundary": "Preemptible shared source-job service: retain private preparation progress and yield after bounded completed-word/frame work. No foreground deadline guarantee follows from priority labels on an uninterruptible long seek.",
        "roles": [
            "frame scheduler",
            "source/decode service",
            "shared arithmetic",
            "command preparation",
            "single memory publication/arbitration owner",
        ],
        "native_slots_unchanged": 16,
        "concurrent_stereo_sizing_target": voices,
        "output_period_ns_ratio": [frame_clocks * 1_000_000_000, clock_hz],
        "arithmetic": {
            "products_per_stereo_voice": product_breakdown,
            "products_all_eight_per_output": products,
            "candidate_multiplier_signed_bits": [17, 32],
            "candidate_product_initiation_interval_clocks": candidate_issue_interval,
            "issue_slot_demand_clocks": issue_clocks,
            "issue_demand_percent": 100 * issue_clocks / frame_clocks,
            "unsaturated_filter_y_range": [y_min, y_max],
            "mix_accumulator_bits": 64,
            "gain_normalization_after_all_voices": True,
            "qualification": "Fill/drain, dependent feedback products, phase/fade and state writeback are not assigned zero cost or certified by this issue budget.",
        },
        "memory_screen": {
            "scope": "Raw existing-store service: prepared forward playback, <=1 new source frame/voice/output, stable positive blocks, any byte alignment and serialized admitted DMA batches. Extra decoder/control costs and manual CPU writes are excluded.",
            "source_read_words": reads,
            "read_word_clocks": 7,
            "average_full_rate_write_words": frame_clocks // transfer_word_clocks,
            "half_open_admitted_batch_burst_words": burst_words,
            "write_word_clocks": 9,
            "raw_read_plus_burst_write_clocks": raw_memory_clocks,
            "serial_upper_budget_with_arithmetic_issue_slots": raw_memory_clocks + issue_clocks,
            "qualification": "The serial envelope does not certify768 clocks; summing upper bounds does not prove a simultaneously attained lower bound. Overlap is a selected architecture requirement, not an inferred performance guarantee. FIFO refill/SYS admission and inherited writeback backlog remain separate.",
        },
        "bounded_eight_stereo_design_candidate": {
            "scope": "Product-level design target and capacity screen, not a committed restriction, implemented scheduler, measured latency, or real-time guarantee.",
            "compatible_voice_model": "One logical stereo slot supplies two independent mono sample/decode paths; mono uses one path with independent left and right gains. The existing sixteen logical slots are retained.",
            "candidate_workload": [
                "At most eight active stereo BADP slots in local 512 KiB sample RAM; other slots inactive. Equivalent mono or mixed capacities need separate bounds.",
                "Established forward playback at exactly one source frame per output frame, integer phase; no live source, rate, loop, filter or seek modifications during the guaranteed interval.",
                "Well-formed fixed 32-frame stereo BADP blocks, 44 bytes including the 12-byte block header; no padding or seek entries. Sources begin at frame zero and each valid loop start/end is a 32-frame boundary within the source.",
                "DMA uploads target disjoint inactive sample ranges and obey the admitted batch rules; at most39 already-relevant or newly due physical writebacks are charged in the period. CPU sample writes and earlier queued writeback debt are not covered.",
                "PLAY/source preparation, simultaneous initial command admission, arbitrary seek, reverse, fractional speed, nonaligned loops, and mutable active source banks are not established by this workload.",
            ],
            "loop_mechanism_candidate": "During preparation retain each fixed-block loop-start byte address; at a wrap load that block's predictor/header directly rather than scan or decode a prefix. Exact current/previous sample and endstate equivalence to Book I still requires a real implementation and conformance tests.",
            "period_scheduler_candidate": [
                "At the output edge capture the source snapshot and slot epoch. Use independent cursor/source contexts to keep the one external SRAM port busy; service reads for the due sample ahead of background preparation.",
                "Retire the RAM snapshot only after the final source response needed by that epoch has been retained. When the remaining work no longer reads that snapshot, let the same SRAM owner drain disjoint committed upload words while arithmetic proceeds.",
                "Run four shared signed16-by-signed34 multiplier lanes, retaining exact interpolation, biquad feedback, master gain and proposed channel-gain dependencies; sum in slot order and retain the completed pair for the next physical I2S frame latch.",
                "Keep bounded preparation preemptible at safe memory/decoder boundaries. A later command cannot overtake an earlier FIFO command or silently replace its old voice. Preparation/activation semantics and program-visible completion must be specified before a fixed cold-start claim.",
            ],
            "read_words_per_eight_voice_epoch_hypothesis": reads,
            "read_word_clocks": 7,
            "admitted_dma_writeback_words_bound": burst_words,
            "write_word_clocks": 9,
            "raw_memory_clocks": raw_memory_clocks,
            "products_per_stereo_voice": {
                "interpolation": channels,
                "biquad": channels * 5,
                "proposed_channel_levels_and_sample_gain": channels * 2,
            },
            "products_all_eight": candidate_products,
            "proposed_multiplier_lanes": candidate_lanes,
            "assumed_issue_interval_per_lane_clocks": candidate_ii,
            "arithmetic_issue_slots_clocks": candidate_issue_clocks,
            "serial_screen_unassigned_clocks": candidate_unassigned,
            "qualification": "The loop-inclusive 32-word figure is a working hypothesis. A directed TS-owner probe covers four alignments, four blocks, all block-aligned loop intervals and two traversals, with one payload pattern; it is not a proof for all source values and lengths or an RTL memory schedule. 575 + 64 leaves129 clocks only if that figure holds, every memory request is available without uncovered bubbles, and the four lanes reach the assumed issue rate. The 129 clocks must cover snapshot/descriptor setup, decode, dependency stalls, command and event ordering, pipeline fill/drain and DAC handoff; overlap may change this calendar. None of those costs is proven zero or currently closed. Physical SRAM/ASIC timing, state and coherent preemption remain open.",
        },
        "controller_vs_component": {
            "example_payload_bytes": 2048,
            "one_x16_read_per_SYS_clocks": 1024,
            "fitted_SRAM_read_cycle_min_ns": read_cycle_ns,
            "ideal_component_payload_read_ns": (2048 // 2) * read_cycle_ns,
            "ideal_component_read_fits_one_output_interval": (2048 // 2) * read_cycle_ns * clock_hz
            <= frame_clocks * 1_000_000_000,
            "qualification": "A faster/multiphase controller is not implemented or timing-qualified. The old1024-SYS-clock example is not an absolute x16-chip bandwidth impossibility.",
        },
        "large_block_reverse_witness": {
            "scope": "Valid dimensions for eight distinct sources; serial prefix recovery without an additional decoded-state mirror. This is a format/capacity and optimistic pin-bandwidth witness, not an executed60000-frame RTL case or a proof against every possible cache architecture.",
            "frames_per_stereo_block": large_frames,
            "block_bytes": block_bytes,
            "chosen_metadata_and_seek_prefix_bytes": chosen_prefix_bytes,
            "source_bytes_each": source_bytes,
            "total_source_bytes": voices * source_bytes,
            "third_reverse_output_current_frame": large_frames - 3,
            "third_reverse_output_neighbor_frame": large_frames - 2,
            "prefix_bytes_per_voice": prefix_bytes,
            "optimistic_total_x16_reads": halfword_reads,
            "optimistic_payload_read_ns": raw_reverse_ns,
            "includes_decode_headers_or_writes": False,
        },
        "large_mono_block_reverse_witness": {
            "scope": "One, eight or sixteen distinct valid mono sources in local sample RAM; recovery from the block predictor with no retained decoded states or raw payload prefix. Format/capacity and optimistic serial SRAM pin screen, not an executed 60000-frame RTL test or a bound on every possible architecture.",
            "frames_per_mono_block": large_frames,
            "block_bytes": mono_block_bytes,
            "chosen_metadata_and_seek_prefix_bytes": chosen_prefix_bytes,
            "source_bytes_each": mono_source_bytes,
            "source_bytes_for_eight": 8 * mono_source_bytes,
            "source_bytes_for_sixteen": mono_voices * mono_source_bytes,
            "third_reverse_output_current_frame": large_frames - 3,
            "nibbles_needed_per_voice_from_block_start": mono_prefix_nibbles,
            "payload_bytes_per_voice": mono_prefix_bytes,
            "optimistic_x16_reads_for_one": mono_halfword_reads_per_voice,
            "optimistic_x16_reads_for_eight": mono_reads_8,
            "optimistic_x16_reads_for_sixteen": mono_reads_16,
            "optimistic_payload_read_ns_for_one": mono_halfword_reads_per_voice * read_cycle_ns,
            "optimistic_payload_read_ns_for_eight": mono_reads_8 * read_cycle_ns,
            "optimistic_payload_read_ns_for_sixteen": mono_reads_16 * read_cycle_ns,
            "includes_decode_headers_or_writes": False,
        },
        "contract_boundaries": [
            "Manual CPU sample writes publish on write acceptance, not a32*N batch deadline. Their admission and writeback load must be included separately; the39-word bound is not a cap on every possible upload path.",
            "Queued PLAY has no documented one-frame execution deadline. Preparation cannot silently change execution-time binding selection, old-voice survival or command order.",
            "Live START/source writes affect subsequent samples after their access. Pre-acceptance waiting is a candidate; ACK followed by deferred source effects is not equivalent. Producer timeout policy and acceptance-cycle definition remain open.",
            "Windowed/extra prepared decoder state must preserve current/previous retention and loaded-prefix visibility across source writes; a future-PCM cache is not automatically equivalent.",
            "No rate clamp, fixed block-size rule, new startup allowance or slot reduction is applied. A qualified workload envelope or additional prepared-state resource must precede any unconditional eight-stereo claim.",
        ],
        "references": [
            "../docs/book1/apu.md#sec-apu-stage-capture-execute",
            "../docs/book1/apu.md#sec-apu-live-slot-parameters",
            "https://github.com/MiSTer-devel/PSX_MiSTer/blob/cd17b5a0ad261005c321d9d5ba41b8dbe313a7d3/rtl/spu.vhd",
            "https://github.com/MiSTer-devel/SNES_MiSTer/blob/bdcd33c5cab652109eeb7c695910b77b6f21df2f/rtl/DSP.vhd",
            "https://www.issi.com/WW/pdf/61-64WV25616.pdf",
        ],
    }


def main():
    names = (
        "apu-badp-step",
        "apu-badp-vectors-cpp",
        "badp-decoder",
        "badp-decoder-coincident",
        "badp-decoder-upper-slots",
        "apu-upload-commit",
        "apu-badp-upload",
        "apu-synthesis",
    )
    paths = [ROOT / "build/reports" / f"{name}.json" for name in names]
    step, cpp, normal, coincident, upper, upload, integrated, synthesis = [
        json.loads(path.read_text()) for path in paths
    ]
    cpp_cases = {row["id"]: row for row in cpp["scenarios"]}
    rows = []
    assert normal["physical_slot_base"] == 0
    assert upper["physical_slot_base"] == 8
    assert coincident["coincident_invalidation_mode"] == 1
    for variant in (normal, coincident, upper):
        assert variant["total_state_checks"] == cpp["state_checks"]
        assert variant["total_operand_checks"] == cpp["operand_checks"]
        assert {row["id"] for row in variant["scenarios"]} == set(cpp_cases)
        for row in variant["scenarios"]:
            reference = cpp_cases[row["id"]]
            assert row["raw_state_checks"] == reference["state_checks"]
            assert row["operand_checks"] == reference["operand_checks"]
    for row in normal["scenarios"]:
        assert row["voices"] == 8
        assert row["output_deadline_misses"] == sum(
            window["deadline_missed"] for window in row["output_epochs"]
        )
        rows.append(
            {
                "scenario": row["id"],
                "request_only_regression": row["id"]
                in (
                    "eight_structural_block_count_commit",
                    "eight_loop_beyond_declared_frame_count",
                ),
                "stereo_voices": row["voices"],
                "resident_source_image_bytes": row["source_image_bytes"],
                "cold_reset_clocks": row["cold_reset_clocks"],
                "cold_max_single_voice_clocks": row["cold_max_single_voice_clocks"],
                "first_output_clocks": row["first_output_clocks"],
                "cold_plus_first_output_clocks": row["cold_plus_first_output_clocks"],
                "output_epochs": row["output_epoch_count"],
                "peak_output_clocks": row["maximum_output_clocks"],
                "peak_output_epoch": row["maximum_output_epoch"],
                "output_deadline_misses": row["output_deadline_misses"],
                "checkpoint_hits": row["checkpoint_hits"],
                "physical_source_reads": row["physical_source_reads"],
                "physical_writes": row["physical_writes"],
                "raw_state_checks_each_variant": row["raw_state_checks"],
                "operand_checks_each_variant": row["operand_checks"],
            }
        )
    assert upload["variable_batch_words_in_768_clock_window"] == 39
    assert upload["preedge_publication_equals_registered_completion"]
    for module in synthesis["modules"].values():
        assert module["check_problems"] == 0
        assert module["inferred_latch_cells"] == 0
        for name, digest in module["input_sha256"].items():
            assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest
    cold_case = next(row for row in normal["scenarios"] if row["id"] == "eight_cold_late4095")
    prefixes = [
        (reset["payload_byte_address"], (reset["payload_nibbles_decoded"] + 1) >> 1)
        for reset in cold_case["reset_requests"]
        if reset["epoch"] == -1
    ]
    assert len(prefixes) == 8
    prefixes.sort()
    assert all(a + n <= b for (a, n), (b, _) in zip(prefixes, prefixes[1:]))
    payload_bytes = sum(size for _, size in prefixes)
    ideal_x16_clocks = sum((size + 1) >> 1 for _, size in prefixes)
    assert ideal_x16_clocks > normal["frame_clocks"]
    report = {
        "scope": "Physical local-RAM BADP decoder and upload-publication qualification; not a complete APU or silicon timing certificate.",
        "clock_hz": normal["clock_hz"],
        "frame_clocks": normal["frame_clocks"],
        "native_slot_contexts": 16,
        "simultaneous_stereo_voices_tested": 8,
        "unconditional_eight_stereo_guarantee": False,
        "specifications_or_runtime_changed": False,
        "coverage": {
            "actual_ts_cpp_stateful_scenarios": cpp["scenario_count"],
            "actual_mixer_playback_schedules": cpp["scenario_count"] - 2,
            "request_only_boundary_regressions": 2,
            "state_checks_per_variant": cpp["state_checks"],
            "operand_checks_per_variant": cpp["operand_checks"],
            "physical_variants": [
                "serialized",
                "publication_on_request_admission",
                "slots_8_through_15",
            ],
            "output_epochs_per_variant": normal["total_output_epochs"],
            "all_first_output_epochs_retained": True,
            "cold_play_resets_per_variant": normal["total_cold_requests"],
            "all_reset_requests_including_live_seeks": cpp["reset_requests"],
            "arithmetic_golden_stereo_cases": step["golden_cases"],
            "arithmetic_predictor_seeds_per_index_code": step["predictor_seeds_per_index_code"],
            "raw_step_index_bits": step["raw_header_index_bits_preserved"],
            "undefined_step_indices_qualified": step[
                "undefined_header_indices_89_through_255_qualified"
            ],
        },
        "execution_results": rows,
        "system_organization_budget": system_budget(normal, upload),
        "unprepared_cold_payload_lower_bound": {
            "scenario": cold_case["id"],
            "distinct_stereo_sources": len(prefixes),
            "payload_bytes_required": payload_bytes,
            "ideal_x16_payload_read_clocks": ideal_x16_clocks,
            "available_output_frame_clocks": normal["frame_clocks"],
            "includes_headers_seek_reads_or_arithmetic": False,
            "scope": "Controller-specific screen: a fresh uncached binding at one x16 read per SYS clock needs more than one output interval. It is not the -10 SRAM's absolute bandwidth limit and does not impose a one-frame PLAY deadline or assign an allowed launch delay.",
        },
        "publication_and_snapshot": upload,
        "simultaneous_decoder_upload_execution": integrated,
        "generic_synthesis": {
            "tool": synthesis["tool"],
            "modules": {
                name: {
                    "retained_q_bits": module["retained_q_bits"],
                    "inferred_memory_bits": module["inferred_memory_bits"],
                    "inferred_memories": module["inferred_memories"],
                    "inferred_latch_cells": module["inferred_latch_cells"],
                    "check_problems": module["check_problems"],
                }
                for name, module in synthesis["modules"].items()
            },
            "scope": "Generic native synthesis only; no fabrication library, STA, process-corner area/power or clock/pad closure.",
        },
        "qualification_boundaries": [
            "Loop-start/end checkpoints are source-version-dependent microarchitectural state. Architectural current/previous samples, loaded predictors and block progress retain their existing write visibility.",
            "A write overlapping a bound source invalidates extra checkpoints, not the two retained decoded samples. A rewritten frame/block layout stays noncanonical until a real seek reestablishes its mapping.",
            "A render uses one committed-memory epoch; later upload batches cannot leak into its later physical word reads. A due batch is included before the coincident render opens.",
            "Thirty-two writebacks was the earlier repeated-full-16-word-batch capacity screen, not an all-pattern arrival guarantee. Variable admitted batches are additionally stressed with 39 words in 768 clocks.",
            "Publication-owner tests start from admitted batch jobs. Complete upstream TRANSFER FIFO/MMIO/SYS admission and DMA_READ are not supplied by that interface.",
            "Cold starts, first uncached loop endpoints, live START/source replacement, reverse traversal and overlapping source edits can exceed 768 clocks; all measured work is drained and every overrun remains reported.",
            "No numeric PLAY preparation allowance is added. Current-cycle software preparation is not evidence for an instantaneous physical launch or a permitted audible delay.",
            "Complete phase, interpolation, filter/gain/mix, command and output-clock scheduling remains outside this decoder slice. Spare decoder/memory clocks alone do not certify the whole APU.",
            "The manuals and current TS/C++ owners do not define a common initial BADP table lookup for raw header indices89..255. They are preserved but not qualified or silently clipped.",
        ],
        "input_sha256": {
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in [*paths, Path(__file__)]
        },
    }
    (ROOT / "build/reports/apu-physical.json").write_text(json.dumps(report, indent=2) + "\n")
    target = ROOT / "build/exports/APU_physical_decoder.csv"
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    system = report["system_organization_budget"]
    budget_rows = [("output_frame", report["frame_clocks"], "SYS clocks", "Fixed cadence")]
    budget_rows.extend(
        [
            (
                "eight_stereo_products",
                system["arithmetic"]["products_all_eight_per_output"],
                "products/output",
                "Both filters enabled; no proposed per-channel levels",
            ),
            (
                "candidate_MAC_issue_slots",
                system["arithmetic"]["issue_slot_demand_clocks"],
                "SYS clocks/output",
                "Proposed II2; not completion time",
            ),
            (
                "raw_store_read_write_screen",
                system["memory_screen"]["raw_read_plus_burst_write_clocks"],
                "SYS clocks/output",
                "32read+39admittedwrite; excludes decoder/control",
            ),
            (
                "candidate_four_lane_pan_products",
                system["bounded_eight_stereo_design_candidate"]["products_all_eight"],
                "products/output",
                "Stereo filters, master and proposed L/R levels; 4 lanes II2 unqualified",
            ),
            (
                "candidate_four_lane_pan_issue_slots",
                system["bounded_eight_stereo_design_candidate"]["arithmetic_issue_slots_clocks"],
                "SYS clocks/output",
                "Issue capacity only, no dependency/control timing proof",
            ),
            (
                "candidate_serial_unassigned",
                system["bounded_eight_stereo_design_candidate"]["serial_screen_unassigned_clocks"],
                "SYS clocks/output",
                "39 writes, hypothesised loop-inclusive reads; not a proven schedule",
            ),
            (
                "serial_upper_budget",
                system["memory_screen"]["serial_upper_budget_with_arithmetic_issue_slots"],
                "SYS clocks/output",
                "Upper envelope only; not an attained lower bound",
            ),
            (
                "component_2048_byte_read",
                system["controller_vs_component"]["ideal_component_payload_read_ns"],
                "ns",
                "Optimistic -10 SRAM tRC; not implemented controller",
            ),
            (
                "large_block_reverse_read",
                system["large_block_reverse_witness"]["optimistic_payload_read_ns"],
                "ns/output",
                "Serial prefix witness, no additional decoded-state mirror",
            ),
            (
                "large_mono_reverse_read_one",
                system["large_mono_block_reverse_witness"]["optimistic_payload_read_ns_for_one"],
                "ns/output",
                "Serial mono prefix witness without retained states or raw prefix",
            ),
            (
                "large_mono_reverse_read_eight",
                system["large_mono_block_reverse_witness"]["optimistic_payload_read_ns_for_eight"],
                "ns/output",
                "Serial mono prefix witness without retained states or raw prefix",
            ),
            (
                "large_mono_reverse_read_sixteen",
                system["large_mono_block_reverse_witness"]["optimistic_payload_read_ns_for_sixteen"],
                "ns/output",
                "Serial mono prefix witness without retained states or raw prefix",
            ),
        ]
    )
    with (target.parent / "APU_system_budget.csv").open("w", newline="") as out:
        writer = csv.writer(out)
        writer.writerow(["quantity", "value", "unit", "scope"])
        writer.writerows(budget_rows)
    print(
        json.dumps(
            {
                "stateful_scenarios": len(rows),
                "states_per_variant": cpp["state_checks"],
                "operands_per_variant": cpp["operand_checks"],
                "output_deadline_misses": normal["total_output_deadline_misses"],
                "unconditional_eight_stereo_guarantee": False,
            }
        )
    )


if __name__ == "__main__":
    main()
