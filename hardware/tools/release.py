"""Collect the current source, technical manuscript and native engineering exports.

The destination must be new. Earlier deliveries are never modified. The
explicit delivery mode repackages its own sources, exports and evidence without
rebuilding or requalifying them. ZIP and SHA256SUMS use standard conventions.
"""

import argparse
import hashlib
import json
import shutil
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]


def collect(destination, *, delivery=None):
    if delivery is None:
        exports_input = ROOT / "build/exports"
        reports_input = ROOT / "build/reports"
        dependencies_input = ROOT / "build/tests"
        cad_input = ROOT / "build/cad"
    else:
        exports_input = delivery / "exports"
        reports_input = delivery / "evidence"
        dependencies_input = reports_input / "dependencies"
        cad_input = reports_input / "cad"
    if delivery is None and not cad_input.is_dir():
        raise FileNotFoundError(f"CAD intermediates not found: {cad_input}")
    if cad_input.exists() and not cad_input.is_dir():
        raise NotADirectoryError(f"CAD intermediates are not a directory: {cad_input}")
    cad_available = cad_input.is_dir()
    destination.mkdir(parents=True)
    source = destination / "source"
    shutil.copytree(
        ROOT,
        source / "hardware",
        ignore=shutil.ignore_patterns(
            "build", ".venv", ".ruff_cache", "__pycache__", "*.pyc", "*.kicad_prl"
        ),
    )
    shutil.copytree(ROOT.parent / "docs/book4", source / "docs/book4")

    # These are the actual unchanged runtime owners used by the focused probes,
    # not alternate encodings or stand-in implementations in the hardware tree.
    runtime_inputs = (
        "LICENSE",
        "docs/proposed-specification-changes.md",
        "tests/lua/runtime_timing.test.ts",
        "third_party/fdlibm/LICENSE",
        "docs/book1/console.md",
        "docs/book1/pcrtc.md",
        "docs/book1/input.md",
        "docs/book1/system.md",
        "docs/book1/irq.md",
        "docs/book1/apu.md",
        "docs/book1/memory.md",
        "docs/book1/geo.md",
        "docs/book1/gte.md",
        "docs/book1/imgdec.md",
        "docs/book1/dma.md",
        "docs/book1/cpu.md",
        "docs/book3/cartridge.md",
        "machine/bios/main.lua",
        "machine/bios/gpu/gpu.lua",
        "machine/ts/spec/gx/display_presets.ts",
        "machine/cpp/spec/gx/display_presets.h",
        "machine/ts/machine/devices/gx/gpu_pcrtc.ts",
        "machine/ts/machine/devices/gx/gpu_local_memory.ts",
        "machine/ts/spec/gx/vram.ts",
        "machine/cpp/machine/devices/gx/gpu_pcrtc.cpp",
        "machine/cpp/machine/devices/gx/gpu_local_memory.h",
        "machine/cpp/spec/gx/vram.h",
        "machine/cpp/common/primitives.h",
        "machine/cpp/common/rect.h",
        "machine/cpp/common/types.h",
        "machine/cpp/common/vector.h",
    )
    runtime_inputs = set(runtime_inputs)
    # The construction reference links to all three public books. Include their
    # complete source chapters and figures rather than just the numeric leaves
    # needed by the engineering probes. Book II uses the book1 source folder.
    for directory in ("docs/book1", "docs/book3", "docs/manual", "docs/pdf"):
        runtime_inputs.update(
            path.relative_to(ROOT.parent).as_posix()
            for path in (ROOT.parent / directory).rglob("*")
            if path.is_file()
        )
    runtime_inputs.update(
        (
            "docs/index.md",
            "docs/_quarto.yml",
            "docs/_quarto-html.yml",
            "docs/_quarto-book-i.yml",
            "docs/_quarto-book-ii.yml",
            "docs/_quarto-book-iii.yml",
        )
    )
    book_iv_profile = ROOT.parent / "docs/_quarto-book-iv.yml"
    if book_iv_profile.is_file():
        runtime_inputs.add("docs/_quarto-book-iv.yml")
    elif (exports_input / "BMSX_BOOK_IV_HTML").is_dir():
        raise FileNotFoundError(f"Book IV HTML profile not found: {book_iv_profile}")
    for metadata in (
        "geo-resource-inputs.json",
        "gfx-pcrtc-sample-inputs.json",
        "gfx-pcrtc-compositor-inputs.json",
        "gfx-pcrtc-join-inputs.json",
        "gfx-pcrtc-window-inputs.json",
        "gfx-pcrtc-coordinate-join-inputs.json",
        "gfx-pcrtc-beam-phase-inputs.json",
        "gfx-pcrtc-system-beam-inputs.json",
        "gfx-pcrtc-display-latch-inputs.json",
        "gfx-pcrtc-control-inputs.json",
        "cpu-instruction-decode-inputs.json",
        "cpu-word-alu-inputs.json",
        "cpu-word-execute-inputs.json",
        "cpu-value-representation-inputs.json",
        "cpu-vm-frame-budget-inputs.json",
        "cpu-image-inventory-inputs.json",
        "cpu-boot-profile-inputs.json",
        "core-binary64-inputs.json",
        "core-binary64-normalize-inputs.json",
        "core-binary64-muldiv-inputs.json",
        "apu-workload-inputs.json",
        "apu-mix-inputs.json",
        "apu-pan-inputs.json",
        "apu-command-inputs.json",
        "apu-slot-bank-inputs.json",
        "apu-biquad-inputs.json",
        "apu-badp-coherence-inputs.json",
        "apu-fixed-block-loop-inputs.json",
        "apu-pcm-inputs.json",
        "apu-badp-mix-inputs.json",
        "apu-voice-cursor-inputs.json",
        "imgdec-payload-ts-inputs.json",
        "apu-voice-cursor-extremes-inputs.json",
        "apu-voice-rate-extremes-inputs.json",
        "apu-mixed-voice-inputs.json",
        "apu-mixed-snapshot-inputs.json",
        "apu-badp-filter-inputs.json",
        "system-debug-inputs.json",
        "cart-scalar-inputs.json",
    ):
        resource_inputs = json.loads((reports_input / metadata).read_text())["inputs"]
        runtime_inputs.update(
            (ROOT / name).resolve().relative_to(ROOT.parent).as_posix() for name in resource_inputs
        )
    # The compiler owns the actual header closure too. Consume its generated
    # depfile, including every translation unit, instead of guessing extra
    # common headers from the audio folder's location.
    dependency_files = []
    for depfile in (
        "imgdec_payload_cpp.d",
        "apu_workloads.d",
        "cart_scalar_reference_cpp.d",
        "system_debug_cpp.d",
        "apu_command_fifo_cpp.d",
        "apu_pcm_frame_cpp.d",
        "apu_slot_bank_cpp.d",
        "apu_biquad_cpp.d",
        "apu_badp_coherence_cpp.d",
        "apu_voice_cursor_cpp.d",
        "apu_voice_rate_extremes_cpp.d",
        "apu_mixed_voice_cpp.d",
        "apu_mixed_snapshot_cpp.d",
        "gfx_pcrtc_sample_cpp.d",
        "gfx_pcrtc_compositor_cpp.d",
        "gfx_pcrtc_join_cpp.d",
        "gfx_pcrtc_window_cpp.d",
        "gfx_pcrtc_coordinate_join_cpp.d",
        "gfx_pcrtc_beam_phase_cpp.d",
        "gfx_pcrtc_system_beam_cpp.d",
        "gfx_pcrtc_display_latch_cpp.d",
        "gfx_pcrtc_control_cpp.d",
        "cpu_instruction_decode_cpp.d",
        "cpu_word_alu_cpp.d",
        "cpu_word_execute_cpp.d",
        "cpu_value_representation_cpp.d",
        "cpu_compact_slot_vectors.d",
        "core_binary64_cpp.d",
    ):
        dependency_path = dependencies_input / depfile
        dependency_files.append(dependency_path)
        dependencies = dependency_path.read_text().replace("\\\n", " ")
        for rule in dependencies.splitlines():
            for name in rule.partition(":")[2].split():
                runtime_inputs.add((ROOT / name).resolve().relative_to(ROOT.parent).as_posix())
    # The resource inventory is derived from these live owners. Keep their
    # mirrored source, rather than substituting a frozen register/spec mirror.
    for implementation in ("ts", "cpp"):
        for owner in (
            "machine/cpu",
            "machine/devices/geometry",
            "machine/devices/dma",
            "machine/devices/imgdec",
            "machine/devices/input",
            "machine/devices/system",
            "machine/devices/audio",
            "machine/memory",
            "spec/audio",
            "spec/blua32",
        ):
            runtime_inputs.update(
                path.relative_to(ROOT.parent).as_posix()
                for path in (ROOT.parent / "machine" / implementation / owner).rglob("*")
                if path.is_file()
            )
        runtime_inputs.update(
            path.relative_to(ROOT.parent).as_posix()
            for path in (ROOT.parent / "machine" / implementation / "machine/devices/gx").glob(
                "gte.*"
            )
        )
    for name in sorted(runtime_inputs):
        target = source / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT.parent / name, target)

    shutil.copytree(exports_input, destination / "exports")
    evidence = destination / "evidence"
    evidence.mkdir()
    for path in sorted(reports_input.glob("*.json")):
        if path.name == "compact-parts-export.json":
            continue
        shutil.copy2(path, evidence / path.name)
    for path in sorted(reports_input.glob("*.txt")):
        shutil.copy2(path, evidence / path.name)
    dependency_output = evidence / "dependencies"
    dependency_output.mkdir()
    for path in dependency_files:
        shutil.copy2(path, dependency_output / path.name)
    if cad_available:
        shutil.copytree(cad_input, evidence / "cad")

    board = json.loads((reports_input / "mainboard.json").read_text())
    apu = json.loads((reports_input / "apu-eight-stereo.json").read_text())
    physical = json.loads((reports_input / "apu-physical.json").read_text())
    (evidence / "engineering-notes.txt").write_text(
        "BMSX — Technical Construction Reference\n\n"
        "Engineering source and native export delivery; no LaTeX book layout.\n\n"
        "This packaging step preserves existing engineering evidence; it does\n"
        "not rerun or requalify CAD, circuit, timing or RTL checks. Verify\n"
        "their dates and input hashes before applying them to changed sources.\n\n"
        "The baseline console STEP and complete assembly checks are retained\n"
        "from R57; they were not rerun after subsequent CAD source changes.\n"
        "The separate INPUT-candidate console STEP combines that retained\n"
        "assembly with the later candidate board component positions. It is\n"
        "an indicative native model, not a newly checked complete assembly.\n"
        "The rear BRep geometry is unchanged, while the updated focused rear-to-\n"
        "mainboard material and supplier-envelope checks pass. They do not\n"
        "replace the complete assembly check or its STEP round-trip. Assembly\n"
        "geometry is not a fabricated or thermal qualification.\n"
        "source/docs/ includes the existing complete Books I–III source\n"
        "chapters, illustrations and book profiles; these books were not\n"
        "modified or re-rendered by this construction-reference delivery.\n"
        "source/docs/proposed-specification-changes.md collects approved\n"
        "directions, unresolved product proposals and qualification boundaries.\n"
        "exports/BMSX_technical_reference.md is the complete technical manuscript.\n"
        "exports/figures/ contains the console, motherboard and functional drawings.\n"
        "core-internal.svg separates the CPU execution core and the other U1 engines.\n"
        "core-values-architecture.svg shows candidate value storage and arithmetic;\n"
        "neither physical heap capacity nor binary64 timing is qualified.\n"
        "exports/*_schema.pdf are native electrical schematic exports.\n"
        "exports/BMSX_wiring_schedule.csv and BMSX_internal_harnesses.svg/.png\n"
        "give 58 numbered internal conductors, derived from native board contacts.\n"
        "evidence/interconnect.json checks 56 board-paired conductors plus two\n"
        "DC leads. The revised front and keyboard JST headers are polarised.\n"
        "The pad loom's individual wire dress is not yet qualified. Full physical mating,\n"
        "solder processes and assembled analogue behaviour are not qualified.\n"
        "BMSX_PAD_LOOM_CANDIDATE.step is a separate, uninstalled bracket and\n"
        "receiving-volume study; the full fastener, tie and cartridge clearances\n"
        "with tolerances remain open. See evidence/pad-loom-candidate.json.\n"
        "BMSX_harness_parts.csv and BMSX_JST_pad_nominal_fit.csv describe the\n"
        "reference cable mates, tooling and nominal roof calculations. Other\n"
        "suitable custom harness constructions and lengths are not prohibited.\n"
        "The reference LAPP 0.50 mm2 DC wire uses 2.5 mm max OD and R10 loops;\n"
        "BMSX_DC_wire_routes.csv records\n"
        "modelled free-lead length/resistance, not a complete cut-length sheet.\n"
        "Molex's 23.50 mm mated REF locates the nominal housing rear; it is\n"
        "not a tolerance bound or a complete crimp and insulation geometry.\n"
        "Measured LAPP insulation OD selects the 63819-0900 hand tool or\n"
        "63902-4900 reel applicator; their published recommendations cover\n"
        "the full wire range. Finished-crimp and loom qualification remain open.\n"
        "exports/figures/scart-assembly-datums.svg/.png separates known socket\n"
        "numbered Kycon tails and the own adjustable Z36-49 carrier slots.\n"
        "BMSX_SCART_factory_tails.csv joins the actual native pads/nets to those\n"
        "datums. The7.5mm supplier dimension is ear height, NOT an ear-Z offset.\n"
        "BMSX_SCART_TERM exports and source/hardware/ecad/scart include the new contact\n"
        "board: ERC0, non-routing DRC0,22 unrouted native connections retained.\n"
        "Original-part procurement is unconfirmed; related X-variant EOL is\n"
        "explicitly separate. No active-supply or complete factory-solid claim.\n"
        "Foxconn RS11121-H01-4F is a sourcing candidate, not an approved\n"
        "substitute: numbering, bore dimensions and full fit remain unverified.\n"
        "exports/Power_rail_capacitance.csv distinguishes grounded and other-net\n"
        "capacitors. Power_load_envelope.csv and evidence/power-budget.json\n"
        "give conditional shared-input arithmetic, not a console power rating.\n"
        "F60's 3.75 A 25 C continuous-design reference is calculated separately\n"
        "from U62's 3.960 A test-point breaker minimum; neither guarantees a\n"
        "complete console load rating or predicts the fuse opening current.\n"
        "The revised U62 input dividers limit branch current in the stated\n"
        "reverse-voltage screen; pin clamp and dynamic reversal remain open.\n"
        "The external cartridge and peripheral rails share the main converters;\n"
        "individual branch protection and load limits are not yet designed.\n"
        "Both cartridge sockets share 24 data/control signals and ground. An\n"
        "overcurrent FAULT signal alone does not establish safe power-off or\n"
        "prevent back-power through those signals; see power-budget.json.\n"
        "The keyboard PS/2 pull-ups remain on the shared V5 rail. A protected\n"
        "J301 branch with coordinated pull-ups is a candidate, not fitted.\n"
        "Power_transient_sensitivity.csv and Power_brownout_sensitivity.csv\n"
        "add charge/droop scenarios, not measured ASIC loads or qualified reset\n"
        "protection. The supervisor's 13 us detection figure is typical only.\n"
        "Power_protection_thresholds.csv gives fitted divider intervals and\n"
        "static separation; PG assertion also requires inrush completion.\n"
        "exports/*.step are native CAD exchange files, including the complete console\n"
        "and the closed, inserting and seated cartridge-door assemblies.\n"
        "source/hardware/ contains editable KiCad projects, mechanical source,\n"
        "component geometry, memory/scheduler/SYS/CAD/APU-ROM/input/event RTL, tests,\n"
        "build rules and pinned dependencies. Cartridge shell/frame/door sources include paired\n"
        "front-offset polarising keys; no connector terminal is removed.\n"
        "evidence/ contains native checks and engineering calculations. The existing\n"
        "mainboard and front ERC and DRC were rerun after the JST pad ECO.\n"
        "ERC reports no violations; DRC reports no other violations or parity\n"
        "issues but retains 499 and 36 unconnected-item errors respectively.\n"
        "These are incomplete boards, not fabrication approvals.\n\n"
        f"Mainboard: {board['footprint_count']} footprints, {board['copper_layers']} copper layers, "
        f"{board['unconnected_count']} unconnected connections in the native connectivity model.\n"
        "This is not routed fabrication artwork, completed custom silicon or a\n"
        "qualified powered product. Raw DRC findings are included. The inherited\n"
        "rule profile is unchanged; no new exclusions or relaxations are added,\n"
        "and findings are not reclassified as approval. Programming manuals and runtime behaviour\n"
        "are not silently revised by the physical implementation proposals.\n\n"
        "The input subsystem includes a native bus endpoint, PS/2 keyboard receiver,\n"
        "four parallel pad lanes and a display-context link to standard pointer\n"
        "accessories. The GFX context slice is not a complete graphics processor.\n"
        "U7 also includes the read-only physical flash sequencer.\n"
        "The CORE event slice captures supervisor pin edges and retains VBlank\n"
        "source events; it is not the complete SYSTEM/NMI or IRQ-bank controller.\n"
        "Memory RTL includes the actual DRAM/SRAM waveforms, an APU sample-word\n"
        "store and independent CORE target/response ownership. Retained I/O has\n"
        "separate storage from GEO-visible RAM. Board reset does not truncate\n"
        "memory pulses or stop DRAM refresh; ASIC power-on reset is a separate\n"
        "internal cell boundary. make check-memory exercises those owners.\n"
        "make check-gfx covers the real SRAM calendar and raw-word credits.\n"
        "The SRAM read capture needs minimum-delay/hold closure in the actual\n"
        "ASIC and board; the ideal pin simulation is not that qualification.\n"
        "make check-system-integration covers actual SYS/CAD and the SYSTEM\n"
        "supervisor and exact millisecond timebase through LOCAL/DMA/IRQ;\n"
        "external unit boundaries are stimuli.\n"
        "make check-cart-scalar exercises scalar CAD framing against both live\n"
        "cartridge implementations and a behavioral pin-level card peer.\n"
        "make check-cart-physical covers actual CORE-to-CAD scalar routing and\n"
        "the x16 SRAM owner, including reset and cancel drain.\n"
        "make check-cart-reference exercises the integrated ROM/RAM/mailbox card.\n"
        "make check-dma-block covers channel banks, IRQ and supervisor exchange\n"
        "through CORE, with unaccepted CPU-LOCAL withdrawal and DMA drain.\n"
        "The actual CPU/PC owner, GPU/GEO/IMGDEC/APU handshakes, CDC, physical\n"
        "card and silicon timing remain open. Candidate IRQ capture can miss\n"
        "fast reassertions and DREQ sync can miss short levels; Book III defines\n"
        "no minimum interval or duration. make check-cart-pin-contract tests\n"
        "central FLAGS/ACK and currently fails without suppression. No proposed\n"
        "event-cell replacement is yet implemented or physically qualified.\n"
        "cart-irq-context.txt exercises held-low ACK and bank retention; its\n"
        "bank-switch ordering is an observation, not a specified latency.\n"
        "cart-irq-rearm-sweep.txt samples ideal digital phases and widths, not\n"
        "an electrical or statistically qualified pin timing requirement.\n"
        "The real reference-card integration performs immediate successive\n"
        "FLAGS reads through a helper that waits a clock edge between requests;\n"
        "it does not prove zero-gap back-to-back transaction timing.\n"
        "A single 16x34 signed multiplier supports proposed independent Q2.14\n"
        "channel levels and sixteen-slot gain/mix. Unity matches the existing\n"
        "TS/C++ mixer; independent levels are not a published register ABI.\n"
        "768 proposed gain frames match TS/C++ arithmetic and RTL; the physical\n"
        "BADP pin fixture includes panned mono, without a full voice pipeline.\n"
        "A separate 21-word command staging/FIFO slice matches 34 TS/C++ FIFO\n"
        "outputs; it lacks live slot/source/scheduler integration and keeps the\n"
        "current published defaults, not the proposed new mono/pan registers.\n"
        "Source preparation, filtering, scheduling and deadlines remain open.\n"
        "The physical voice mixer now includes the mono square source through\n"
        "the shared filter and stereo mix, with no source-memory read. Directed\n"
        "TS/C++ and slot-bank/playback tests do not qualify the complete APU.\n"
        "The mixer and playback-frame netlists were regenerated; other APU\n"
        "netlists and reports may predate this shared-source change and must\n"
        "be rebuilt before treating them as current implementation evidence.\n"
        "A separate serial-output trial joins the playback-frame owner and\n"
        "PCM1754-format I2S transmitter through a one-frame stereo buffer.\n"
        "The candidate one-frame latency is\n"
        "not confirmed compatible with public frame timing or live updates.\n"
        "A missed producer deadline is diagnosed internally; subsequent output\n"
        "and recovery are not specified by this trial.\n"
        "A mixed mono PCM/BADP trial connects the sample SRAM, mixer and\n"
        "serial DAC path for two TS/C++-matched frames, with a PCM upload.\n"
        "It does not establish all sustained loads or general deadlines.\n"
        "A separate PLAY-to-binder, local SRAM and I2S-pin trial exercises one\n"
        "PCM source; it does not establish every bind path or deadline.\n"
        "The SYS/control candidate connects the SYS endpoint to the existing\n"
        "command ingress, without a second independent command buffer. One\n"
        "mono PCM PLAY passes SYS, local binding, sample-SRAM pins and I2S;\n"
        "DMA/ROM, central IRQ, analog output and other loads remain open.\n"
        "The former direct-ingress test and older APU reports and netlists may\n"
        "predate the shared control-source change and require rebuilding.\n"
        "The IMGDEC batched trial joins a 32-word input queue, 16-word batch\n"
        "staging and a 64-word output FIFO. Its payload history can advance\n"
        "internally before staged words commit to the output FIFO. Supervisor\n"
        "quiescence, MMIO, DMA, DONE/IRQ and public timing remain open; this\n"
        "trial is not a complete IMGDEC device. Independent directed review\n"
        "also exercised literal and overlapping back-reference runs across\n"
        "the texture/CLUT boundary; it did not qualify full device timing.\n"
        "A CPU-facing nine-register candidate connects DATA and terminal IRQ\n"
        "to the batched engine. Its SYS transport, DMA path, supervisor, and\n"
        "public cycle-by-cycle timing and concurrency are not established.\n"
        "A directed malformed-MAGIC test verifies that no new CPU DATA write\n"
        "or request is accepted after fault detection; this does not establish\n"
        "the public cycle timing of all errors.\n"
        "One 23-word payload fixture matches the actual TS/C++ owners and RTL;\n"
        "the C++ reference test requires the full checkout's CMake libraries.\n"
        "The SYSTEM diagnostic owner implements the 8192-byte line queue and\n"
        "UTF-8 encoding; its output transport and physical memory are open.\n"
        "CORE LOCAL routes its registers to SYSTEM. The owner matches 61,218\n"
        "operations from the actual TS/C++ memory and diagnostic owners.\n"
        "A BADP-only filter-bypass path joins decoder, interpolation and gain/\n"
        "mix through SRAM pins for 48-frame 8-mono, 16-mono and 8-stereo cases.\n"
        "The initial tests include serial resets and have no DAC deadline. Cursor,\n"
        "other formats, live upload, output cadence and deadlines remain open.\n"
        "exports/rtl/ contains generic Yosys netlists, not mapped silicon,\n"
        "physical timing or a power certificate.\n"
        "The local APU snapshot test connects mixed PCM/BADP playback and\n"
        "publication to the actual SRAM owner and a timed ISSI pin model.\n"
        "It does not qualify ROM binding, modified BADP uploads or full load.\n"
        "CPU slot faults identify the internal owner and retain completed\n"
        "physical writes; VM allocation and fault policy remain open.\n"
        "The PCRTC horizontal sample mapper is a candidate for a latched\n"
        "display epoch; live-beam CDC, divider timing and scanout remain open.\n"
        "The source-word router retains local/ROM requests and socket strobes;\n"
        "the slot bank retains per-voice sockets, while the complete binder and\n"
        "failed-read semantics remain open. An experimental\n"
        "display FIFO needs its stated rate assumptions and is not full CDC.\n"
        "A configuration-CDC stress test sends 10,000 consecutive 705-bit\n"
        "snapshots to a 54 MHz receiver at seven phases; this tests the FIFO,\n"
        "not physical CDC qualification or complete GFX integration.\n"
        "A separate trial sends real SYS-PCRTC display-bank, FIELD and reset\n"
        "snapshots to a 54 MHz receiver. Pixel/beam alignment, clock/PLL\n"
        "qualification and recovery after receiver-clock loss remain open.\n"
        "A 4:1 sample checkpoint selects a coherent bank and FIELD and\n"
        "counts intervening reset/timing changes; it does not reconstruct\n"
        "their order or phase and is not integrated with beam or DAC timing.\n"
        "A later 54 MHz beam trial consumes ordered SYS snapshots including\n"
        "reset, timing changes and FIELD. Four clock phases and a digital\n"
        "54/13.5 MHz ratio test were exercised, but absolute SYS-to-pixel\n"
        "or DAC timing, physical clock closure and Y/scanout are not proven.\n"
        "A 64-bit CPU value encoding and polarised keyboard harness are design\n"
        "alternatives, not yet a complete VM or a fitted board revision.\n"
        "A proposed second flash shares the existing ROM address/data bus\n"
        "with a separate chip select for native interpreter code. The private\n"
        "fetch privilege boundary, board ECO, boot, program image, bus loading\n"
        "and physical timing have not been established by the bus trial.\n"
        "The APU slot bank records the selected socket per voice; the live\n"
        "update owner still depends on a real binder, playback and timeline.\n"
        "A binary64 service candidate supplies add/subtract/multiply/divide and\n"
        "square root; compound operations, physical timing and client integration\n"
        "remain open. The pinned Dawson reference and MIT license are included.\n"
        "The CORE memory RTL includes an experimental private second bank and\n"
        "separate bank output-enables; the board and VM allocator do not yet\n"
        "implement it. Tests and synthesis are not electrical qualification.\n"
        "A corrected serial divider replaces the original reference in the\n"
        "service; an explicit subnormal rounding counterexample is retained.\n"
        "The optional fast MUL/DIV are tested candidates, not ASIC timing proof.\n"
        "An APU frame owner joins cursor lanes and mixer to sample snapshots;\n"
        "binder, generator, fade, real event receiver and complete timing remain open.\n"
        "These transports do not yet qualify the worst-case sixteen-voice ROM\n"
        "bandwidth; source binding, burst/cache and the full audio datapath remain open.\n"
        f"make check-apu compares {apu['actual_mixer_parity_cases']} actual TS/C++ mixer cases, "
        f"including {apu['actual_eight_stereo_cases']} exact\n"
        "eight-stereo BADP cases, and measures sample-SRAM capacity at its pins.\n"
        "make check-apu-eight retains the unchanged-runtime source-demand screen.\n"
        f"make check-apu-physical tests {physical['coverage']['actual_ts_cpp_stateful_scenarios']} "
        "stateful TS/C++-matched scenarios\n"
        "through native BADP, publication/snapshot and SRAM pin circuits. Sixteen\n"
        "native slot contexts are retained; the tested concurrent load is eight\n"
        "stereo voices. Exact samples/state do not imply every deadline fits.\n"
        "exports/figures/APU_execution_organization.svg and its PNG give the\n"
        "proposed system-level service organization. exports/APU_system_budget.csv\n"
        "contains closed-form sizing, not measured MAC or full-frame timing.\n"
        "The proposal separates fixed-rate rendering, variable preparation and\n"
        "memory publication; no public start delay or workload restriction is applied.\n"
        "evidence/apu-physical.json and exports/APU_physical_decoder.csv retain\n"
        "cold/first-output costs, reverse/live-write overruns and the raw x16\n"
        "cold-prefix lower bound. No new preparation delay is silently granted.\n"
        "evidence/apu-badp-upload.json includes global admitted-batch arrivals,\n"
        "rejections, publication edges and actual physical writes. It is not\n"
        "complete public FIFO/MMIO/SYS admission or full mixer qualification.\n"
        "exports/rtl/ contains native generic Yosys JSON netlists, not mapped\n"
        "fabrication artwork. evidence/apu-synthesis.json records resource\n"
        "counts and limitations; no ASIC cell timing, power or area is certified.\n"
        "The broader source-demand/ROM-cache comparisons remain in\n"
        "exports/APU_workload_matrix.csv and evidence/apu-feasibility.json.\n"
        "No public voice limit or source format has been changed. Programming\n"
        "specifications and runtime remain unchanged. The mainboard includes\n"
        "the revised U62 divider components. The SCART contact board, carrier\n"
        "and R10 DC harness are included in affected native CAD exports. Obsolete\n"
        "DC block fasteners and their underside access features are removed.\n"
        "External port datums, mainboard placement and passive cooling are unchanged.\n"
        "exports/firmware/ contains complete 8 MiB U33 programming images, with\n"
        "unchanged firmware prefixes and zero tails; evidence/firmware-*.json\n"
        "records their sizes and hashes. No flash programmer runs over SYS.\n"
        "Remaining silicon and hardware qualification work is listed once in\n"
        "source/hardware/README.md under Release scope.\n\n"
        "Rebuild from source/hardware/ using its README and Makefile. The selected\n"
        "unchanged BMSX runtime/specification leaves under source/machine/ and\n"
        "source/docs/book1/ are included only for the actual-owner comparisons.\n"
        "They are not a complete runtime checkout or a separate product authority.\n"
        "The TypeScript probe needs Node 22 and tsx 4.23.1; in a source-only\n"
        "extraction use TSX='npm exec --yes --package=tsx@4.23.1 -- tsx'.\n"
        "Icarus Verilog 12 provides iverilog/vvp for make check-rtl.\n"
        "Yosys 0.52 provides the native generic synthesis screen; set YOSYS to\n"
        "its executable for make check-apu-physical or check-apu-synthesis.\n"
        "Node 22 and esbuild 0.28.1 rebuild make check-resources from the included\n"
        "actual geometry/memory owners. Override ESBUILD for its installed path.\n"
        "Set IVERILOG, IVERILOG_FLAGS and VVP for a nonstandard installation.\n\n"
        "make board-integration rebuilds the changed wiring and power producers\n"
        "without a new full RTL/ERC/DRC batch. Use KiCad's matching Python and\n"
        "rsvg-convert for the harness SVG/PNG. Older reports retain their original\n"
        "test scope; the archive sidecar describes the current delivery checks.\n\n"
        "make check-dc-carrier exercises the actual local G10 producer and its\n"
        "native STEP round-trip without rebuilding the whole console.\n\n"
        "make check-firmware exercises the opaque-payload programming-image producer\n"
        "using standard-library Python tests. FIRMWARE and FIRMWARE_DEBUG select\n"
        "original firmware payloads for make firmware-images; its default paths\n"
        "refer to the full repository build, not this selected-source extraction.\n\n"
        "SHA256SUMS covers every payload file except itself. The ZIP contains this\n"
        "same directory. Previous originals and sealed deliveries are unchanged.\n",
        encoding="utf-8",
    )
    (destination / "README.txt").write_text(
        "BMSX — Technical Construction Reference\n\n"
        + ("The browsable Book IV is in exports/BMSX_BOOK_IV_HTML/. For search\n"
           "and scripts, serve it on loopback HTTP from this extracted folder:\n"
           "  python3 -m http.server 8000 --bind 127.0.0.1 --directory exports/BMSX_BOOK_IV_HTML\n"
           "Then open http://127.0.0.1:8000/. It describes a proposal, not a\n"
           "qualified product.\n\n"
           if (exports_input / "BMSX_BOOK_IV_HTML/index.html").is_file() else "")
        + "Start with exports/BMSX_technical_reference.md for the console's\n"
        "organisation, construction, connections and service reference.\n"
        "It is a Markdown manuscript with Quarto cross-references, not a\n"
        "finished standalone manual. Its illustrations are in exports/figures/.\n"
        "The complete source\n"
        "chapters and illustrations for Books I–III and the construction\n"
        "reference are in source/docs/. The existing Books I–III PDF exports\n"
        "are in source/docs/pdf/ as-is; they were not rebuilt or checked for\n"
        "currency.\n\n"
        "source/docs/proposed-specification-changes.md records proposed\n"
        "product changes and retained physical design investigations. The\n"
        "current programming contracts remain in Books I–III; the proposal\n"
        "does not itself change them or the emulator.\n\n"
        "source/hardware/ contains the editable KiCad, CAD and related\n"
        "engineering sources. Native STEP models, schematic PDFs and other\n"
        "exports are in exports/. SHA256SUMS covers the delivered files.\n\n"
        + ("Current passive-candidate files in exports/:\n"
           "  BMSX_PASSIVE_CANDIDATE_unrouted.kicad_pcb  editable PCB\n"
           "  BMSX_PASSIVE_CANDIDATE_schematic.pdf      schematic\n"
           "  BMSX_PASSIVE_CANDIDATE_board_native.step  bare board, no components\n"
           "  BMSX_CONSOLE_ALL_FACES_VISUAL_PRESENTATION.step  console concept\n"
           "The console presentation uses illustrative connector faces and\n"
           "retained assembly geometry; it is not an assembly qualification.\n\n"
           if all((exports_input / name).is_file() for name in (
               "BMSX_PASSIVE_CANDIDATE_unrouted.kicad_pcb",
               "BMSX_PASSIVE_CANDIDATE_schematic.pdf",
               "BMSX_PASSIVE_CANDIDATE_board_native.step",
               "BMSX_CONSOLE_ALL_FACES_VISUAL_PRESENTATION.step",
           )) else "")
        + ("exports/BMSX_WIDE_GFX_CLUSTER_CONCEPT.step is a separate wide-GFX\n"
           "placement study. Its flat markers are not component models; the\n"
           "complete population and cooling are omitted. See source/hardware/README.md.\n\n"
           if (exports_input / "BMSX_WIDE_GFX_CLUSTER_CONCEPT.step").is_file() else "")
        + ("exports/BMSX_WIDE_VRAM_PARTIAL_A3_schema.pdf is the separate four-SRAM\n"
           "interface proposal; its XML netlist is alongside it. U2 pinout,\n"
           "snapshot, decoupling and complete integration are not included.\n\n"
           if (exports_input / "BMSX_WIDE_VRAM_PARTIAL_A3_schema.pdf").is_file() else "")
        + ("exports/BMSX_GFX_VRAM_SNAPSHOT_PARTIAL_schema.pdf combines the\n"
           "wide VRAM proposal with copies of the snapshot-memory sheets;\n"
           "its XML netlist is alongside it. U2 pins, arbitration, new VRAM\n"
           "decoupling and PCB integration are not included.\n\n"
           if (exports_input / "BMSX_GFX_VRAM_SNAPSHOT_PARTIAL_schema.pdf").is_file() else "")
        + ("The evidence/cad/ directory retains existing CAD intermediates.\n"
           "To copy the retained artifacts into a new build directory, run\n"
           "source/hardware/tools/release.py --restore-build-from-delivery\n"
           "with this extracted directory as its argument. This does not build\n"
           "or qualify them, and it does not establish completeness.\n\n" if cad_available else
           "This older delivery does not contain CAD intermediates. A complete\n"
           "build-artifact reconstruction from this delivery is not available.\n\n")
        + "The evidence/dependencies/ directory retains compiler depfiles used\n"
        "to collect comparison sources. To repackage this extracted delivery\n"
        "without rebuilding, run its source/hardware/tools/release.py with\n"
        "--from-delivery <extracted-directory> and a new destination. This\n"
        "explicitly reuses its exports and evidence, without requalifying them.\n\n"
        "The console is a design reference, not a qualified manufactured\n"
        "product. Copper routing and physical qualification remain incomplete.\n"
        "The current mainboard-interconnect.svg shows the proposed U2 INPUT\n"
        "allocation. The earlier U7 diagram is retained under\n"
        "source/hardware/reference/figures/mainboard-interconnect-u7.svg.\n\n"
        "Packaging does not rerun CAD, timing, RTL, ERC or DRC checks. Existing\n"
        "results and their historical scope are retained under evidence/; see\n"
        "evidence/engineering-notes.txt before relying on an older result.\n"
        "The baseline console STEP is retained from R57. The separate INPUT\n"
        "candidate STEP shows the newer component placement against that\n"
        "retained assembly, not a newly validated complete assembly. A separate\n"
        "passive candidate STEP also removes the unused fan header. The\n"
        "separate flat-spreader console STEP uses the same retained assembly.\n"
        "A further separate STEP adds the local keyboard-front proposal. Both\n"
        "are construction proposals, not thermal or fit qualifications. The\n"
        "separate rear-connector and rear-console presentation STEPs use\n"
        "illustrative connector faces, not manufacturer CAD or evidence of\n"
        "connector mating and mounting.\n",
        encoding="utf-8",
    )
    files = sorted(path for path in destination.rglob("*") if path.is_file())
    sums = []
    for path in files:
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        sums.append(f"{digest}  {path.relative_to(destination).as_posix()}\n")
    (destination / "SHA256SUMS").write_text("".join(sums), encoding="utf-8")
    archive = destination.with_name(destination.name + ".zip")
    with ZipFile(archive, "x", compression=ZIP_DEFLATED, compresslevel=6) as package:
        for path in sorted(destination.rglob("*")):
            if path.is_file():
                package.write(path, path.relative_to(destination.parent))
    with archive.open("rb") as stream:
        archive_sha256 = hashlib.file_digest(stream, "sha256").hexdigest()
    return {
        "directory": str(destination),
        "archive": str(archive),
        "payload_files": len(files),
        "archive_bytes": archive.stat().st_size,
        "archive_sha256": archive_sha256,
        "cad_intermediates_included": cad_available,
    }


def copy_exclusive(source, target):
    """Copy one delivered artifact without replacing an existing file."""
    with Path(source).open("rb") as src, Path(target).open("xb") as dst:
        shutil.copyfileobj(src, dst, length=1024 * 1024)
    shutil.copystat(source, target)
    return str(target)


def restore_build(delivery):
    """Materialize retained artifacts into a new build tree, without rebuilding."""
    evidence = delivery / "evidence"
    exports = delivery / "exports"
    cad = evidence / "cad"
    dependencies = evidence / "dependencies"
    build = ROOT / "build"
    if not cad.is_dir():
        raise FileNotFoundError(
            f"CAD intermediates are absent from this delivery: {cad}; "
            "build-artifact reconstruction is incomplete"
        )
    for directory in (exports, evidence, dependencies):
        if not directory.is_dir():
            raise FileNotFoundError(f"Required delivery directory not found: {directory}")
    if build.exists() or build.is_symlink():
        raise FileExistsError(f"Build directory already exists; nothing overwritten: {build}")
    build.mkdir()
    shutil.copytree(exports, build / "exports", copy_function=copy_exclusive)
    shutil.copytree(cad, build / "cad", copy_function=copy_exclusive)
    shutil.copytree(dependencies, build / "tests", copy_function=copy_exclusive)
    reports = build / "reports"
    reports.mkdir()
    for pattern in ("*.json", "*.txt"):
        for path in evidence.glob(pattern):
            if path.name != "engineering-notes.txt":
                copy_exclusive(path, reports / path.name)
    return {"build": str(build), "rebuild_or_qualification_performed": False}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("destination", type=Path, nargs="?")
    cli.add_argument(
        "--archive-only",
        action="store_true",
        help="Stage temporarily outside the delivered source and publish only the ZIP archive",
    )
    cli.add_argument(
        "--from-delivery",
        type=Path,
        help="Repackage this script's extracted delivery, explicitly reusing its exports and evidence",
    )
    cli.add_argument(
        "--restore-build-from-delivery",
        type=Path,
        help="Copy delivered artifacts into this extracted delivery's new build directory",
    )
    args = cli.parse_args()
    if args.restore_build_from_delivery is not None:
        if args.destination is not None or args.archive_only or args.from_delivery is not None:
            cli.error("--restore-build-from-delivery cannot be combined with packaging arguments")
        delivery = args.restore_build_from_delivery.resolve()
        if ROOT != (delivery / "source/hardware").resolve():
            cli.error("--restore-build-from-delivery must name the extracted delivery containing this script")
        print(json.dumps(restore_build(delivery)))
        return
    if args.destination is None:
        cli.error("a destination is required for packaging")
    target = args.destination.resolve()
    delivery = args.from_delivery.resolve() if args.from_delivery is not None else None
    if delivery is not None and ROOT != (delivery / "source/hardware").resolve():
        cli.error("--from-delivery must name the extracted delivery containing this script")
    if delivery is not None and target.is_relative_to(delivery):
        cli.error("the new destination must be outside the extracted delivery")
    archive = target.with_name(target.name + ".zip")
    if archive.exists():
        raise FileExistsError(f"Destination archive already exists: {archive}")
    if not args.archive_only and target.exists():
        raise FileExistsError(f"Destination directory already exists: {target}")
    if args.archive_only:
        stage_parent = ROOT / "build" if delivery is None else target.parent
        with tempfile.TemporaryDirectory(prefix="release-", dir=stage_parent) as stage:
            result = collect(Path(stage) / target.name, delivery=delivery)
            with Path(result["archive"]).open("rb") as source, archive.open("xb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
            with archive.open("rb") as published:
                published_sha256 = hashlib.file_digest(published, "sha256").hexdigest()
            if published_sha256 != result["archive_sha256"]:
                raise RuntimeError("Published archive does not match staged archive")
            result["directory"] = None
            result["archive"] = str(archive)
    else:
        result = collect(target, delivery=delivery)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
