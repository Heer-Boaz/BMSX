"""Eight stereo BADP/local-SRAM service bounds and actual source-trace replay.

The affine header-access bound covers a workload class, not one sample mix.
The real TS/C++ mixer supplies counterexamples and the real SRAM controller
supplies timing. No voice limit, decoder algorithm or source format is changed.
"""

import csv
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    paths = [
        ROOT / "build/reports/apu-workloads-ts.json",
        ROOT / "build/reports/apu-workloads-cpp.json",
        ROOT / "build/reports/apu-mixed-memory.json",
        ROOT / "build/reports/apu-eight-stereo-memory.json",
    ]
    ts, cpp, timing, physical = [json.loads(p.read_text()) for p in paths]
    cpp_cases = {s["id"]: s for s in cpp["scenarios"]}
    for case in ts["scenarios"]:
        assert case["checksum32"] == cpp_cases[case["id"]]["checksum32"]
        assert case["ended_mask"] == cpp_cases[case["id"]]["ended_mask"]
    read_clocks = max(c["last_read_only_accept_interval"] for c in timing["cases"])
    write_clocks = max(c["max_write_latency"] for c in timing["cases"]) + 1
    frame_clocks = timing["frame_clocks"]
    output_hz = ts["output_hz"]

    # The actual stereo block-load reads, in order: FRAME_COUNT/BLOCK_BYTES,
    # two signed16 predictors and index bytes; reserved7/11 are not read.
    # The first stereo nibble pair reads payload byte12 twice. Enumerating
    # ONLY four alignment residues proves the aligned-word span for any
    # block address; absolute addresses do not affect this bound.
    byte_offsets = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 12]
    header_runs = []
    two_frame_header_runs = []
    for residue in range(4):
        words = [(residue + b) & ~3 for b in byte_offsets]
        runs = 1 + sum(a != b for a, b in zip(words, words[1:]))
        header_runs.append(runs)
        words = [(residue + b) & ~3 for b in [*byte_offsets, 13, 13]]
        two_frame_header_runs.append(1 + sum(a != b for a, b in zip(words, words[1:])))
    assert max(two_frame_header_runs) == 5
    assert header_runs == [4, 4, 4, 4]
    # Two new frames within the same block need at most 2 payload words.
    # Crossing one header costs one old payload word plus the 4-word header
    # run, or the new header and its first TWO payload bytes (at most 5 runs).
    # With >=2 frames/block, two consecutive new frames cannot cross 2 headers.
    two_frame_payload = max(1 + ((residue & ~3) != ((residue + 1) & ~3)) for residue in range(4))
    assert two_frame_payload == 2
    class_bounds = [
        {
            "id": "forward_advance_at_most_one",
            "maximum_new_source_frames_per_voice_output": 1,
            "minimum_block_frames": 1,
            "maximum_source_reads_per_voice_output": max(header_runs),
            "maximum_nibble_decodes_all_eight": 16,
        },
        {
            "id": "forward_advance_at_most_two_blocks_at_least_two",
            "maximum_new_source_frames_per_voice_output": 2,
            "minimum_block_frames": 2,
            "maximum_source_reads_per_voice_output": max(
                two_frame_payload, 1 + max(header_runs), max(two_frame_header_runs)
            ),
            "maximum_nibble_decodes_all_eight": 32,
        },
        {
            "id": "forward_advance_at_most_two_including_single_frame_blocks",
            "maximum_new_source_frames_per_voice_output": 2,
            "minimum_block_frames": 1,
            "maximum_source_reads_per_voice_output": 2 * max(header_runs),
            "maximum_nibble_decodes_all_eight": 32,
        },
    ]
    for bound in class_bounds:
        reads = 8 * bound["maximum_source_reads_per_voice_output"]
        bound.update(
            maximum_source_reads_all_eight=reads,
            writeback_words_in_adverse_window=32,
            maximum_memory_clocks=reads * read_clocks + 32 * write_clocks,
            memory_margin_clocks=frame_clocks - reads * read_clocks - 32 * write_clocks,
            interpolation_filter_gain_products_all_eight_when_enabled=112,
        )

    physical_cases = {c["id"]: c for c in physical["scenarios"]}
    rows = []
    for case in ts["scenarios"]:
        if case["voices"] != 8:
            continue
        assert case["channels"] == 2 and case["format"] == "BADP"
        measured = physical_cases[case["id"]]
        frame_reads = [len(words) for words in case["frames"]]
        peak_reads = max(frame_reads)
        cold_reads = len(case["cold"]["word_runs"])
        predicted_peak = peak_reads * read_clocks + 32 * write_clocks
        assert measured["max_window_clocks"] == predicted_peak, case["id"]
        assert measured["cold_word_reads"] == cold_reads
        assert measured["cold_no_upload_clocks"] == cold_reads * read_clocks
        assert (
            measured["cold_with_writeback_clocks"] == cold_reads * read_clocks + 32 * write_clocks
        )
        startup_reads = cold_reads + frame_reads[0]
        assert measured["startup_source_reads"] == startup_reads
        assert measured["startup_no_upload_memory_clocks"] == startup_reads * read_clocks
        assert (
            measured["startup_with_one_writeback_burst_memory_clocks"]
            == startup_reads * read_clocks + 32 * write_clocks
        )
        for window in measured["windows"]:
            epoch = window["original_epoch"]
            assert window["source_word_reads"] == frame_reads[epoch]
            assert window["elapsed_clocks"] == frame_reads[epoch] * read_clocks + 32 * write_clocks
        selected_bound = "outside_the_proved_no_reseek_class"
        forward_word = case["rate_step_word"] < 0x80000000
        numerator = case["source_hz"] * case["rate_step_word"]
        one = output_hz * 0x10000
        no_loop = case["loop_end"] <= case["loop_start"]
        if (
            no_loop
            and forward_word
            and case["rate_change_frame"] == -1
            and case["mutate_frame"] == -1
        ):
            if numerator <= one:
                selected_bound = class_bounds[0]["id"]
                assert peak_reads <= class_bounds[0]["maximum_source_reads_all_eight"]
            elif numerator <= 2 * one:
                selected = class_bounds[1] if case["block_frames"] >= 2 else class_bounds[2]
                selected_bound = selected["id"]
                assert peak_reads <= selected["maximum_source_reads_all_eight"]
        rows.append(
            {
                "id": case["id"],
                "stereo_voices": 8,
                "source_frames_per_bank": case["source_frames"],
                "source_bytes_all_eight": case["storage_bytes"],
                "block_frames": case["block_frames"],
                "source_hz": case["source_hz"],
                "rate_step_word": case["rate_step_word"],
                "source_byte_alignment": case["source_byte_offset"] & 3,
                "loop_start": case["loop_start"],
                "loop_end": case["loop_end"],
                "seek_every_blocks": case["seek_every_blocks"],
                "class_bound": selected_bound,
                "all_output_epochs_examined": len(frame_reads),
                "physical_windows_replayed": measured["selected_windows"],
                "first_output_source_reads": frame_reads[0],
                "peak_source_reads": peak_reads,
                "peak_nibble_decodes": max(case["frame_nibbles"]),
                "peak_memory_clocks_with_32_writebacks": predicted_peak,
                "memory_margin_clocks": frame_clocks - predicted_peak,
                "output_epochs_over_memory_budget": sum(
                    n * read_clocks + 32 * write_clocks > frame_clocks for n in frame_reads
                ),
                "cold_source_reads": cold_reads,
                "cold_no_writeback_memory_clocks": measured["cold_no_upload_clocks"],
                "cold_with_32_writebacks_memory_clocks": measured["cold_with_writeback_clocks"],
                "cold_and_first_output_no_writebacks_clocks": measured[
                    "startup_no_upload_memory_clocks"
                ],
                "cold_and_first_output_one_32_word_writeback_clocks": measured[
                    "startup_with_one_writeback_burst_memory_clocks"
                ],
            }
        )
    assert len(rows) == len(physical_cases)
    assumptions = [
        "Eight actual simultaneous stereo BADP voices, independent valid source banks entirely in 512 KiB private sample RAM; no ROM cache or other voice-format mix is assumed.",
        "The class proof covers established playback with at most 1 or 2 new source frames/output, positive well-formed blocks, any byte alignment, no backward/restart/loop-wrap reseek, no decoder-state replacement. End-of-source without loop cannot increase the bound.",
        "Source advance means sourceHz*nonnegative_raw_RATE_STEP_word/(65536*44100), not RATE_STEP alone. Fractions and holds are included, but loops that select a distant neighbor are not no-reseek playback.",
        "Source word assembly retains one aligned word for consecutive byte reads only. Coherent overlapping-source writes, atomic 32*N batch publication and full voice scheduling are not supplied by the replay.",
        "An adverse 32-word writeback burst targets a disjoint inactive upload buffer. This screen uses repeated full 16-word/512-clock batches, not every legal variable-size arrival pattern; the separate physical publication tests additionally inject a 39-word admitted-job burst.",
        "The real SRAM replay checks actual source contents and every addressed word through the production controllers and ISSI pin model. Source initialization is model setup, not a substitute read port.",
        "All 1024 output epochs in each source trace are inspected; only critical original epochs are selected for slow pin-level replay. No initial output or missed epoch is silently discarded.",
    ]
    findings = [
        "The physical memory path can bound eight initialized forward stereo BADP voices to 512 clocks/768 with 32 disjoint writebacks for advance<=1, independently of positive block length and byte alignment. This is a memory-service guarantee class, not yet a whole-APU execution or silicon guarantee.",
        "Ordinary fractional-rate loops are counterexamples: current/neighbor reads can evict the loop-end frame and repeatedly decode the entire interval. Counting only compressed payload or reducing the global voice count does not remove this pathology.",
        "Cold PLAY, late START_SAMPLE, source replacement and arbitrary seeking have extra source preparation. No one-frame or numeric launch-latency permission is inferred.",
        "A replacement interpolation/loop-state owner must preserve current/previous BADP read visibility, RAM commit ordering and decoder endstate. A naive pair memo plus any-write invalidation is not already a proven fix: two-frame loops and the first postcommit evaluation can change decoder endstate or mixed old/new operands.",
        "No public slot count, rate, source format, loop mode, cache retention contract, runtime implementation or Books I-III is changed.",
    ]
    report = {
        "scope": "Targeted eight-stereo BADP guarantee audit; bounded physical memory service and explicit counterexamples, not an unconditional full-APU certificate.",
        "clock_hz": timing["clock_hz"],
        "output_hz": output_hz,
        "frame_clocks": frame_clocks,
        "read_word_clocks": read_clocks,
        "write_word_clocks": write_clocks,
        "actual_mixer_parity_cases": len(ts["scenarios"]),
        "actual_eight_stereo_cases": len(rows),
        "header_word_runs_by_byte_alignment": header_runs,
        "header_and_two_frames_word_runs_by_byte_alignment": two_frame_header_runs,
        "guarantee_classes": class_bounds,
        "assumptions": assumptions,
        "findings": findings,
        "results": rows,
        "input_sha256": {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [*paths, Path(__file__)]
        },
    }
    (ROOT / "build/reports/apu-eight-stereo.json").write_text(json.dumps(report, indent=2) + "\n")
    out = ROOT / "build/exports/APU_eight_stereo.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(
        json.dumps(
            {
                "mixer_parity": len(ts["scenarios"]),
                "actual_eight_stereo": len(rows),
                "memory_class_bounds": [c["maximum_memory_clocks"] for c in class_bounds],
            }
        )
    )


if __name__ == "__main__":
    main()
