# Bounded Book I technical-detail inventory

**Volume-name update, 2026-10-18:** the [adopted series](booklet-structure.md)
uses I for System and Hardware, II for BLua32 and BIOS, and III for Cartridge
and Expansion. Earlier progress entries below use the old provisional II for
cartridge/socket/card work; preserve that evidence chronology, not that old
classification. Current public chapter cross-references use III.

2026-10-17; checkout `cb893c6d5`; worktree was clean at inspection. Baseline inventory recorded before the T02 DMA supplement. Neither `docs/architecture.md` nor a reference PDF was opened.

**Boundary:** this is an editorial inventory of the six current chapters and their existing frozen fact sheets, plus a unit/index inventory. It is not a new live owner-versus-spec extraction, a fresh factual approval, proof of full Book I coverage, or closure of the user's broad technical audit. The whole-console audit and graphics-output work remain open. The DMA supplement below addresses the first bounded rate/boundary teaching task, not this entire inventory. No new publisher/schema/check layer is proposed.

**Completion target:** a programmer new to BMSX must be able to control the
whole hardware from the manual alone, without reverse-engineering runtime,
firmware or example code to discover missing contracts. Apply the reader
acceptance target in [README.md](README.md) to the whole book and cross-unit
programming route, not merely to isolated register tables. This inventory is
still open until that target is demonstrated.

**Progress after this baseline:** GEO now has a separately extracted and reviewed
owner chapter, an executed three-operation BLua cartridge and paired timing/data
replays; see [its source review](../book1/reviews/geo-source.md). This closes the
missing GEO chapter assignment below, not the broad technical audit or the real
graphics-output illustrations. IMGDEC now also has a separately extracted,
reviewed owner chapter and executed four-job BLua cartridge; see
[its source review](../book1/reviews/imgdec-source.md). INPUT now has a separately authored, source-checked raw-interface draft; its
attachment and output-precision questions remain recorded below. The bounded
GEO docking scene and five real output plates are now accepted; complete
memory/CPU/system foundations remain open.

## Software corrections — 2026-10-19

Table cross-capacity refill, repeat-body scope through `until`, negative-zero
constants and typed float initializers are repaired at their producers. The
GPU now retains unread USER readback and queued ingress across supervisor
entry; the former RDB01 stall is reproduced as resolved. Ordinary BIOS radian
trigonometry is repaired separately from the unchanged phase-word/Q16 primitive.
The current fact dispositions supersede the dated OPEN observations below.
CPU7, FSEL01, other identified owner issues and whole-manual acceptance remain
open; updated chapter source/print checks are separate from these software fixes.

## Current technical-inventory routing — 2026-10-18

This is a work index of bounded checks, not twelve whole-unit approvals or a
new publication gate. Installed numbers already documented are not missing
merely because a fresh inventory is pending. Physical ratings absent from the
owners remain specification decisions, not numbers to invent.

| Unit | Latest bounded evidence and next action |
|---|---|
| CPU | Resource/value/ISA/cost teaching is present, including inverse field assembly, function-record relocation versus image indices, CLOSURE address ranges and five exact byte examples for independent image construction. CPU7 and the recorded owner/producer disagreements remain separate; another instruction table is not the missing work. |
| Memory | Consumed boot/image/table/record layouts, the full I/O-bank directory and retained-slot/decoder boundaries are explicit. Matching BIOS storage/link information is distinguished from compulsory placement. FSEL01, image-text decoding and final whole-console acceptance remain open; RDB01 is repaired. |
| SYSTEM | The prior paired control/phase/banking/reset/timing check remains bounded. RDB01 is repaired by retaining unread USER readback and queued ingress; [source and ordinary-ROM evidence](../book1/facts/system-readback-entry.md). Known yield/HALT precedence remains separate; arbitrary-state combinations are not approved. |
| GTE | Fresh bounded paired capacity/normal-and-PLUS interface/timing inventory found no new required quantitative paragraph; existing arithmetic/program/output lessons remain. No fresh exhaustive arithmetic or execution approval is implied. |
| PCRTC | Recent paired capacity/clock/timing/latch check found no new missing numeric paragraph; the shared Table-length disagreement is repaired separately. |
| IRQ | Recent bounded controller check found no new missing quantitative paragraph; it was not a fresh CPU-exception audit. |
| GPU | Startup pattern versus stream resets and firmware-owned storage are now clarified in one compact paragraph; [bounded source/reader evidence](../book1/reviews/gpu-source.md) is distinct from print. |
| DMA | Current paired inventory confirms rates/routes/tails/contention; the false socket-selection denial is removed and the existing Book III route is linked. [Correction evidence](../book1/reviews/dma-source.md). |
| APU | Quantitative/source-domain and lifetime contracts remain, with independent raw-register PCM/square configurations and the standalone raw-port download example. The former library playback program is outside the BMSX series. Decide nonloop fade/source-end timing separately: the entry and per-frame checks differ; [APV29](../book1/facts/apu.md#apv29--exact-fade-edge-and-source-length-hazard). |
| GEO | Current paired inventory confirms operations/buffers/formats/rates and existing sprite/hull plates; [large-count counter arithmetic](../book1/facts/geo-counter-arithmetic.md) remains a separate unresolved owner issue, not an invented batch cap. |
| IMGDEC | Current bounded numeric/stream/batch/DREQ/reset check found no newly missing required paragraph. It did not rerun the full cartridge or approve central CPU/memory access behavior. |
| INPUT | Current raw resource/Q16/latch/normal-output check found no newly missing capacity/clock paragraph. Full-word output precision and attachment conventions below remain unresolved. |

Current finite audit packets: `/tmp/bmsx-{cpu,memory,system,gte,dma,geo,imgdec,input}-technical-coverage-current.md`.
These distinguish already-public teaching, actual missing/corrected sentences,
undefined physical guarantees and unproved execution. The four fresh foundation
inventories are now recorded at their stated finite boundaries, not as exhaustive
unit approvals. Whole-console newcomer, BIOS/SDK/debugging and delivery work stay open.

## System overview opening — bounded addition, 2026-10-18

The [System overview](../book1/console.md) now precedes the existing Book I
chapters. It states installed main/GPU/sample memory versus address windows,
I/O/GEO/firmware-VRAM reservations and image-dependent statics; system timing,
qualified DMA/IMGDEC/GEO/APU service quantities; and the graphics/display,
geometry and audio-source/transfer routes. It links canonical detailed contracts
rather than inventing a second partial register catalog or a new driver API.

Three facts-only section authors, independent actual paired-owner source audits,
a source-blind full-overview reader and actual seven-page print inspection
supply separate evidence in the [merged record](../book1/reviews/console-source.md).
Two selected-route schematics have independent semantic source and actual-page
checks; they are not live output captures or electrical wiring diagrams.

The review corrected real span/concurrency/visibility/representation wording;
no runtime, BIOS, compiler, publisher, harness or new approval machinery was
added. Existing shared Table-length, CPU7 and BZ01 questions remain open.
This closes the missing bounded opening orientation assignment, not full
technical inventory, book navigation, software/environment, SDK/debugging,
Book III or whole-console newcomer acceptance. Unspecified electrical clocks,
CPU/fetch wait states and sustained physical rates were not fabricated.

## Current bounded GX audit — 2026-10-18

Fresh separate source audits rechecked the current GTE specifications and
normal/PLUS timing, GPU ingress/raw-image/readback/DMA boundaries, and PCRTC
geometry/timing/latch/event surfaces against their paired live owners. These
are bounded checks, not another whole-console or every-backend approval. They
found substantial existing technical coverage, not three missing-spec stubs,
and no contradiction in the checked surfaces. The old PCRTC Q16 truncation/wrap
disagreement is visibly corrected; its historical special testcase was not
re-executed by this audit.

The concrete writing/observation assignments are:

- **GPU image transport:** the new
  [complete raw-image DMA program](../book1/gpu.md#gpu-image-dma-program)
  supplies the missing RAM→fixed GP0 upload and READY fixed GPUREAD→RAM roundtrip.
  It uses 44 upload words and 41 readback words, odd-row packing, three blocks
  and a short tail each way, retained channel/READY/marker/idle observations,
  and separately qualified 47/44-cycle admitted charges. Source, ordinary
  guest, independent reader and actual-print evidence are recorded in the GPU
  reviews. This closes that finite route, not every GPU transport scenario,
  physical bandwidth or graphics-illustration task.
- **GTE depth cue, material and near plane:** the
  [depth-cue and material lessons](../book1/gte.md#gte-depth-cue-output) and
  [near-plane lesson](../book1/gte.md#gte-near-plane-output) retain hardware
  setup, numerical results and actual output plates. Library-dependent complete
  listings and their build recipes are no longer part of this series. Existing
  execution evidence applies to those original programs, not to a new
  independent source listing.
- **PCRTC source versus destination — completed finite lesson:** the
  [complete154-line cartridge and three actual output plates](../book1/pcrtc.md#pcrtc-source-and-window)
  now show a fixed256×192 circuit-2 canvas and128×96 circuit-1 cutout: source(0,0)/
  destination(64,48), source(32,16)/same destination, then same source/destination
  (96,48). Fresh paired-owner/source/image checks, ordinary guest/captures, all
  RGB pixels against the authored scene, byte-exact fresh-reader reconstruction
  and final actual-print inspection pass. This closes that isolation lesson,
  not every display scenario. The separate coefficient/alpha contrast is now
  completed below; parallel backend work was left alone.
- **PCRTC unequal magnification — completed finite lesson:** the
  [horizontal-sampling section](../book1/pcrtc.md#pcrtc-horizontal-sampling)
  now derives source selection from signal step, source magnification and
  first-pixel phase, using both actual software consumers as well as paired
  producers. A complete 91-line ordinary BLua cartridge programs step 4,
  magnification 3 and phase 2; its actual 8×1 output reads offsets 0,2,3,4,6,7,8,10
  from sixteen adjacent source pixels. All source readback words and fresh
  VBlank observations pass; all eight captured RGB pixels match. Independent
  source/image and public-only reader checks, byte-exact reconstruction and
  final actual-PDF inspection are retained in the sampling review. This closes
  that formula/rounding/example gap, not PMODE contrasts, native/accelerated
  parity, electrical clocks or whole-manual acceptance.
- **PCRTC coefficient and alpha — completed finite lesson:** the
  [composition section](../book1/pcrtc.md#pcrtc-composition-output) supplies a
  complete125-line BLua cartridge and three distinct ordinary256×192 plates.
  Four complete PMODE words keep both raw sources/windows/background unchanged:
  A/B isolates MMOD, B/C SLBG and B/D AMOD. GX16 sample alpha128 selects RGB
  coefficient255, not half strength; output alpha is selected separately.
  All raw source words and fresh callbacks pass the ordinary guest. Separate
  actual production-render replay checks every raw RGBA pixel, including the
  B/D alpha difference hidden by opaque PNGs. Independent paired-source/image,
  public-only byte-exact reconstruction and actual-PDF checks are recorded in
  the composition review. This closes the controlled PMODE task, not all
  graphical states, backend matrices or whole-manual acceptance.

The underlying source boundaries are the current GTE normal/PLUS dispatch and
projection/lighting/cue owners, GPU ingress/readback and DMA controller, and
PCRTC timing/scanout/latch owners. Their chapter fact sheets and source reviews
retain exact paths; no architecture document or reference-console behavior was
used. Undefined physical clocks and sustained rates are still specification
decisions, not numbers to manufacture.

## What is already explicit, versus what still needs a paragraph

Line ranges describe the inspected baseline, not stable manuscript anchors.
The T02 DMA supplement adds the route-rate table, block/tail/wait examples and
GPU image transport budgets identified below. The later GPU roundtrip above
closes the finite combined-route teaching task; the earlier controller-only
rate replays remain insufficient by themselves as VRAM completion evidence.

### PCRTC

Already recognizable rather than merely implicit:
- Capacities/organization/widths: chapter `pcrtc.md:20–43` gives main RAM versus shared local memory, two circuits, 26 mapped words versus 22-word program/display banks, aligned word interface, geometry field capacities.
- Clocks/cycles/latency: `45–79` supplies reset half-line/field conversion, four cycle landmarks, fractional deadlines, scalar/sequence instruction costs and no PCRTC write-ready stall. `331–365` distinguishes immediate readback, VBlank latching, multiword hazards and beam restart.
- Formats/addressing: `145–273` gives sample packing, zero-format results and the complete page/block/linear layout families. Sharing: `22–25` says both circuits share one local memory. `81–85` expressly does not invent an electrical arbitration/fetch/bandwidth contract.
- Frozen basis: `facts/pcrtc.md:148–252,308–365,952–1028`.

The originally missing window/source-origin output contrast is completed by the later full cartridge and three actual plates recorded above; its original frozen inputs are no longer mistaken for execution evidence. The controlled **PMODE coefficient/alpha** contrast and unequal-magnification source progression are now completed by the separate finite lessons recorded above. No missing electrical number was established by the bounded inventory.

**Bounded continuation:** the Memory chapter now supplies a complete ordinary
two-surface cartridge, changing only framebuffer base for its two switches.
The red/blue/green outputs distinguish selected storage from a saved image;
ordered readback and fresh-after-write VBlank observation have separate result
checks. Actual ordinary-playback PNGs, not integration captures, supply the
three plates. Window, PMODE and composition contrasts remain separate tasks.

### GTE

Already explicit:
- `gte.md:13–79` separates operand/register capacities, 44/32/16-bit arithmetic stages, history depths, system frequency, normal synchronous results, PLUS latency and the five-cycle arithmetic admission ceiling; it distinguishes nominal normal CYCLES from elapsed time.
- `4981–5086` supplies PLUS publication/interlock, direct CPU versus DMA command access, ordered word/sequence effects, faults, no completion IRQ and reset cancellation.
- `4831–4980` budgets an entire geometry/lighting/packet-construction instruction interval; `5716–5887` gives repeated PLUS work including feeding/readout. Thus the chapter is not currently missing all cycle-budget or CPU-fed-work teaching.
- Frozen basis: `facts/gte.md:430–618` (capacity/clock/admission/limits), `1082–1125` (real BLua route), `1126` onward (expanded operations and repeated PLUS evidence).

**Bounded plate task completed since this baseline:** the initial/translated
NCCT triangle frames now appear beside the complete executable program, with
their source/settings and exact projected displacement. Independent source,
image and final-print checks pass; see the GTE source/print reviews. Broader
contrasts (clipping, lighting, depth cue, affine projection behavior) still need
separately controlled programs/captures. This pair does not close all graphical
teaching. Do not republish a nominal-command count as instructions/second.

### GPU

Already explicit:
- `gpu.md:22–106`: 2 MiB shared local memory, 16-bit stored versus 32-bit input words, separate 16-word CPU/DMA ingress, coordinate/color formats, system cycles versus two command ticks, setup/issue costs, fill/copy examples and what readback's one tick does not cover.
- `941–967`: actual 1024-word rows, word/byte indexing, full-memory wrap versus nine/ten-bit Y gate, RGB555 placement and example stride.
- `885–939`: CPU/DMA ownership and block/packet distinctions. `2699–2703` explains upload supply versus command cost; `2746–2791` distinguishes pending/submitted/READY, retained reads, packing and ownership.
- `3091–3182` gives drawing-family command-cost equations and numerical threshold cases; `3185–3310` budgets issue, fence, polls, acknowledgement and return together. These are substantial positive timing facts, not just “rates unspecified.”
- Frozen basis: `facts/gpu.md:19–38,253–271,397–420,538–565`.

Concrete next paragraph tasks:
1. **Cross-unit raw image transport — finite route completed 2026-10-18:** the later complete GPU program and separately observed real-owner roundtrip close the original assignment, including header/payload counts, 16-word blocks/tails, request conditions and readiness/completion distinctions. The original CPU picture and DMA five-word fill remain unchanged. No fixed C0-to-READY latency, physical sustained rate or direct VRAM DMA aperture is claimed. See the current bounded audit above and GPU source/print evidence.
2. **Observed picture plate — bounded insertion completed since this baseline:**
   the actual `gpu_manual` frame and nine-region legend now connect raw/modulated
   textures, palette indices, bit-15 black versus exact-zero transparency and
   blending/protection to the executable packet choices. Fresh guest execution,
   independent source/image checks and final actual-print review pass. Further
   coverage comparisons were a distinct capture task. The separate
   [dither/control lesson](../book1/gpu.md#gpu-dither-output) now adds the
   same-material polygon OFF/ON comparison and two rectangle controls, a complete
   73-line BLua cartridge, the actual full output plate and forty checked packed
   GPUREAD words. It separates destination-phase quantization from texture
   traversal and display RGB; native/accelerated parity and the broader graphics
   inventory are not established by this lesson. The new
   [shared-edge/joint plate](../book1/gpu.md#gpu-coverage-output) now supplies
   the normal diagonal, moved-vertex overlap and polyline double-joint contrast.
   Its brighter, rerasterized geometry is explicitly not an enlarged pixel
   capture of the small numerical lesson. The exact three printed changes
   reconstruct the complete standalone cartridge; actual execution checks
   625 packed words across thirteen complete selected rows. This closes that
   finite contrast, not every graphics-output scenario. Final print approval
   for both new lessons is separate.

### IRQ

Already explicit:
- `irq.md:5–40`: three 32-bit ports, single pending/mask words, coalescing and accepted-write visibility; no fabricated event queue.
- `61–142`: CPU acceptance/entry state, unfiltered fresh FLAGS argument, CP0/RFE behavior, HALT predicate and why no fixed request-to-handler delay follows.
- `144–190`: installed cycle basis, ISA costs and a particular linked entry's 9/6-cycle base budgets, explicitly excluding callback and masked waiting.
- Frozen basis: `facts/irq.md:11–100,151–224,325–338`.

No distinct missing capacities/formats/clocks/throughput paragraph was demonstrated in this bounded pass. A maximum IRQ rate, independent controller oscillator or universal entry latency is not a sourced missing number. Leave source-specific event production to each owning device chapter; the eleven named bits do not substitute for those missing chapters. Reaudit when CPU/system chapters establish their shared contracts. Do not add a screenshot solely for a nonvisual latch unit.

### DMA — clearest positive omission

Already explicit:
- `dma.md:9–26`: two channels, one admitted block, 32-bit word/count/address meanings, 1–16-word blocks.
- `231–270`: request selection, block-boundary gating, actual GPU/APU/IMGDEC readiness and CPU port ownership.
- `314–393`: installed cycle basis; route-region costs; setup and mapping-span rules; additive shared RAM/cartridge versus maximum cross-region rule; RAM/cart/system-ROM examples and block round-robin contention trace.
- `282–312` and the worked cart `395–663`: DONE, IRQ, GPU marker/idle and display completion are different. Do not say these subjects were wholly omitted.
- Frozen basis: `facts/dma.md:257–307` DMT13–19, `348–425` DMP and separate completion domains.

Concrete missing paragraph assignments:
1. **Rate table for named routes:** the chapter gives cycle formulas but no usable words/s or bytes/s comparison. Convert explicitly defined admitted work by `words × 33,868,800 / charged cycles`, bytes = four times words. Compare 16-word versus 4-word blocks and a short tail for RAM→RAM, system-ROM→RAM, cartridge-ROM→RAM and RAM/cartridge→fixed GPU port. Label all as uninterrupted admitted-budget rates under stated requests/no crossing/no competition assumptions, not electrical ratings or guaranteed end-to-end rates. DMT13–17 supplies the derivation; independently replay representative substitutions.
2. **What a VRAM transfer actually is — finite route completed 2026-10-18:** the complete GPU roundtrip above supplies the raw upload/readback bridge without duplicating it here. It includes packet/payload counts, packing, READY/ownership and distinct transport/command/pixel/display boundaries. A memory-to-GP0 rate remains different from arbitrary RAM-to-VRAM completion bandwidth.
3. **Request waits and competing work in the budget:** existing prose explains eligibility and round-robin. Put the rate table beside a clear denominator statement: count admitted block costs, add actual request-starved gaps/other-channel block intervals to obtain a defined observed interval. Do not invent fixed waits or CPU-versus-DMA electrical contention. The existing two-channel trace is usable evidence and should be reused, not replaced by a new abstraction.

### APU

Already explicit:
- `apu.md:15–40`: sixteen slots, 21-word banks/staging, command/FIFO capacities, private RAM, stereo width/cadence, 768 cycles/frame and 32 cycles/transfer word.
- `235–432`: source-region/lifetime constraints; PCM mono/stereo byte stride; BADP blocks/seek/nibbles/step table; signed Q16 phase. `481–556`: Q12 gain, stereo sum/final saturation, Q14 filter/history and fade.
- `587–638`: installed rates, whole-batch visibility, exact transfer/sample ordering, cartridge-ROM upload trace including DMA DONE680 versus sample-RAM commit808.
- `640–726`: private RAM extent versus transfer offset, wrap, modes, 16-word FIFO/DREQ, CPU/DMA ownership and download's unwanted prefetch hazard. `42–79` explicitly says there is no specified per-command elapsed-cycle charge.
- Frozen basis: `facts/apu.md:241–353` APT01–20, `372–585` voice/format/rate/filter, `603–606` scope limits, `650–673` executed actual cart observations.

**Finite download companion completed — 2026-10-18:** the
[read-side lesson](../book1/apu.md#apu-download-budget) now supplies a 20-word 16+4
and a short 4-word numerical schedule: full 16-word initial prefill,17/5-cycle
RAM-bound DMA stages,12 leftover FIFO words and four-word surplus service.
STOP before/exactly at the deadline is separately source-checked and actually
executed, not inferred from the CPU program's snapshots. The complete 74-line
ordinary BLua cartridge returns all 24 expected words and preserves overlapping
sample-RAM bytes across STOP; exact status/pending/fault and fresh public-only
reconstruction checks pass. Four normal existing-suite regression cases retain
the exact STOP boundary without a new harness or publisher gate. The earlier
16-word cartlib helper route remains; no APU BIOS service is invented.
Source, execution, reader and actual-PDF boundaries are retained in the
[bounded review](../book1/reviews/apu-download-source.md). This closes the
concrete read-side teaching task, not physical fetch/DAC/electrical guarantees
or the broad technical inventory.

## Installed-unit chapter assignments and follow-ups

### IMGDEC visible indexed patch — finite lesson completed 2026-10-19

The [actual output plate](../book1/imgdec.md#imgdec-indexed-output) now uses the
existing 19-word stream and uploaded CLUT, rather than a replacement decoder
example. The unchanged four jobs retain their RAM/GP0/fault/recovery results;
the added GPU/PCRTC continuation displays the palette4 patch against a distinct
destination colour. Six source rows connect literal, repeat, back-reference
and zero tokens to visible colour and fetched-zero transparency.

The complete53+258-line two-module BLua program, exact eight printed source
parts, actual full256×192 capture, preserved26 RAM comparisons and381 raw
GPUREAD comparisons pass bounded actual-source/image and public-reader checks.
Storage4×6 halfwords,16×6 texels and the120×40 draw remain distinct. No runtime,
BIOS, compiler, publisher or harness changed. The complete current publication
proof also passes [final print](../book1/reviews/imgdec-print.md); broader hardware
and graphics completeness remain open. Evidence: [IMGDEC source review](../book1/reviews/imgdec-source.md).

### IMGDEC software-authority follow-up: repeated DONE on empty DATA read

The IMGDEC extraction found a shared, representable edge, not a mirror
disagreement: after successful completion and complete output drain, a further
eligible empty DATA read returns the retained word and runs the DONE/IRQ stop
again. The completion check has no active-state guard. Earlier return cases
are CPU access while DMA owns the read port and DMA access without BLOCK_END.

Sources: `machine/ts/machine/devices/imgdec/controller.ts:583–605,512–535`;
`machine/cpp/machine/devices/imgdec/controller.cpp:491–515,417–440`.
Paired actual-owner ACK→empty-read replays reproduce IRQ80 for both tested
successful streams; the eight malformed cases retain their fault result and
do not acquire a successful completion from that read. The chapter states the
installed behavior and exact-count read caution. No runtime change was made.

**Separate future decision:** whether terminal DONE should be a one-shot edge.
That would change both owners and needs its own implementation/validation
task. It is not an undocumented promise, a TypeScript/C++ parity failure or a
publication blocker once the current behavior is accurately documented.

### Baseline chapter assignments

**Input extraction note — precision boundary, unresolved:** the raw intensity
word decoder differs between the mirrors. TypeScript divides the unsigned
word directly (`machine/ts/machine/devices/input/contracts.ts:141–145`); native
converts to binary32 before division and exposes a binary32 output argument
(`machine/cpp/machine/devices/input/contracts.h:122–129`). With raw FFFFFFFFH,
direct current-owner checks return 65535.99998474121 versus 65536. This is a
confirmed decoder-representation difference, **not proof of a different
end-to-end vibration effect**; the receiving output boundary is not yet audited.
No runtime fix or public input chapter was inferred. Before authoring the
affected output semantics, resolve the intended representation at that owner
and audit the actual receiver; keep unaffected raw-register facts separate.

At the baseline, the catalog contained only PCRTC/GTE/GPU/IRQ/DMA/APU (`docs/manual/catalog.json:1–44` in that snapshot). Actual construction/index evidence, **not filename behavior inference**:
- `machine/ts/machine/machine.ts:58–97` constructs CPU, GeometryController, ImgDecController, SystemController and InputController in addition to documented units; paired `machine/cpp/machine/machine.cpp:14–38` confirms them.
- `machine/ts/spec/bmsx/io.ts:20–56,110–114,123–124,138–148` exposes GEO, input, system and IMGDEC register groups. These names/indices identify extraction scope only; this report makes no claim about their register behavior.
- `machine/ts/spec/bmsx/memory_map.ts:1–33` is the index for CPU/memory/bus overview extraction, not evidence that address-window size equals installed capacity.
- Cartridge controller/socket/card work remains Book II by the existing manual boundary. Naming cartridge request bits in Book I does not finish Book II.

Baseline authoring order, keeping one unit per source extraction (GEO and
IMGDEC have since been completed as noted above):
1. **GEO:** existing GTE boundary explicitly says it is separate (`gte.md:9`); an owner chapter is absent. This completes a named graphics-adjacent gap without pretending GTE covers it.
2. **IMGDEC:** another installed graphics-adjacent unit with named DMA request interactions already used in the DMA chapter. Extract its own capacities/stream/format/timing/destination ownership first.
3. **Input controller/output ports:** separate installed unit and register group, no chapter.
4. **System control/time/bus-fault interface**, then **CPU/memory/program execution** shared reference. The latter is a substantial separate scope, not merely duplicated CPU-cost notes from other chapters.

This order is editorial dependency reasoning, not a claim about an uninspected reference manual's order. Source extraction could change paragraph assignments if actual owners/specs disagree.

## Programmer foundations: address space and reserved memory

**Requested addition; open.** A newcomer must not have to infer the installed
machine's usable address space from individual device chapters. Give the
CPU/memory chapter a complete sourced address-map overview, with explicit
start/end addresses, byte units, installed capacity versus mapped window,
access permissions and ownership. Cover RAM, system ROM, cartridge windows,
shared graphics memory and MMIO without implying that every address in a
window names installed storage or that all units can access every region.

Separate these meanings rather than calling all of them “reserved”:

- Firmware/system-owned RAM versus storage available to the cartridge;
  startup contents and lifetimes where the actual boot/runtime contract
  establishes them.
- Program/readonly data/BSS, stack and other execution storage requirements,
  including who places/initializes them and which published addresses the
  cartridge must leave alone. Do not invent fixed stack/heap reservations.
- Unmapped holes, reserved address windows, unimplemented MMIO words and
  read-only/write-only ports: state the actual read/write/fetch outcome and
  bus-fault behavior, not an assumed zero, ignored write or “safe” access.
- Documented aliases/mirrors, address arithmetic/wrap, alignment and access
  width; distinguish CPU access from DMA and addressed-unit restrictions.
- Reserved/unused/retained register bits and future-use regions: use the
  actual owner behavior, not an unsupported must-zero or compatibility rule.

Include an ordinary BLua memory-placement/access example and a beginner's
startup/ownership route that connects BIOS startup, program storage, MMIO,
interrupt setup and device use. Cross-reference complete existing chapters
instead of duplicating their register inventories. Extract paired memory-map,
memory/CPU and actual boot/ABI owners before authoring; record any conflicting
ownership or missing reservation contract rather than filling gaps from
convention. Book I needs the installed address windows; cartridge socket/card
protocol detail remains Book II. This assignment is documentation/evidence
work, not authorization to redesign memory or firmware.

### Paragraph assignments for the foundations chapter

Author and independently review these bounded units separately, then merge and
perform a whole-reader check. The bounded
[map/access](../book1/facts/memory-map.md),
[boot/linker/storage](../book1/facts/memory-boot.md) and
[installed construction/reset](../book1/facts/memory-lifecycle.md) extracts
have independent source acceptance with explicit withheld ranges and gaps;
see [the source review](../book1/reviews/memory-foundations-source.md).
None is yet a published, complete cartridge-memory contract. The separate
files let each paragraph author receive its own relevant facts, not a whole
architecture document or an invented stack/heap layout.

1. Byte addresses, words, endian order, intervals and installed versus mapped size.
2. Installed memory map, holes and the cartridge-bus boundary.
3. Reservations versus cartridge ownership: MMIO, GEO and firmware/static storage.
4. Executable/readonly/DATA/BSS placement, linking and initialization.
5. Reset, BIOS startup and cartridge handoff, including inherited state.
6. Actual BLua typed storage, pointers, calls and dynamic-value storage.
7. Scalar loads/stores, alignment, MMIO widths and side effects.
8. Instruction fetch, execution domains and access permissions.
9. Fault inspection, acknowledgement and CPU-visible delivery.
10. Hardware-shared buffers, admission and lifetime, with device cross-references.
11. A complete executable cartridge start explaining every reserved location used.

**Working manuscript progress:** [Memory and program storage](../book1/memory.md)
now exists as a catalogued **DRAFT**, not a published/complete foundation.
Separate authors supplied map, reservation/placement/startup and typed-BLua
sections; nonauthors checked their exact claims against primary owners. The
complete two-module memory-only program is printed, independently validated
and executed with the ordinary guest case. It uses actual linked DATA/BSS/
RODATA, typed scalar views and a single count constant, not guessed RAM or
a Lua register-table facade. See [the manuscript review](../book1/reviews/memory-source.md)
for the bounded evidence and remaining route gaps. The separate
[typed-storage](../book1/facts/memory-storage.md),
[fault-interface](../book1/facts/memory-faults.md) and
[worked-example](../book1/facts/memory-example.md) sheets extend, rather than
replace, the original ownership-specific extracts. No new publishing layer
or runtime/compiler/firmware change was added.

The worked program also exposed a concrete newcomer teaching boundary:
named-static-array `#` support is not an accepted constant-module export
expression. The accepted representation uses one numeric const for both
dimensions and its exported count. Keep this distinction in the BLua teaching
contract; do not silently fix the compiler or replace it with ordinary Lua.

**Bounded newcomer-route continuation completed:** the separate
[first-build companion](../programming/getting-started.md) now explains exact
file/module/entry/manifest roles, build commands, result checking and ordinary
playback. Its precise commands were executed; the original storage case still
passes. This is an existing-checkout first build, not fresh-platform setup,
whole SDK/debugging coverage or test/production address identity.

The independent public-only reader's concrete R1–R3 findings are now resolved
within this route: the companion also gives the supplied fault project's
interactive browser launch, readable FIT presentation and real keyboard input;
the exact named DMA result check; and the chapter's isolated pre-transfer
fault-record baseline/ACK/attribution procedure. Root actually exercised the
browser/keyboard route and reran the DMA case; a separate reader reconstructed
the amended instructions without sources. First-pending attribution limits
remain hardware limits, not an invented automatic isolation or counter API.

**Firmware VRAM reservation completed within its stated scope:** the chapter
now teaches the real `gpu/system_vram_region` call and word-column/row units.
Independent extraction, current atlas-producer replay and an actual imported
BIOS call confirm the current 216 × 12 atlas and 320 × 252 bounding region.
The configured maximum is not the emitted extent. Preserve the entire queried
region across handoff; no protection, release, complement-free arena or pixel
restoration is promised. See [the VRAM facts](../book1/facts/memory-vram.md).

**Installed fault inspection and DMA lifetime completed within their scopes:**
an ordinary unmapped-load cartridge and real BIOS keyboard commands establish
DBE, Memory CODE/ADDR/ACCESS, saved-report clearing and unchanged-EPC retry.
The unmodified captured output is printed beside the exact program; 20 input/
latch assertions pass. This does not supply a successful repair handler.
Separately source-checked DMA preparation/capture/live-read/wait/check/reuse,
overlap and non-successful DONE behavior now link to the complete DMA program;
its actual copy/completion case was rerun successfully. Other units' lifetimes
do not follow from DMA. See [the current source review](../book1/reviews/memory-source.md)
for precise evidence and the remaining scope.

**Device-specific buffer contracts added within bounded scopes:** GEO now
separates captured job configuration from live addressed inputs, destructive
busy-command rejection, retained partial output and local versus central ACK.
GTE PLUS separates captured operands and pending publication from RAM payloads;
its existing normal geometry cartridge is not a PLUS execution test. IMGDEC
separates input-source release, decoder/output drainage and output-DMA completion,
including shared DATA and partial-stream/reset hazards. APU separates private
sample storage, queued descriptors, retained nonexclusive voice references,
live source rebinds, upload commit and download prefetch cancellation. Preserve
all remaining shared uses before reuse; none is a free-buffer allocator.
Independent source checks and actual supplied GEO/IMGDEC/APU result-command
executions are recorded in [the source review](../book1/reviews/memory-source.md).
Numeric geometry is not the requested dummy-game plate, and APU result checks
are not audible evidence. No runtime or publishing machinery was added.

**Shared graphics storage continuation:** separate fact extraction and source
review now establish copied packet/payload versus live texture/CLUT/copy uses,
programmed versus retained display selection, and the limits of GPU IDLE,
readback, DMA DONE and VBlank. A complete 132-line entry plus its 16-line typed
result module prepare two disjoint GX16 regions, display A then B, rebuild A
while B is selected and display A again. All four retained GPUREAD words and
three fresh callback observations pass; actual ordinary red/blue/green plates
are checked independently against every source-derived pixel. This teaches
conditional reuse, not a general allocator, all-reader release or supervisor
restoration contract. PCRTC partial-upload wording now counts assembly-consumed
retained payload, not merely FIFO-admitted words. See the source/print reports
for the current acceptance scope; no runtime or publishing changes are included.

**Open at that stage; superseded by the later bounded continuations:** complete call/permission/dynamic/string-byte contracts;
global shared-VRAM allocation and supervisor/multiple-reader ownership;
privileged supervisor/context,
successful fault recovery and coordinated cancellation/terminal/reset policy;
inherited device state; remaining access/instruction timing and cross-unit
budgets; broader SDK/live inspection and whole-reader acceptance. The current
DRAFT's actual-page inspection is recorded separately in
[the print report](../book1/reviews/memory-print.md); these gaps and final
publication review remain explicit. Do not equate successful result checks or
a longer PDF with full memory/book coverage.

Do not substitute a language value-slot stack or a logical heap accounting
budget for a byte-addressed RAM allocation. Do not infer free-memory rights
from mapped read/write access, or DATA/BSS initialization from arbitrary EXEC:
the generated startup is a distinct producer/edge. Each missing ownership,
fetch, allocation or device-inheritance fact still needs its named owner before
the relevant paragraph can be completed.

### Bounded producer-representation follow-ups

The boot/storage source audit found two arithmetic representation differences
outside the currently established ordinary-image/configuration scope:

- Cartridge image-address addition: `execution_address_space.ts:93–95` retains
  the numeric base-plus-offset sum; `execution_address_space.cpp:73–75` returns
  a u32 field. For base `10000000H` and offset `FFFFFFF0H`, isolated expression
  checks yield `10FFFFFF0H` versus `0FFFFFF0H`. Full paths are under
  `machine/ts/machine/` and `machine/cpp/machine/` respectively.
- Supplied RAM below the logical heap reservation: TS
  `machine/ts/machine/cpu/lua_heap.ts:19–22` subtracts numerically, while native
  `machine/cpp/machine/cpu/lua_heap.cpp:11–13` and `lua_heap.h:23,41` use `size_t`.
  A supplied `40000H` minus `80000H` is negative in the former and wraps in the
  latter; this is not the ordinary installed RAM count.

Withhold unqualified mirror-equivalence claims for these input ranges. Audit
the actual image/configuration producers and downstream consumers before
claiming a valid cartridge-visible difference or deciding on a runtime change.
Neither finding proves such an effect, authorizes a fix/fallback, or blocks
unrelated sourced chapters. They are not invented hardware guarantees.

## Real graphics-capture leads — backlog remains open

### GEO: dummy-game scene, sprites and convex hulls

**Bounded addition completed.** A separate ordinary BLua docking scene now
supplies actual textured drones, explicitly authored octagonal hulls, local
origin/pivot, transformed world outlines and controlled separated/touching/
overlapping poses. Five unmodified actual plates connect the complete program
to its inputs/results. A sixth separated-return capture is identical to the
separated plate: retained old contact bytes are not valid after the new count0.

The complete three-module,577-line listing and public build/result/capture
route teach Q16 XFORM→SAT dependency, separate F32 contact storage, normal
conventions, touch versus positive overlap, point validity, a real depth bracket,
raw GPU texture/line packets, disjoint VRAM and fresh-after-write VBlank. GEO
still produces geometry/results, not a rendering mode. The yellow depth span
is16pixels; the24pixel direction arrows are explicitly not depth measures.

Independent current-owner replay14vectors and existing156vector parity pass;
full cart validation, retained suite and separate ordinary playback pass.
Independent source, public-only newcomer and all-six-image checks pass, and
the original 44-page edition was inspected with its four-page correction
rechecked. The complete current hardware-only 45-page proof also passes
[final print](../book1/reviews/geo-print.md). See
[the scene acceptance](../book1/reviews/geo-scene-source.md). No new publisher/capture
framework or runtime repair was added.

This closes the requested controlled dummy-scene/sprite/hull illustrations,
not arbitrary winding/rotation, general collision-response physics, other
GTE/GPU/PCRTC contrasts, electrical bandwidth or whole-manual completeness.

### Initial GTE/GPU capture leads

The following files were present but not freshly executed or visually approved
at the baseline inventory:
- `tests/carts/gte_manual/screenshots/frame_00001.png` and `frame_00002.png`; actual test capture calls at `tests/carts/gte_manual/gte_manual_assert.lua:51–70`, with initial/transformed projected coordinates checked before each capture. Producer: `carts/gte_manual/cart.lua`; documented reproducible commands `carts/gte_manual/README.md:101–115`.
- `tests/carts/gpu_manual/screenshots/frame_00001.png`; capture call `tests/carts/gpu_manual/gpu_manual_assert.lua:31–37`, producer `carts/gpu_manual/cart.lua`; commands/scope `carts/gpu_manual/README.md:60–72`.

Existing commands, no new capture implementation:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- gte_manual --debug
npm run headless:test -- gte_manual tests/carts/gte_manual/gte_manual_assert.lua
npm run build:toolchain:cart -- gpu_manual --debug
npm run headless:test -- gpu_manual tests/carts/gpu_manual/gpu_manual_assert.lua
```

`package.json:44–45` owns the headless-tooling/test entrypoint. Fresh execution, actual image inspection, a readable crop/scale for the publication, exact source/settings/capture provenance and complete final-PDF inspection remain required before embedding. An already existing capture filename is not that evidence. These leads do not close the broad request for explanatory actual graphics outputs.

**Subsequent preparation:** the ordinary GTE and GPU cartridges and cases have
now been rebuilt/run with current product and BIOS; all cases pass and all
three native 256×192 PNGs were individually viewed. The GTE pair is the NCCT
gradient triangle from the complete cartridge, shifted 16 screen units by
TRX 0→32, not the separate solid-red worked packet. Its unmodified PNG assets
are now included beside the printed executable program. Bounded facts-only
authorship, independent caption/source/image checks and the complete final
print review pass; see [the source review](../book1/reviews/gte-source.md) and
[print review](../book1/reviews/gte-print.md). The publisher uses ordinary PNG
images beside existing SVG figures, without a new capture or approval framework.
The GPU plate now also has its unmodified PNG, captioned nine-region legend,
independent merged-source/image acceptance and final actual-print approval;
see [its source review](../book1/reviews/gpu-source.md) and
[print review](../book1/reviews/gpu-print.md). Further GTE/GPU contrasts,
other PCRTC contrasts remain open. The separate GEO scene is now accepted
above; these bounded examples do not close the broad illustrations or
technical audit.


## Display-result observation follow-up

The new two-surface ordinary cartridge produces the sourced red/blue/green
poses, including a config-only final FBP switch, through the existing ordinary
presentation timeline. Its retained-word integration case is a separate check,
not visual proof. Initial fixture captures retained the earlier blue image;
adding a completed tick did not repair it and was removed, not promoted to a
hardware delay or forced redraw requirement.

Narrow source diagnosis identifies a pending-presentation commit flag overwritten
by a later unchanged tick (`hosts/common/presentation_state.ts:65–69,115–126`),
while fixture capture requires a later tick before presenting
(`ide/testing/fixture_operations.ts:72–77`). The resulting held-image capture can
succeed without committing the config-only new game image. A separate possible
suspended-execution/VBlank receipt loss was identified but not traced as the
recorded collision. Preserve both boundaries in a dedicated owner-level audit;
no runtime/harness repair or new capture framework is part of this manual slice.
Evidence: `/tmp/bmsx-memory-display-fixture-publication-diagnosis.md`. Accepted
manual plates come only from the separately executed ordinary-ROM timeline.

## Call and text programming: software-authority boundaries

The language-foundation extraction found two facts that must not become an
invented common ABI. Cartridge-source parsing removes parenthesized-expression
wrappers (`toolchain/ts/lua/syntax/parser.ts:1345–1349`), whereas the installed
on-console parser marks a parenthesized call non-expanding
(`machine/bios/compiler/parser.lua:177–183`, consumed by
`compiler.lua:652–656,1152–1155`). The normal cartridge example and existing
on-console call-result cases establish the distinct current routes; do not
publish one all-BLua parenthesis rule or change either producer as a
documentation patch. Full on-console source-loading contracts remain a
separate reference task.

For a representable function record with `maxStack = 0`, TypeScript clears
`max(maxStack,1)` reserved slots (`machine/ts/machine/cpu/cpu.ts:3175–3183`),
while native reserves that capacity but clears only `maxStack`
(`machine/cpp/machine/cpu/cpu.cpp:3022–3028,3099–3105`). Producer reachability
and downstream effects are not established by this source observation. Retain
it for an owner-level audit, not a universal slot-clearing guarantee, invented
byte stack or runtime repair in this manual slice. Private value encodings are
also not a shared raw slot ABI; the newcomer route teaches language values,
numeric addresses and typed byte storage separately.


**Bounded language-foundation progress:** Memory now teaches ordinary values
versus typed bytes, function arguments/results and BIOS call binding, captured
locals, codepoints versus UTF-8 bytes, and the existing decoder's input limits.
A complete two-module BLua program retains 35 checked words; its public route
includes exact source/manifest paths and commands. This closes the local
newcomer call/value/text teaching gap, not the complete BIOS signature,
on-console loading/environment, CPU instruction/timing, privileged context,
interrupt setup, inherited-device or recovery contracts. Those remain
paragraph/reference assignments under the reader acceptance target above;
passing this example is not whole-console acceptance.

## INPUT: raw interface and attachment boundaries

The new INPUT draft now covers all 47 mapped words, one-shot ARM/STATUS
sampling, read-only snapshot storage, HID/pad/pointer bit layouts, signed
16.16 words and the independent output request. A complete ordinary BLua
program copies all 41 sampled words before re-arming and derives keyboard
edges from retained levels. Its derived integration case passes for held and
released KeyA and separate first-pad A; six TS owner cases and the rebuilt
native target's three checks pass separately. These are bounded execution
results, not physical peripheral timing, native execution of the new cartridge
or whole-console acceptance. Final source/reader/actual-page decisions are
recorded in the INPUT review files, not inferred from these tests.

The baseline output-precision note above now has a narrow receiver audit.
Native Libretro clamps decoded intensity before its 16-bit motor strength
(`hosts/libretro/input.cpp:557–580`); the TS common route forwards unchanged
(`hosts/common/input/manager.ts:206–212`,
`hosts/common/input/player.ts:56–60`, `hosts/common/input/gamepad.ts:221–222`). Existing browser routes forward magnitudes or multiply
duration by intensity (`hosts/browser/input.ts:76–95`,
`hosts/browser/onscreen_gamepad.ts:154–155`). Thus the FFFFFFFFH decoder
precision difference is masked on the inspected native path, not proved
unobservable everywhere. No physical output or intended common saturation
rule is inferred. Raw 00000000H–00010000H request values decode exactly and
identically; the full-word output representation remains a separate owner task.

Further source-defined attachment gaps are now explicit:

- Common pointer origin, display transform and scale are not established:
  browser forwards client coordinates (`hosts/browser/input.ts:448–458`),
  whereas native maps/clamps to viewport extents
  (`hosts/libretro/input.cpp:126–131,289–303,355–372`).
- Wheel source quantities differ: browser deltaY (`hosts/browser/input.ts:580–590`) versus
  native down-minus-up counts (`hosts/libretro/input.cpp:371–375`). The raw
  retained word is not an accumulator over skipped ICU samples.
- The raw latch does not define common stick calibration/dead zones, trigger
  actuation or continuous analog-trigger refresh. The inspected native path
  normalizes sticks and supplies digital trigger values, while the browser
  path forwards axes and reports trigger values on pressed/released changes
  (`hosts/libretro/input.cpp:120–124,217–240,260–270`;
  `hosts/browser/input.ts:104–141`).
- The central signed Q16 decoder also has different numeric precision
  (`machine/ts/machine/common/numeric.ts:43–45` versus
  `machine/cpp/machine/common/numeric.h:46–48`). That is not a change to the
  raw signed16.16 format: INPUT copies those bits directly. Do not teach an
  exact shared full-word helper-result ABI or infer a guest-visible
  calibration outcome without auditing its actual consumer.

Keep these contracts open in the coverage record. None authorizes a runtime
repair, new input facade, clamp, fallback or invented physical guarantee in
this documentation slice. The requested bounded GEO plates are now accepted;
remaining graphics contrasts, installed CPU/system contracts and Book II are
still whole-manual work.

## SYSTEM chapter: installed control, timing and console route

The new SYSTEM chapter now has a complete thirteen-word reference, actual
current-mode privilege rules, separate snapshot/publication and CPU/device
return edges, raw cause/domain/reason meanings, reset request consumption,
TIME/FRAME/CYCLES representations and diagnostic queue/flush behavior. Its
selected-device context table distinguishes retained registers/assembly from
shared RAM/VRAM, GEO completion from IMGDEC batch quiescence, and the APU voice
hold from sample transfers. Facts are separate controller, CPU, firmware and
per-device boundary extracts, not imported reference-console addresses.

A separate author supplied each control, time/output and complete-program
section. The ordinary BLua example uses the existing elapsed-clock helper,
172-byte typed BSS and actual BIOS globals; its31+73 printed source lines match
the executable modules. The retained integration case and ordinary diagnostic
run pass. A separate real-request/read-only observation checks normal
STATUS0→5→0→5, restored MASK4, advancing time and no fault publication. These are
bounded normal routes, not native cartridge parity, arbitrary repaired-fault
continuation, all-state preservation or a complete CPU/BIOS reference.

**Separate CPU-owner audit, not a documentation-side repair:** simultaneous
yield plus HALT/hard-halt/blocked state has different direct-run-loop ordering.
`machine/ts/machine/cpu/cpu.ts:1809–1816,1874–1881` consumes yield first;
`machine/cpp/machine/cpu/cpu.cpp:2391–2399` returns halted before consuming yield.
The runtime wrappers separately gate held/halted execution. The finding does
not establish guest reachability, a cartridge-visible effect or the intended
common precedence. The chapter withholds that rule; no runtime fix, fallback,
rollback, new harness or common precedence is inferred from the green suites.
Both locations and scope are retained in `facts/system-context.md`.

The broader newcomer acceptance target remains whole-console programming
without reverse engineering. Complete CPU instruction/timing and on-console
source-loading/environment contracts, remaining graphics contrasts and Book II
remain work; one correct SYSTEM chapter cannot close them. Source/reader/actual
PDF decisions for this chapter are recorded separately in its review files.

## CPU instruction reference and executable numerical route

The new CPU draft separates ordinary values from numeric scalar transfers and
contains all64 opcode identities in numeric/value, call/object and memory/
control families. Three nonoverlapping authors wrote from separate live paired
facts; the source-operator addendum comes from the owning ordinary cartridge
lexer/parser/compiler, not stock Lua assumptions. The complete two-module
`cpu_manual` cartridge uses typed BSS, actual BIOS `print`, f64/f32/word/byte
views, calls and a surviving mutable capture. Its26 retained observations pass;
ordinary playback separately emits the documented three lines. Twelve raw
paired CPU programs additionally produce13 identical value/charge rows. These
are bounded execution facts, not native execution of that cartridge, every
instruction, physical throughput or complete on-console source loading.

**Do not close publication by narrowing away these source disagreements:**

- **LOADKR exceptional index boundary:** TS Number(B) is passed unchanged to
  typed constant-array indexing (`machine/ts/machine/cpu/cpu.ts:2802–2809,
  3517–3529`); native first casts to size_t
  (`machine/cpp/machine/cpu/cpu_dispatch.inl:719–721`). Existing nonnegative
  integral pool indices agree. A common coercion/fault contract for other
  representable values has not been established.
- **LOADNIL zero-count frame top:** TS performs an empty loop and does not
  change top (`cpu.ts:2337–2341`); native always raises top to at least A+B,
  also for B0 (`cpu_dispatch.inl:16–21`). Both write no values, but a following
  open-argument/return operation cannot be given a common top guarantee from
  these two bodies. Ordinary producer reachability is not proved absent:
  compiler `emitLoadNil` emits LOADNIL for every count except1
  (`toolchain/ts/lua/compiler.ts:3132–3138`); checking that helper alone is not
  an audit of its callers.
- **Scalar C outside0..5:** the six-entry alignment table and scalar switch
  do not define a common machine result. TS directly indexes an absent entry
  and has no scalar switch default (`cpu.ts:2996–3002,3026–3045,3052–3077,
  3082–3114,3119–3149`); native has unchecked array access and unreachable
  LOAD switch tail (`cpu_dispatch.inl:556,562–569,581,591–598,623,629–636,
  648,658–665`). Do not invent a reserved-kind trap, no-op, zero result or
  fallback. Counted-store C is a word count and is not this scalar-kind case.
- **Top-of-address-space sequential/skip PC:** TS adds full byte width as an
  ordinary Number (`cpu.ts:1842–1854,1994–2004`); native adds to u32
  (`cpu.cpp:1008–1017,2465–2479`). Branch-target decode explicitly wraps in
  both. A universal modulo32 sequential/skip PC claim is withheld pending the
  owning-boundary audit, not inferred from the branch contract.
- **maxStack0 clearing** and **simultaneous requested yield/HALT precedence**
  retain their already recorded exact paired locations above. No reachability,
  visible effect or intended common repair is invented here.

These are specific owner/spec decisions, not style complaints or a reason to
rewrite the interpreter during documentation work. The instruction reference
uses proven common domains and records the open contracts separately. Source,
public-reader and actual-PDF reviews are separate records; a green build does
not silently approve any of these stopped claims. Complete BIOS signatures,
on-console source loading/environment and whole-console connected workflows
remain separate manual work, together with the earlier graphical contrasts
and Book II socket/card hardware.

## CPU value-reference expansion and seventh owner question

Three facts-only paragraph authors separately expanded default finite Number
text conversion, POW special outcomes and Table keys/metatables. The formatter
reference specifies the actual ordered binary64 normalization, computed-value
nearest-even rounding, carry-before-notation and exponent spelling. It does
not substitute ideal decimal %.6g:123456.5 actually prints123457. The POW tables
separate zero/NaN/infinite-exponent precedence, both signs of special bases,
represented exponent parity and range limits. Table facts distinguish nil-key
faults from missing admissible keys, NaN-key matching from numeric equality,
false from absence, own mappings from table-only inherited reads, and the four
actual BIOS table globals with their full ordinary-source arity.

The complete second ordinary cartridge supplies136 printed source lines and68
retained observations. Its actual BIOS playback separately emits all20 expected
diagnostic lines. Existing POW/Table tests and current native CPU/Table targets
pass. A bounded direct paired run gives174 common numeric rows. These results
are not native execution of the cartridge, exhaustive finite-power accuracy,
all fault routes, or a general Table-length guarantee. Independent nonauthor
source, public-only newcomer and actual-PDF checks remain separately recorded;
no publisher/framework/runtime/BIOS/compiler change was needed.

**New STOP, proven by actual CPU execution:** generic numeric SETT boundary
refill differs across array/hash capacity. After NEWT array4/hash8, SETT keys1..5,
delete2 and refill2, the same LEN program returns5→1→5 in TS versus5→1→4 native,
both33 charged cycles; key5 remains50. TS general write uses the cross-hash
scanner (`machine/ts/machine/cpu/table.ts:801–812,1426–1440`); native SETT calls
its numeric fast setter then the array-only scan
(`machine/cpp/machine/cpu/cpu_dispatch.inl:152–161`,
`machine/cpp/machine/cpu/table.h:36–43,172–184`). Native SETI instead uses its
cross-hash scan (`table.h:53–59,186–195`). Exact source/disposition and bounded
replay are retained in cpu-table-semantics and cpu-values-execution facts.
This is a seventh paired-owner contract question, not an editorial repair,
workaround recommendation or permission to promise universal prefix length.

Finite default text and special-base POW coverage are now expanded. Complete
Table-length publication still awaits its owning decision; the manuscript
exposes rather than narrows away the disagreement. The six earlier owner
questions remain open. The separate protected-call/coroutine chapter now covers
those eleven installed interfaces. Remaining public builtin/BIOS and on-console environment
references are the next independent source tasks.
Remaining graphics teaching contrasts/output and Book II remain on the broader
manual list. Whole-console newcomer acceptance has not been claimed.


## Protected calls and cooperative threads

The new chapter covers installed `error`, `pcall`, `xpcall` and all eight
`coroutine` functions. Separate facts-only authors wrote the protected-call and
lifecycle references. It teaches value identity and nil positions, nested success
flags, handler validation and failure, ordinary bare-return/fallthrough nil,
thread states, resume/yield tuples, failed-close reporting, surviving captures,
wrapper cleanup, exception boundaries and incremental—not total—cycle charges.
A transfer diagram follows the actual example, not a parallel CPU or time scale.

The complete ordinary cartridge supplies135 literal source lines,40 retained
observations and17 separately observed BIOS diagnostic lines. Existing22 TS
cases and30 paired O0/O3 vectors pass. Nine additional bodies at both optimization
levels give18 true completions and equal decoded final snapshots through the
existing per-grant save/restore route; this is not raw encoded-byte equality,
native execution of the ordinary cartridge or exhaustive exception/GC coverage.

An independent source audit rejected the initial claim that a non-suspended
wrapped resume never performs cleanup. The BIOS checks retained Failed state
after any false resume, including rejection of an already-failed target. The
corrected text distinguishes the newly returned rejection value from the older
retained body error that cleanup clears. A separate paired vector confirms the
case. The correction changes documentation only, not the BIOS or runtime.
Source, public-only newcomer and actual-PDF decisions are recorded separately in
[the chapter reviews](../book1/reviews/coroutines-source.md).

This closes the assigned protected-call/cooperative-thread reference, not the
whole BIOS or the CPU's seven outstanding owner questions. The finite inventory
in [firmware-surface](../book1/facts/firmware-surface.md) divides the next work into
base conversion/iteration/globals, table/string, math/os, source loading and
environments, actual exported BIOS imports/cartlib, compiler/privileged forms,
and installation lifetime. Each still needs owner facts, authored reference and
executable programming coverage; private firmware imports and descriptor gaps
must not silently become invented cartridge APIs. Graphics contrasts, Book II
and whole-console newcomer acceptance remain open.


## BIOS base-service reference and source-producer boundary

A separate chapter now supplies the twelve remaining installed base globals:
assert, rawequal, type, tostring, tonumber, next, pairs, ipairs, select, getglobal,
setglobal and print. Together with the CPU's four metatable/raw-access names
and the protected-call chapter's three globals, all nineteen installed base
names now have reference locations. This is name/reference coverage, not closure
of the stopped Table-length contract or the complete installed libraries.

Two facts-only authors separately wrote value/conversion and traversal/tuple/
global/output sections. The reference supplies exact numeral grammar, ordered
binary64 digit/fraction/exponent arithmetic and termination limits; iterator
factory versus step faults, stored versus inherited reads, nil result counts,
signed-word selector conversion, live global writes, mutable/captured dependencies,
actual codepoint diagnostic transport versus byte history, and incremental—not
total—alias charges. Source/reader/actual-PDF decisions remain separate records.

The ordinary two-module cartridge has143 literal source lines,37 retained
assertions and17 separately observed diagnostic lines. Three long source
statements were wrapped in the actual program and the complete toolchain,
retained case and ordinary image were rerun, not just shortened in the printed
listing. No publisher, runtime, BIOS, compiler, cartlib or shared-harness edit
was needed. Nine bounded supplemental bodies at both O0/O3 pass18 native/TS
comparisons with decoded snapshots; their empty console dependency is explicitly
not output evidence. Ordinary diagnostic evidence uses the real installed BIOS.

**New source-producer question, not runtime-mirror disagreement:** the same
observation program formats literal `-0` as `-0` at O0 but `0` at O3; both owners
agree at each level. Parsed negative zero still formats `-0` at both levels,
and literal reciprocal `1/(-0)` still formats `-inf` at both. This is not a
universal optimizer algebra rule or workaround recommendation. Exact producer
locations and the bounded/not-fully-traced cause are recorded in
[bios-base BZ01](../book1/facts/bios-base.md). Do not erase the finding by narrowing
all probes to values that pass; no compiler repair is authorized by this slice.

The seven earlier runtime-owner questions remain open. The remaining BIOS work
is table/string, math/os, source loading/environment and syntax authoring,
actual exported firmware/cartlib interfaces and install lifetime. Remaining
cross-unit graphics contrasts, Book II and whole-console newcomer acceptance
remain on the manual list. Page counts and green cases do not close these tasks.

## BIOS table-library procedures: reviewed draft, not a closed length contract

The next bounded assignment covers all six installed table-library functions.
Two facts-only authors separately cover counted tuples/ranges and mutations/
sorting; a third supplies the complete ordinary31+73-line program. Default
append, remove, concat, unpack and sort paths remain present. The text does not
silently replace all length-dependent calls with an explicit packed count.

The reference explains actual nil-result widths, ordinary inherited reads
versus direct own writes, floor/negative/zero/NaN range normalization, unusual
insertion/removal positions, arbitrary separator conversion, comparator truth
versus a three-way result, prescan, original error identity and surviving swaps.
Nonnumeric positioned insert/remove do not receive a fabricated arithmetic
exception: the numeric-for producer has no comparison-driven exit for their
NaN positions. Exact source mechanics and the bounded noncompletion observation
are retained separately from successful finite recipes.

The ordinary example passes30 retained assertions and separately emits14 real
diagnostic lines. Nine supplemental bodies at O0/O3 produce18 true completions
and equal decoded native/TS snapshots; their console fixture is not ordinary
output evidence. The initial uncompleted wrong-position experiment is preserved,
not counted as passing or silently discarded. No runtime/compiler/BIOS repair,
publisher layer or shared harness was introduced.

**Publication remains blocked.** The existing generic SETT/rawset refill
disagreement still stops the common maintained-length producer contract. Naming
its initial result L does not close default/relative ranges, sort extent or
post-mutation length. See [the draft's source index](../book1/facts/bios-table.md)
and its explicit open coverage. The seven runtime-owner questions and separate
BZ01 compiler question remain open. String/math/os, source loading/environment,
actual exported BIOS/cartlib, install lifetime, remaining graphics contrasts
and Book II remain work, not completion by name count or page count.

The acceptance test remains the user's whole-console requirement: an experienced
programmer new to BMSX must be able to control every hardware operation from
the manual without reverse-engineering implementation or examples. A locally
usable API chapter, a complete program or a passing test is evidence for that
slice only; it is not a substitute for the complete cross-unit reader route.

The contract and complete-program source reviews pass within their stated
scopes; the newcomer reading pass closes the missing prerequisite-build steps
without claiming fresh SDK installation. All11 actual draft pages pass final
individual-page inspection. That inspection caught a real truncated value:
unescaped Markdown pipes had turned `10||30|` into extra table cells. The cell
is corrected and the authoring guide now warns about this ordinary Markdown
syntax hazard; no new publisher validation was added. The exact accepted draft
artifact and all scope limits are recorded in the chapter's separate reviews.

## BIOS String base operations: codepoints and mapped input

The next bounded chapter covers all nine actual base exports of the installed
`string` global: byte, char, len, upper, lower, sub, reverse, rep and from_utf8.
Two facts-only authors separately supplied scalar/mapped-input and wrapper
reference sections. The source index distinguishes aliases from ordinary
procedures, codepoints from UTF-8 bytes, signed/U32 word conversion from floored
relative bounds, ASCII-only mapping, non-String passthrough branches, captured
calls from still-live transitive globals, and lead-driven mapped reads from a
validating UTF-8 parser. The 256-codepoint decoder staging is not an input-size
limit; a declared byte count is not a continuation-read barrier.

The complete ordinary two-module program supplies37+95 literal source lines,
32 retained scalar assertions and9 separately observed real BIOS diagnostic
lines. It uses typed readonly bytes and caller-owned BSS, no local codec. The
257-byte example rewrites its first input byte after decoding and observes that
the returned text still contains the earlier codepoint while storage readback
shows the new byte. Seven supplemental bodies at O0/O3 supply14 true completions
and equal decoded native/TS final snapshots through the existing grant/save
route. Their empty console fixture is not ordinary diagnostic-output evidence
or native execution of the complete cartridge.

**This chapter remains a draft.** Accepted Table inputs to len, case mapping,
sub and reverse still depend on the stopped common SETT/rawset length producer.
Calling the cached result L or restricting examples to Strings does not close
that contract. All seven runtime-owner questions and separate BZ01 compiler
question remain open. Pattern matching, format and binary packing are separate
remaining String interfaces; math/os, source loading/environments, exported
firmware/cartlib interfaces, installation lifetime, graphics contrasts and
Book II also remain work. No runtime, compiler, BIOS, cartlib, publisher or
shared-harness repair was introduced. Independent contract/program-source,
public-reader and actual final-PDF decisions pass within their recorded bounded
scopes. All12 final draft pages were individually inspected; the source and PDF
hashes are retained in the print review. These decisions are not inferred from
the successful program and do not approve the provisional book classification.

The user's acceptance target remains whole-console operation by a programmer
new to BMSX, without implementation or example reverse-engineering. This
bounded library reference and its execution evidence do not constitute that
whole-manual acceptance.


## Booklet structure and naming: reference review and working map

Requested2026-10-18. The [bounded reference review](booklet-structure.md) now
compares all five supplied MSX-related PDFs, original SNES Books I/II, the N64
programming/function-reference collection and separate Sony hardware/library
manuals. It distinguishes originals from the reworked V9938 edition, consumer
instructions from service/developer literature, and parts from physical books.
NES manufacturer developer-manual structure remains explicitly unverified.

The selected map is now applied: I System and Hardware Reference, II BLua32
and BIOS Reference, III Cartridge and Expansion Reference, plus the existing
development companion. At adoption, four software chapters were assigned to II
and twelve machine chapters to I. The later source-program, Math draft and System
overview additions bring the current catalog to nineteen: six in II and thirteen in I.
CPU/Memory remain the canonical mixed foundations, with explicit
software-reader section links rather than blind moves or duplicate definitions.
Shared title metadata drives both document and running identification. Current
IRQ/DMA cartridge references are corrected to III. Stable source paths and
chapter identities remain unchanged; no publisher framework or runtime repair
was introduced. Changed PDF titles receive separate print revalidation, not
inherited old hashes. Technical source reviews, owner questions, unwritten
material and whole-console newcomer acceptance remain unchanged; classification
is not completion.

All sixteen adoption-time preview chapters were rebuilt and every actual page was
individually inspected at readable PDFium resolution. The new titles fit;
three cartridge cross-references were corrected to III. Inspection also found
stranded GPU/GTE table/formula leads and one paragraph tail; existing authored
keep-together markup resolves them without changing technical words, smaller
type, CSS or publisher special cases. Exact artifact hashes, final changed-page
inspections and pixel-identical retained-page evidence are in each chapter's
print report. The original false public print flags for Memory and Input remain
false; no factual/coverage stop was cleared by relabeling. The shared publisher's
nineteen tests pass. The eleven chapters with closed publication gates also
have regenerated canonical PDFs: an independent final-PDF delta audit viewed
all changed bodies and each first page, checked all current rasters against the
PDFs, and accounted for retained pixels against the accepted proof/preview.
Current publication hashes and bounded inspection scope are in the same print
reports. The other five chapters remain drafts; no gate was bypassed. These are
bounded classification/layout results, not whole-manual acceptance or completion
by page count.

## Installed String formatting: current software, not assumed Lua semantics

The String chapter now adds the separate `string.format` interface: complete
conversion grammar and argument order, flags and padding, integer and floating
construction, quoted text, live/captured dependencies, errors and work limits.
The default six-significant-digit numeric-text dependency is not a universal
printf-decimal-accuracy promise. A separate complete27+69-line ordinary BLua
cartridge supplies18 retained assertions and8 independently observed diagnostic
lines. Its compact examples demonstrate useful fields/stars as well as actual
counterexamples: `%.0f` at1,000,000 returns `1e+06`, a missing signed integer can
yield empty digits, and numeric-looking width text is not parsed.

Execution contradicted the first source-sheet assumption that parentheses in
`char((modf(value)))` force one result. The existing cartridge/system source
parser removes grouping, the final-call lowerer expands the two `modf` results,
and both char owners consume every supplied codepoint. The installed `%c`
therefore produces a two-codepoint String in the verified cases, not two format
return values or two consumed format arguments. The corrected section and
example follow that actual behavior. A separate seven-assertion unit checks
0,65,65.75,width3, direct-char distinction and grouped/ungrouped result counts.
The existing Memory grouping boundary remains canonical; no new compiler bug
number, BIOS/compiler repair or compatibility wrapper was invented.

A [separate narrow SF1 audit](../book1/facts/bios-string-pattern-plain.md) establishes that the descriptor's omitted fourth
`find` argument is a tooling-signature omission, not a maximum-three call limit
or observed TS/native argument-delivery disagreement. That metadata also drives
minimum-arity diagnostics; it is not merely hover text. Actual current O3 TS
guest calls pass for true/false literal-vs-pattern mode, method syntax, captured
function and the two-result count. This is bounded derived-test execution, not
native ordinary playback or a general pattern result contract. Preserve the
signature omission for separate tooling work; no descriptor fix is part of this
manual slice. Pattern-API/grammar and packing prose are separately drafted from
frozen facts but not yet source/reader/execution/print-approved or merged.

Independent current format-contract and complete-program source audits find no
remaining failure within their stated scopes. The public-only newcomer pass
closed exact assembly and explicit debug-image selection; the endpoint is
specified as a zero-based presentation offset rather than elapsed frames.
All 19 actual initial PDF pages were individually viewed. Existing authored
keep-together markup closes two detached leads and one paragraph widow; only
final14–17 differ from that inspected snapshot and all changed pages were
independently rechecked. Source/PDF hashes and finite decisions are retained in
the existing String source/program/reader/print reports. No smaller type, CSS,
new publisher branch or inferred source approval was used.

The shared Table-length publication stop still explicitly includes ordinary
String formats whose substring/general helpers use Tables. The seven CPU
questions, BZ01, resource limits, remaining BIOS/environment/language coverage,
whole-machine overview/specifications, graphics contrasts, cartridge/expansion
references and whole-console newcomer acceptance all remain open. No publisher
framework, new gate, runtime or shared harness was added.

## Installed String patterns and packets: current bounded draft

2026-10-18; baseline b515e804e plus this documentation/example slice. The
[String chapter](../book1/bios-string.md) now has authored coverage for all17
installed exports: the nine base operations, formatter, four pattern functions
and three packet interfaces. This is not a blanket contract/publication or
whole-manual completion claim. The earlier formatting section above records
its historical stage; pattern/packing drafts are now merged, not still merely
queued author inputs.

The pattern grammar and APIs describe codepoint classes/sets/anchors/suffixes,
captures/backreferences/balance/frontiers, search normalization and result
procedures, iterator advancement and repeated failure, all replacement kinds,
empty-match skipping, reached/deferred errors and actual bindings/work limits.
Source review caught two overstatements: Table-dependent enumeration needed a
shared boundary, and Table lookup does not call Function-valued `__index`.
The draft now follows actual Table-valued chaining and restricts the effects
caution to replacement functions. The descriptor's missing fourth `find`
argument remains a separate tooling note, not a guessed three-argument limit.

The packet reference gives every token/control and fixed default, maximum
alignment and X lookahead, integer safe-range and signed-read ordering, fixed/
terminated/prefixed text, exact float equations, codepoint—not octet—packets,
accepted category branches, errors and work boundaries. No local byte codec,
String address, host ABI or presumed standard float correction was introduced.

Real ordinary BLua cartridges provide complete47+122 and42+117-line modules,
validated builds,40 and33 retained assertions, and separate13 and8 literal
ordinary diagnostic lines. Chapter blocks reconstruct the actual sources,
manifest and timeline byte-for-byte. Root simplified lint-rejected cached-call
locals instead of relaxing lint. No BIOS/runtime/compiler/publisher/harness
implementation changed. Independent source-aware reviews check the actual
owners, final source, logs and public assembly, rather than only author facts.
Production Lua [String-library source](https://github.com/lua/lua/blob/master/lstrlib.c)
was inspected as implementation-review organization only; its C/Lua behavior
supplies no BMSX fact, and was not sent to the facts-only authors.

The current44-page DRAFT PDF has no recorded renderer overflow. Existing
keep-together markup resolves observed split leads/tables/formulas without
smaller type or publisher changes. Actual artifact/raster scope is in the
[print record](../book1/reviews/bios-string-print.md), not certified by the
number44. Earlier19-page artifact acceptance is historical except for the
exact retained-pixel comparisons explicitly recorded there.

**Still open:** common Table-length producer, CPU7 and BZ01; the new source-
blind newcomer pass (current final assembly reviewers are source-aware); native
or all-input/resource claims; remaining BIOS/math/os/loading/environment work;
complete source-language/SDK guidance; graphics contrasts; whole-machine
orientation/specification opening; cartridge/expansion coverage and whole-console
newcomer acceptance. The global hardware overview/specification opening is a
next substantial authoring priority, not another empty volume label. Do not
keep polishing String examples as a substitute for those remaining routes.

## Later fresh String reader closure

2026-10-18, public snapshot unchanged from ce3ef5b8f. A newly available fresh
public-only reader inspected the pattern/packet references, complete programs,
shared prerequisites, build/observation routes and READMEs without source facts,
owner code, other reviews or reference PDFs. It independently reconstructed
the two literal module sets and manifests and found no new actionable public
reader blocker in the supplied-checkout route. Full ranges, exact hashes and
limits are in [the reader record](../book1/reviews/bios-string-reader.md).

This closes only the previously pending source-blind reader item, not execution,
script/suite implementation correctness, fresh-OS dependency installation,
whole SDK acceptance, common Table length, CPU7 or BZ01. The publication check
remains blocked by the original shared-contract coverage items. The chapter
and accepted44-page PDF body did not change; no rerendered artifact is claimed.

## Linked-cartridge source-program route

2026-10-18, baseline `fce16b952` plus this documentation/example slice. The new
[Book II source-program chapter](../book1/blua-programs.md) supplies source
spelling, declarations, expression grouping and statement forms; literal
module paths, entry selection, eager dependency startup and ordinary/const
exports; and the installed BIOS/global-name environment. Canonical CPU/Memory
remain the value, arithmetic, call/result, table, typed storage and address
references. This is not a second ISA or a claim that the BIOS runtime compiler
accepts the same source/module/environment contract.

Three separately extracted finite sheets feed nonoverlapping facts-only
authors. Independent actual-owner audits and public-only reader/actual-PDF
checks are recorded with the chapter, not inferred from a successful build.
Source review corrected an interface-wide failure-tuple overclaim: only the
public `load` wrapper protects compilation and translates failure to nil plus
error; direct `compile_syntax` is not covered by that wrapper contract.
Integration also corrected uppercase identifiers in an illustrative const
namespace rather than importing ordinary Lua spelling assumptions.

The real `modules_manual` cartridge has six complete source files and typed
BSS observations. Current quality-checked build and 19 retained assertions
pass; separate ordinary playback prints five exact diagnostic lines. The
nil-export dependency runs before its false-export importer, all ordinary
constructors precede entry, repeated imports share a stateful operation, and
a caller's same-named local does not replace the operation's current global.
The public companion gives the exact tree, manifest, commands and observation
endpoint; neither the test-image nor that endpoint is a timing guarantee.
No BIOS/compiler/runtime/publisher/harness implementation was changed.

**Still open:** complete math/os interfaces, BIOS runtime compilation/loading
and environment/source-mode contracts, `<init>` lifecycle, the source sheet's
unusual goto/repeat/vararg/loop-mutation and zero-step contract gaps, broader SDK quality
diagnostics and fresh installation/debugging, Book III and connected graphical
teaching contrasts. All seven paired CPU-owner questions, common Table length
and BZ01 remain open. This finite linked-cartridge onramp neither resolves nor
hides them; it adds no numerical/call/Table-length rule beyond the canonical
references. The previous whole-machine orientation item is now supplied by
the separately reviewed System overview, not still queued as an empty volume.
Whole-console newcomer acceptance remains the goal, not the page count or
presence of a new chapter.

The source-blind reader found one additional shared-definition omission: CPU
did not define `and`/`or` selected operands or short-circuit evaluation, despite
the complete programs using numeric flag idioms. A separate finite extraction,
facts-only paragraph and actual-owner review now supply the canonical CPU
Logical expressions subsection; the reader rechecked the public fix. Its
print delta changes only CPU pages8–9; the other32 pages match the accepted
full rasters exactly. This is not a new CPU-owner repair or stopped-contract
closure. All22 source-program DRAFT pages have separate actual print evidence.
The source-program coverage record keeps lifecycle/source-corner-case work
open, so passing finite source, reader and layout checks does not publish an
incomplete language reference.

## Linked-cartridge control flow and normal-startup continuation

2026-10-18, baseline `e43ee94f1`. Separate finite extractions and facts-only
paragraph authors now supply the normal-startup `<init>` boundary, current-call
varargs, function-wide labels and jump-only scope crossings, numeric-loop
control, and the complete generic-for iterator/state/control protocol. The
normal boot path does not automatically call an attributed local function;
the separately invoked generated mechanism is not published as a cartridge API.
Numeric loop variables and hidden generic controls have different mutation
rules, now stated explicitly rather than left to foreign Lua assumptions.

Two separate complete ordinary cartridges accompany the reference. Numeric
loops have sixteen retained assertions and six separate ordinary diagnostics;
generic iteration has ten assertions and three ordinary diagnostics. Both
quality-checked builds and both retained checks pass. Public listings, complete
manifests, build/observation routes and finite limits are in the chapter and
development companion. Independent actual-source checks, a public-only reader
and actual-page print review have separate records in the
[source acceptance index](../book1/reviews/blua-programs-source.md). No runtime,
BIOS, compiler, publisher, stylesheet or shared harness was changed.

**LS01 remains OPEN: repeat-body local versus `until`.** The actual consumed
binder retains the body scope through the condition at
`toolchain/ts/lua/semantic/model.ts:921–930`; the compiler pops that scope before
lowering the condition at `toolchain/ts/lua/compiler.ts:4465–4479`. Its bare-name
load can then reach a named global instead of the body's local. A separate
ordinary probe sets only its owned global true and observes one pass; reading
the body local would require three passes. The
[exact source conflict and captured observation](../book1/facts/blua-programs-repeat-scope.md)
record current software, not an intended scoping rule or a compatibility
contract. There is no assertion that a future compiler repair must preserve
this defect. Keep the intended repeat-local guarantee stopped and resolve
the owning compiler/binder question in a separate implementation task.

The source chapter stays DRAFT for LS01; finite source/reader/layout passes
do not waive it. Full math/os and BIOS runtime loading/compiler/lifecycle,
SDK installation/debugging and diagnostics, Book III, remaining graphics
contrasts, CPU7, common Table length, BZ01 and whole-console newcomer acceptance
remain work. The separately adopted Book I/II/III scope and correct software
running title do not imply these volumes are complete.

## Installed Math: elementary/random reference and complete observation program

2026-10-18, baseline `0fca01fd4`. The new Book II
[Math draft](../book1/bios-math.md) has separately extracted, facts-only authored
and independently actual-source-checked elementary and shared-generator
sections. The generator audit's live-public-`error` qualification is corrected
and rechecked. Eleven angle/transcendental reference entries remain pending;
their successful example inputs do not establish their complete contracts.

The complete ordinary cartridge has67-line typed storage and172-line entry
modules, literally reproduced as six listings (five consecutive entry chunks).
The full unchanged-quality build passes;84 retained assertions and24 separate
ordinary diagnostic lines pass, including the finite sine/cosine lookup
contrast and explicit-seed/rejected-bound generator sequence. Fresh tooling
and the final print-width source reflow were both replayed. The
[execution record](../book1/facts/bios-math-example.md) keeps exact artifacts,
commands, source hashes and finite limits. No hidden floor call, local math
replacement, formatter, ABI helper or source-policy suppression was added.

The known-call written-expression minimum is now explicit in the canonical
BLua source chapter; its SetGlobal example supplies a second explicit nil.
This source-use distinction has actual-owner audit and a separate28-page
actual-PDF print pass, not a runtime/compiler repair. LS01 remains open.

The Math preview passes mechanical checks after an actual overlong comparison
and two long diagnostic lines were laid out readably. Full Math source,
public-only reader and actual-page visual acceptance are still pending in its
existing coverage/review record. It is not a completed/published chapter,
numerical accuracy/termination guarantee or whole-console acceptance.


## Installed Math: completed bounded chapter acceptance

2026-10-18, continuation of the draft stage above at baseline `fd0895c39`.
The remaining eleven angle/transcendental interfaces now have frozen actual
BIOS/paired-datapath facts, fresh facts-only authorship and an independent
actual-source audit. All25 callable entries and4 constants have reference
coverage. The literal lookup establishes the stated range/quantum and finite
tangent-ratio bounds, not an invented accuracy, ULP, termination or total-cycle
guarantee. The mistaken local word-definition reference, explicit-nil wording
and formula-versus-literal-BLua distinction were corrected and independently
rechecked.

The unchanged complete ordinary program still reconstructs byte-for-byte:
67-line results and172-line entry modules,84 retained assertions and24
separate ordinary diagnostics in the captured final artifact. Independent
actual-program source comparison and a fresh context-isolated public-only
reader pass, separately from these finite executions. The
[Math acceptance index](../book1/reviews/bios-math-source.md) links the precise
source, reader, execution and print limits.

Independent actual-PDF inspection found eight concrete pagination defects
across successive previews. Eight existing keep-together groups close them;
removing only that markup reproduces the accepted technical text exactly.
Normal gated publication produced the22-page canonical non-DRAFT Math PDF
`e8d40b6248edffc63a2410c6fe012c078f6dc13708fc053e1b3a3dd4ed55a569`.
All22 canonical pages were independently rasterized and freshly inspected,
with correct Book II running titles and no remaining reported visual defect.
The existing Math coverage/review record now passes; the19 manual-tool tests
also pass. No runtime, compiler, BIOS, source-policy, publisher, CSS, schema,
shared harness or helper changed in this completion slice.

This supersedes the earlier Math-pending status only. It does not close LS01,
CPU7, common Table length, BZ01, remaining BIOS/runtime loading/lifecycle,
full SDK guidance, Book III, outstanding graphics contrasts, delivered-series
navigation or whole-console newcomer acceptance. Time and calendar services
are the next independently sourced software chapter, not a completed volume.


## Installed time and calendar services: independently sourced draft

2026-10-18, baseline `b23de821f`. The next Book II chapter covers all4 actual
`os` exports: clock, time, date and difftime. Separate actual-source packets
and facts-only authors supply the sampled-counter/civil-date distinction,
field/default/range/read/check/mutation order, every conversion/modifier,
week/ISO rules, shared forward/inverse Number formulas, exact authored errors,
retained/live dependencies and source-work limits. Independent reference and
merged-delta source reviews pass; their two wording qualifications and the
missing canonical D/C definition are corrected and independently closed.

The complete ordinary cartridge has18-line numeric-BSS/guest-observations and
110-line entry modules, literally reproduced as six listings. Unchanged-
quality final artifact241d7999 passes74 retained assertions and separate
ordinary playback with26 `OS` diagnostics plus the `%n` continuation. The first
two lines are sampled readings, not pinned replay values. Dynamic text/date
Tables remain guest values; no local encoder, compiler/runtime repair, source-
policy suppression or shared harness was added. Actual print overflow required
only two literal source-line reflows; the final source was rebuilt and both
executions repeated. Earlier rejected constant-module authorship and the prior
artifact remain historical evidence, not hidden implementation repairs.

**The exact inherited Table-length question stays OPEN.** The independent
String-dependency trace finds no Table-LEN consumption for no-prefix String
formats or ordinary `*t`. Leading-`!` removal with at least two remaining
codepoints does reach helper append/default-concat lengths; Table format
inputs read their own length immediately. Those precise paths retain the
existing common producer publication dependency. The fresh monotonic helper
does not itself reproduce the separate fill/delete/refill fixture, and no
new differing date output is claimed. Finite examples do not waive it.

The chapter's [source acceptance index](../book1/reviews/bios-os-source.md)
keeps program-source, context-isolated public-reader and actual-PDF decisions
separate. The working catalog is now20 entries,13 in I and7 in II; classifying
this software chapter does not complete Book II or any other volume. CPU7,
BZ01, LS01, full SDK/runtime loading/lifecycle, Book III, remaining graphics
contrasts, delivered-series navigation and whole-console newcomer acceptance
remain separate work. No publisher, CSS, schema, validation layer or helper was
introduced.


The final scoped source/programme, fresh public-only reader and actual17-page
DRAFT print checks now pass separately. Actual inspection found eight detached-
lead/widow defects across successive previews; eight existing keep-together
groups close them without changing the accepted technical text or128 literal
source lines. The final actual-PDF hash is
`e82eb422220c9998106009c099ad5e6eee08eb00339ae0234d5bbd5b04483bca`.
All17 pages are covered by actual changed-page viewing and exact retained-page
pixel identity. The19 manual-tool tests pass. The chapter publication check
still fails for the exact inherited Table-length dependency only; this is a
reviewed draft, not a waived contract or a completed/published book.


## BIOS runtime compilation: sourced draft and ordinary programming route

2026-10-18, baseline `5b264d38a`. The next Book II chapter now covers the actual
five-argument `load`, four-argument `compile_syntax`, runtime source grammar,
all 27 syntax factories/21 tags/4 unary/15 binary constants, exact consumed
shapes and result counts, environments and self-owned external bindings,
in-place syntax ownership, 256 KiB declared code arena, emitted storage costs,
16,384-slot generated-function ceiling, closure ownership/reclamation and
bounded system-startup/reset/cartridge-entry distinctions. Separate facts-only
authors and actual-source audits are indexed in
[the source acceptance record](../book1/reviews/bios-loader-source.md).

The complete ordinary program is 23+137 literal BLua lines, not instruction
words or a generic-Lua replacement. Final artifact `1d94a471` passed unchanged
quality checks, 38 retained assertions and separate ordinary execution with 13
diagnostics. Fifth-argument descriptor callbacks are self-owned, not fabricated
frame locations. A fresh public-only reader reconstructs both modules, full
manifest and timeline byte-for-byte and passes the reference/route, including
a separately sourced reset-subsection delta. No runtime/compiler/BIOS repair,
policy suppression, publisher/CSS/schema/framework or shared helper was added.

The final 24-page DRAFT PDF has source and independent actual-page acceptance;
eight observed pagination defects were closed with eight existing keep groups.
Its SHA-256 is `0b55f4e5025aa3f50d3e262516b3419cd748cd67ce7732d6d2a26ffe98d6ee42`.
All 24 pages are covered by changed-page viewing or exact retained-page RGBA
identity, not merely a clean build receipt.

**Two publication dependencies remain open:** common maintained Table length
and RL01, the parser/semantic/dynamic-opcode boundary for general unary `&expr`.
Literal String-ID folding is separately sourced as an unchanged String, not a
numeric pointer. No general successful lowering or guaranteed rejection text
is invented. Source-signature metadata also omits external_scope, but actual
five-/four-argument runtime signatures and the finite working fifth-argument
route are documented rather than silently trimmed.

The working catalog is 21 entries: 13 in I and 8 in II. This is another bounded
software chapter, not completion of the BIOS, SDK, three volumes or console.
CPU7, BZ01, LS01, remaining firmware/debugging, Book III, graphics contrasts,
broader technical-detail audit, NES source comparison and delivered-series
navigation remain separate work. Unmeasured cache/GC stress, all-input/native,
interrupted-startup and all-caller replacement guarantees are not claimed.


## Next priority: explain BLua itself, not another Lua-library catalogue

2026-10-18 user request. The supplied `blua-programs.preview.pdf` does not make
BLua's extensions/differences sufficiently discoverable. The current source
mentions some forms and delegates typed storage/intrinsics to CPU/Memory;
that scattered presence is not acceptance of a complete BLua-specific guide.
The request requires a coherent, source-derived programming route through BLua's
extensions and genuine examples before another general BIOS-library chapter.
The user's follow-up explicitly defers general Lua explanation: link the official
Lua documentation instead of expanding a language tutorial or exhaustive
comparison. The subsequent clarification explicitly includes non-hardware BLua
extensions: hardware and relevant BIOS are the priority for the series as a
whole, not a limit on this extension reference. Do not promise that BLua or Lua
will remain at today's language version.
Keep linked-cartridge BLua distinct from the narrower runtime compiler. Preserve
all authored BIOS/library and general-language material as secondary reference;
hardware operation and relevant BIOS interfaces now take precedence.

## BLua extension reference and current tool boundaries

The extension reference includes non-hardware features such as static modules,
static call targets, `<init>`, augmented assignment, String/address `&`, arrow
selection and selected tracing, as well as mapped access, CP0 and HALT. General
Lua teaching remains deferred; this language scope is not hardware-only.

**BE01 — ordinary-ROM trace selection.** The actual compilation interface
accepts erase, emit or exact channel names. The ordinary ROM-builder CLI does
not expose that selection and defaults to erase, including debug builds. The
existing derived integration-image producer selects emit. The development
companion now names this difference; no ordinary-ROM trace-output or flag is
invented from an integration observation. Tool-interface work can be addressed
separately; this documentation slice does not add a wrapper, change the default,
or infer a runtime/compiler repair.

### Delivered extension-first DRAFT

The existing `blua-programs` chapter now starts with the distinctive BLua forms,
including non-hardware static linkage, participant registration, tracing and
operator extensions. The original general source reference and all BIOS chapters
remain. Four facts-only authors and separate owner audits supply the new text;
the reused62line storage example passes quality validation and retained execution,
ten tracing and eight init tests pass, and the public reader reconstructs both
files exactly. Its low-level closure/context and participant-trigger navigation
findings are closed by actual BIOS/development routes, not fake address producers.

The current44page DRAFT is visually reviewed page-by-page or by exact full-page
pixel identity to viewed pages. Existing markup closes14observed split groups;
no runtime/compiler/BIOS/publisher/CSS/schema/framework/helper code changed.
LS01 still blocks publication; BE01 remains the disclosed ordinary-ROM trace
selection tool-interface limitation. This bounded language reference does not
close the broader hardware detail, relevant BIOS, SDK, BookIII or graphics-output
work. General Lua expansion stays deferred; return to those series priorities.

## NAV01: PDF navigation is not yet delivered-series navigation

The GTE reader exposed a missing public build route. A direct link to the
existing development companion and a finite exact-command subsection close
that public-source onboarding gap. Actual PDF annotation inspection then found
no link action at the page125 development-companion reference in the current
publication proof: the shared renderer loads HTML with `setContent` and supplies
no document base for relative Markdown links (`scripts/manual/render.mjs`).
Printed reference text now names the guide and subsection explicitly; no
interactive-link or complete standalone SDK/PDF-bundle acceptance is claimed.

This is a concrete remaining delivery/navigation issue for the series, not a
missing hardware address or an invented runtime fix. Before declaring the
manual series complete, decide and implement the central portable public/PDF
link contract, then check actual PDF annotations and public build-route entry
points. Do not patch each chapter with workstation file URLs or local link
encoding helpers. Existing source-linked Markdown remains usable; source-reader
PASS is not proof of PDF navigation. Evidence: `/tmp/bmsx-gte-cue-proof/gte.pdf`
page125, PDFium link enumeration, and the GTE cue public-reader review.

**First producer repair, 2026-10-18:** the existing heading renderer now emits
document-local GitHub-style targets from rendered inline labels. It preserves
authored anchors, distinguishes literal code from HTML entities, and restarts
duplicate suffixes for each rendering. Independent current-code review checked
all 1,212 headings and 69 authored anchors across the 22 catalog chapters;
no duplicate heading/anchor IDs were found. The 24 manual tests pass, including a real
Chromium local-link/named-destination fixture. PDFium independently resolves
that fixture's page-1 link to its implicit heading on page 2.

Exact HTML comparison across all 44 chapter/mode combinations finds only the
new heading attributes changed. All 126 pages of the regenerated Memory and
SYSTEM previews and PCRTC publication/preview match the accepted originals by
complete decoded RGBA bytes and dimensions, including running matter. Evidence:
`/tmp/bmsx-manual-heading-target-implementation-review-current.md` and
`/tmp/bmsx-manual-heading-targets/`. **NAV01 remains open:** `.md` cross-chapter
links, the admitted delivery set and portable cross-PDF actions are not repaired
by heading IDs; unreferenced IDs are not automatically exported as PDF named
destinations. No source prose, hardware behavior or publication approval changed.

Delivery must cover the development companion as well as the 22 catalog chapters:
`docs/programming/getting-started.md` is the only local link target outside that
catalog and is referenced by 13 chapters. A chapter-only filename map would leave
those build/observation links broken. Current publication-layout proofs for
console, IRQ and cartridge still contain no cross-document URI actions; print
acceptance does not close NAV01.

**Portable loose-document output, 2026-10-19:** the shared renderer now resolves
source chapter paths to sibling output filenames. HTML stays in its HTML set;
PDF actions use relative PDF filenames and exported named destinations. Preview
links stay in the preview set. The development companion is delivered as
self-contained HTML, outside the reference catalog; its editorial-only tracing
follow-up link was removed without changing the stated tool limitation.

Independent current-code review and all 27 manual tests pass. Actual PDFium
inspection of the complete preview set (22 PDFs plus companion HTML) resolves
all 238 relative URI annotations, 93 local destination annotations, 1,173 heading
targets and 72 heading aliases, with no missing file/target or workstation,
Markdown-source or reserved transport URI. Both HTML-mode graphs resolve all
354 local links. Every complete decoded page and its dimensions match the
pre-navigation artifacts: 834 pages across 30 regenerated PDFs. Existing print
acceptance is carried only at that unchanged-graphics boundary; pending factual
or print decisions remain pending. Evidence: `/tmp/bmsx-manual-navigation/`.

The complete admitted delivery set remains the **preview** set; twelve chapters
have canonical publication approval, not the full series. Generated
`contents.preview.html` and `contents.preview.pdf` now provide book-level contents
from the existing catalog and manuscript titles, with the development companion
separate. All 23 relative PDF actions have delivered targets. A relocated
47-file preview bundle opens all 23 HTML targets in headless Chromium, including
the actual contents → companion → GPU program → Memory route, without failed
requests. Evidence: `/tmp/bmsx-manual-contents-portable-browser.json`.
Actual full Chromium153 headless viewer clicks then exposed a defect the graph
audit missed: bare `system.preview.pdf` and `input.preview.pdf` actions were
guessed as HTTP hostnames. The central PDF producer now emits explicit `./`
relative paths. The preserved failing route and corrected native annotation
clicks are in `/tmp/bmsx-manual-viewer-proof/`: contents → SYSTEM, then SYSTEM
page4 → INPUT's named destination on page6, and contents → companion HTML.
The corrected routes make no HTTP request and have no failed navigation.
The viewer's [scheme-guessing implementation](https://github.com/chromium/chromium/blob/main/chrome/browser/resources/pdf/navigator.ts)
confirms why explicit paths are required. This is bounded Chromium evidence,
not an all-viewer/platform claim.

The 35 regenerated PDFs account for 1,127 pages without a repeat whole-book
visual review: 33 same-source documents (1,073 pages) retain exact full-RGBA
page images and dimensions; IMGDEC's 27 canonical pages match its approved
byte-order proof, while only page1 of its 27-page DRAFT changed and was viewed.
The complete preview graph resolves 243 relative PDF actions, 93 native local
destinations, 1,174 headings and 72 aliases; contents adds 23 explicit relative
actions. All29 manual tests pass. Pixel and graph evidence:
`/tmp/bmsx-explicit-relative-pdf/`.

This closes the missing draft contents entry and the tested local PDF-viewer
routes. **NAV01 remains open for final series assembly and release delivery**;
working navigation cannot promote unresolved chapter contracts.

The assembled preview delivery is
`build/manual/bmsx-developer-references.preview.zip`: 47 files containing all
22 chapter HTML/PDF pairs, both contents formats and the separate companion
HTML. Extracted bytes match the tested relocated set, including the native
viewer proof identities; `/tmp/bmsx-explicit-relative-pdf/bundle.json`.
No canonical files, internal evidence or third-party library notes are included.


## First Book III chapter: cartridge sockets and mapped cards

A bounded cartridge chapter now supplies the missing controller/card/mailbox
programming route: independently optional device composition and installed
capacities, raw SELECT/derived STATUS, instruction-domain distinction,
little-endian widths/tails, local and central IRQ acknowledgements, request
levels and independent DMA endpoint socket selection. The actual installed
DMA wiring is checked, including cartridge pricing for **card RAM and mailbox
MMIO**, not just ROM. The four-word card-to-card budget is 72 admitted cycles;
it is not a CPU launch-to-completion measurement or physical bus rating.

The complete 133-line ordinary BLua program and both manifests build. Its
existing-route guest case passes all retained selection/RAM/mailbox/IRQ/DMA
payload/address/count/status/masked-pending and bus-fault checks. The separate
ordinary two-media player launch reaches its finite TTL, not an asserted
payload display. Ten focused TS owner tests and three native suites pass;
neither is native execution of the full new cartridge. Separate source, public-reader
and actual final-print decisions pass and are recorded in the chapter reviews,
not inferred from those executions. All twelve canonical pages match the
individually inspected proof by exact full decoded RGBA and dimensions. The
current paired device inventory contains no additional implemented expansion
protocol beyond these ROM/RAM/mailbox cards. Undefined physical/electrical
guarantees and whole-console newcomer acceptance remain separate decisions/work.
This does not reopen general Lua exposition; all BLua extensions,
including non-hardware features, remain in scope as already recorded above.

Current-scope check, 2026-10-19: media schemas contain ROM/RAM/mailbox only
(`machine/ts/machine/devices/cartridge/contracts.ts:1–5`;
`machine/cpp/machine/devices/cartridge/contracts.h:13–17`); card constructors
instantiate those devices (`card.ts:41–50`, `card.cpp:16–24` in the same owner
directories). The controller connects to existing Memory/IRQ/DMA, not another
expansion owner. This closes the vague extra-chapter placeholder, not electrical
specification or whole-console acceptance.

### Separate capture-storage topology issue

TS cartridge/controller capture (`controller.ts:131–138`) emits null for an
absent socket; C++ (`controller.cpp:100–107`) preserves a supplied stale occupied
slot when the current socket is absent. Card capture similarly emits absent
RAM/mailbox as null in TS (`card.ts:111–120`), while native capture updates only
present regions and allocates missing supplied RAM (`card.cpp:81–89`). These
are paths under `machine/{ts,cpp}/machine/devices/cartridge/`. This is an actual
reusable capture-storage API asymmetry when supplied storage has a different
topology, not a demonstrated cartridge register/IRQ/DREQ disagreement.

The examined normal reuse producer is RuntimeHistory, bound to one Runtime
and recycling only its own checkpoint ring; socket/card-region topology is
constructed once, and installRom replaces existing ROM bytes only. Fresh
matching-topology capture agrees. No normal cross-topology reuse caller or
cartridge-visible consequence was established in this bounded audit; universal
external API reuse is not approved. The source evidence in
[cartridge facts](../book3/facts/cartridge.md) retains both the initial stop and
scoped triage. Keep the general capture-storage precondition/caller audit as
separate engineering follow-up. No runtime repair, fallback/normalization,
validation layer or fictitious hardware behavior was introduced to hide it.


## Technical inventory continuation: APU source extents and GPU startup

The bounded APU check found a real admission/lifetime teaching gap, not missing
sample or transfer clocks: descriptors must fit **actual installed ROM bytes**,
not merely a CPU-readable aperture. The [source-binding supplement](../book1/apu.md#voice-sources-and-their-lifetime)
now distinguishes all admitted regions, excluded main/card RAM and mailboxes,
whole-descriptor/nonzero bounds, execution-time cartridge selection, retained
playback storage and individually live rebinding. Its paired source/test and
public-reader evidence is in [the finite review](../book1/reviews/apu-source-binding.md).
The existing full four-route BLua cartridge is retained, not replaced by another
small harness or a fictional BIOS API. General Lua exposition remains deferred;
all BLua extensions, including non-hardware extensions, remain in scope.

The separate GPU check identified a startup-state paragraph, now supplied by
the [bounded startup supplement](../book1/gpu.md#reset-and-display-visibility):
full-device patterned VRAM, distinct GP1/CSR effects and prior BIOS use. It does
not promise untouched pixels at cartridge entry. The same compact paragraph
links Memory's existing finite firmware reservation/query, rather than adding
another partial storage contract. [Refreshed paired-owner facts](../book1/facts/gpu-startup.md)
and independent source/public-reader checks remain separate from actual print.
The earlier source-binding slice itself changed no GPU prose or runtime.
Do not invent physical MHz or sustained rates to fill unsourced electrical
specifications. The remaining foundation inventories and whole-console newcomer
acceptance remain open; the routing table above identifies the finite next work.

## BH01: named BIOS helpers are not automatically a public API standard

**2026-10-18, withdrawn draft:** the proposed additional `math/sin` and
`string/float/decode` contract sections and their dedicated example were not
published or committed. They have been removed from the publication change.
Their source and execution checks established current behavior, not that every
observed branch should become a supported cartridge interface. The existing
BLua source reference and ordinary BIOS-library material are retained.

The bounded live-source audit distinguishes three questions:

- Ordinary `math.sin` accepts radians and rescales the underlying phase-word/Q16
  result (`machine/bios/math.lua:100-103,373`). The separate helper uses a
  32-bit turn phase and integer Q16 result (`machine/bios/math/sin.lua:38-64`).
  The explicit export list exposes that helper (`toolchain/ts/rompack/system.ts:9-13`);
  this is not an accidental change to the ordinary `math.sin` call.
- The float decoder is an explicit export with existing users, not a function
  invented for the manual (`system.ts:14-17`; `cartlib/bin.lua:3,118-121,134-137`).
  The installed `string.unpack` implementation also uses it
  (`machine/bios/string/pack.lua:161-175`). These callers supply unsigned words
  and sizes 4 or 8. No numerical defect was established for that input domain
  by the bounded source check of `machine/bios/string/float/decode.lua:8-37`.
- Its `byte_count == 4`/otherwise branch is an implementation fact, not evidence
  that arbitrary other sizes ought to be supported aliases. In particular, the
  withdrawn draft's tests for sizes 0 and 16 must not establish that policy.

**Remaining engineering question:** decide whether these low-level exports are
appropriate public cartridge primitives or implementation dependencies, and
which guarantees the owning interfaces should provide. Existing export/use is
evidence of the current boundary, not a design approval. Any demonstrated
defect belongs at its owner before the corresponding manual promise is made;
do not add validation, compatibility aliases or cosmetic wrappers to preserve
it. No BIOS/runtime/compiler change is inferred from this documentation audit.
This does not block unrelated hardware teaching or reopen general Lua lessons.

Current hardware/startup inventory, 2026-10-19: the explicit named-export list
contains exactly these two numeric helpers and `gpu/system_vram_region`
(`toolchain/ts/rompack/system.ts:9–22`). Memory already teaches the VRAM query,
its units and retained-region lifetime. Kernel DMA/IRQ/VBlank, GPU command and
terminal helpers remain private firmware dependencies, not missing cartridge
imports. The generic “remaining exported firmware” writing assignment is stale;
BH01 is the specific unresolved interface decision.

**Further bounded check, 2026-10-18:** the hold also applies to ordinary
trigonometric API acceptance in the retained Math manuscript, not only the
withdrawn helper draft. Actual O0/O3 execution of the owning BIOS modules
returns zero for `math.sin(0 / 0)` and `math.sin(1 / 0)`, and changes sine's
negative zero to positive zero. The conversion is in
`machine/bios/math.lua:100-120`; the separate phase-word/Q16 algorithm is in
`machine/bios/math/sin.lua:43-63`. Existing tests of quantized results and
nonnumeric zero results (`tests/carts/bios_math_manual/bios_math_manual_assert.lua:51-52,73-75`)
are observations, not evidence that these are desirable permanent guarantees.

Math's numerical-boundary and special-value acceptance are reopened in its
[coverage record](../book1/reviews/bios-math.json). Keep the manuscript and
examples; withhold publication until the owning API's intended precision and
special-value behavior are decided and any demonstrated defect is repaired.
This does not establish a strict-Lua compatibility mandate, invalidate all
Math operations or show a defect in the decoder's used 4/8-byte domain. No
runtime fix or additional edge-case tests are inferred. General Lua exposition
remains deferred. Independent source review and root's repeated execution are
recorded in [the Math source review](../book1/reviews/bios-math-source.md).

## BIOS-to-cartridge ownership bridge — bounded continuation, 2026-10-18

Memory now connects its existing EXEC/startup account to
[Taking ownership after the BIOS](../book1/memory.md#taking-ownership-after-the-bios):
reset defaults versus prior firmware work, masked versus acknowledged IRQ,
handler/source preparation before first enable, retained firmware VRAM and
later SYSTEM context limits. The same chapter now links the already-complete
CPU instruction/accounting and DMA endpoint/block/transport references instead
of carrying stale requests for another partial timing table.

Facts-only authorship, independent actual paired-source and public-only route
reviews pass at this finite boundary; see [Memory's source record](../book1/reviews/memory-source.md).
The existing IRQ integration case and all 19 manual tests pass. No new sample,
API, runtime fix or publishing mechanism was added. These links close actual
discovery gaps, not exhaustive inherited-state, supervisor/multiple-reader VRAM,
coordinated cancellation/restart, successful recovery, SDK or whole-console
newcomer acceptance. BH01 remains a separate interface-design question; NAV01
still requires a portable delivered-series link contract.

## Successful word-load retry — bounded continuation, 2026-10-18

Memory now includes a separate complete mutable-pointer cartridge and the
[repair-and-retry lesson](../book1/memory.md#repair-a-word-load-and-retry).
The companion supplies exact project/manifest/build/keyboard/browser steps.
Actual BIOS frame assignment repairs the live operand; CONT retries the same
read, then the cartridge reads both words and acknowledges the old report.
This does not replace the earlier constant-address failed-retry example.

Independent source, semantic-figure and public-reader reviews pass. The
ordinary debug-ROM keyboard scenario passes ten assertions; actual Chromium
mouse/key playback separately produces the expected diagnostics. The image
is genuinely before CONT, not drawn success output. All 19 manual tests pass;
changed actual PDF pages were individually inspected. See the
[source record](../book1/reviews/memory-source.md) for scoped evidence.
This closes one supported successful-recovery route, not privileged handlers,
remaining fault classes, coordinated cancellation/restart, full takeover,
SDK/live-inspection or whole-console acceptance. BH01 is not standardized by
this unrelated hardware lesson.

## Cartridge IRQ privilege demonstration — 2026-10-18

The [complete CPU example](../book1/cpu.md#cp0-in-cartridge-irq) now makes CPU
non-user IRQ execution versus inactive SYSTEM context tangible. Both complete
BLua modules, an exact build/result companion route and separate integration
and ordinary-ROM executions are supplied. Paired-source/public-reader reviews
and actual changed-page inspection pass; all19 manual tests pass. This adds no
cartridge synchronous-fault hook or supervisor-entry callable. Existing routing
was already documented; Memory no longer carries a fictitious handler-install
obligation. Remaining real hardware/recovery and whole-console gaps stay open.

**FSEL01 — concrete debugging-companion gap:** the public-only route review
found that the supplied `0x00000001 0` pair is not a general selector. The
[companion clarification](../programming/getting-started.md#physical-frames-and-inline-scopes)
now teaches physical index versus inline depth, PC-dependent scopes and numeric
syntax. Independent actual-source and public-reader reviews pass; keyboard-only
HELP/FRAMES/repair/CONT execution passes twelve assertions, with the unchanged
maintained scenario separately passing ten. See [the source record](../book1/reviews/memory-source.md).

**Still open:** the visible BIOS CLI accepts an already-known pair but cannot
enumerate inline source names/depths or discover an arbitrary fault-source pair.
This is a current tooling gap, not a hardware constraint or a documentation-only
closure. No command, guessed depth, optimization workaround or arbitrary-local
repair guarantee is invented. No runtime implementation is inferred here.
BH01's numerical API hold and general-Lua deferral are unchanged.

## RDB01 — GPU readback versus synchronous-fault entry, 2026-10-18

The fresh Memory lifetime reader identified a concrete transition question,
not a need for a generic coordinated-recovery framework. The paired owners
hold the CPU during FAULT quiescence while the GPU fence requires readback
IDLE; no owner consumes the unread CPU-owned pixels at that boundary.

Actual ordinary BIOS cartridge execution reproduces the gap: a READY 1×1 C0
readback followed by an unmapped word load remains CPU-held and unpublished
through 120 runner-frame waits. Consuming GPUREAD before the identical load
instead reaches ACTIVE and publishes the report by the first subsequent wait.
The unread repeat agrees. This is TypeScript execution plus paired-source
evidence, not native execution or an invented hardware timeout.

See [the bounded defect record](../book1/facts/system-readback-entry.md).
SYSTEM fault coverage is reopened. Resolve the owning completion/ownership
policy separately; do not turn this software liveness defect into a permanent
programming hazard or add a runtime workaround from a documentation task.

## Memory lifetime scope after the fresh reader audit — 2026-10-18

The [normal-boot handoff table](../book1/memory.md#normal-boot-live-work) now
supplies the missing minimum live-work boundary. It states no active BIOS
DMA/GP0 producer, unfinished firmware packet/readback or boot GEO/IMGDEC/APU
job while keeping already submitted GPU drawing distinct. Independent actual
paired-source and public-only reader reviews pass. The final DRAFT's changed
pages were individually inspected; see [the source](../book1/reviews/memory-source.md)
and [print records](../book1/reviews/memory-print.md).

The same public-only audit found no named missing hardware operation behind
the older blanket allocator, all-register-inheritance and coordinated-recovery
obligations. Existing reservations, multiple live readers, shared VRAM versus
banked state, nonrollback writes, reset and owning CPU/device references already
teach those boundaries. Those broad labels are replaced, not silently certified
by another example. A new hardware gap must identify its absent operation,
producer and consumer; a general allocator/transaction framework is not inferred.

RDB01 and FSEL01 remain concrete unresolved issues. Final whole-console
newcomer acceptance is still unproved. BH01 belongs to the held Math interface,
not an invented requirement to standardize raw helpers in Memory. Relevant
development/source-loading coverage stays in its owning companion/Book II;
general Lua-library expansion remains deferred.

## APU listening and first-frame reader routes — 2026-10-18

The companion now supplies an ordinary non-debug APU browser launch, explicit
audio activation before runtime start and expected short four-phase sequence.
Actual keyboard startup and passive output capture are separate from the old
numerical assertions; [source/evidence scope](../book1/reviews/apu-source.md).
No new audio API, example family or general Lua exposition was added.

A separate public-only first-frame audit finds no additional missing contract
for raw input, CPU GP0 drawing, fresh-VBlank publication and disjoint-surface
repetition: `/tmp/bmsx-first-frame-public-audit-current.md`. Existing exact
register/packet/IRQ/lifetime contracts can be combined without another graphics
framework. This is bounded route acceptance, not closure of RDB01, FSEL01,
BH01, physical specifications or final whole-console newcomer acceptance.

## Reader-first hardware openings

Open with what the hardware does, its channels/units, sharing and adjacent units,
then give specifications and qualified route costs. Do not just rename an
“Installed resources” table. DMA's opening is updated; apply this to remaining
chapters where the orientation is missing. Preserve technical detail.

- [x] **Hardware-first openings and independent-code boundary — all hardware chapters.**
  Check the opening explanations and programming sequences across Book I, not
  just APU. Explain source/storage choices, data representations, register and
  command operations, visibility and completion in hardware terms first.
  Remove all third-party library APIs, types, recipes and dependent examples
  from the entire BMSX series, not just chapter openings. Preserve useful
  library material outside the series as independent internal-development
  documentation. Fold this into each chapter's remaining content work;
  do not start separate per-change reviews or presentation rounds for it.

## Independent machine-image specification

- [x] Describe consumed boot/image/table/record byte layouts and instruction
  assembly/linkage independently of the current ROM packer. The complete I/O
  directory and reserved-word/decoder limits are explicit; matching BIOS link
  information is a separate development artifact, not a resident lookup API.
  Static-section adjacency is a layout choice, not a hardware requirement.
- [ ] Image-string decoding differs between the owners: fatal UTF-8 decoding
  at `machine/ts/machine/cpu/cpu.ts:139,929–949` versus raw-byte interning at
  `machine/cpp/machine/cpu/cpu.cpp:484–504` and
  `machine/cpp/machine/cpu/string_pool.cpp:55–56,139–143`. Do not standardize
  malformed-byte behavior or infer a fix from this documentation work.


## Clean-checkout first-build prerequisites — 2026-10-19

The existing companion now names the Linux server helper's C++17/systemd build
requirements, uses the committed dependency lock and distinguishes canvas's
prebuilt route from its source-build dependencies. Evidence: package scripts
`package.json:111–112`, `scripts/products/process_scope_build.ts:39–40` and
`hosts/node/process_scope/native/linux_unit.hpp:4`; locked canvas 3.2.3 upstream
installation guide. No new build script, helper, example or hardware ABI.

A detached clean checkout of `45ca245c0` installed 201 packages, built the debug
browser player and GPU cart (including its BIOS), and automatically compiled
the native host helper through `npm run serve:dist -- --help`. The unchanged
server then delivered the player, engine, cartridge and BIOS with HTTP 200 on
private loopback port 18085 and was stopped. Logs `/tmp/bmsx-manual-clean-start-*`.
Node 22.23.1/npm 12.0.2 on the existing Linux/WSL host; no fresh-OS, all-platform,
new browser-frame, UI-only or complete-SDK acceptance is inferred. Main checkout
builds/dependencies and the user's browser were untouched.
