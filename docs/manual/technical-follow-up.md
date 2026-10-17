# Bounded Book I technical-detail inventory

2026-10-17; checkout `cb893c6d5`; worktree was clean at inspection. Baseline inventory recorded before the T02 DMA supplement. Neither `docs/architecture.md` nor a reference PDF was opened.

**Boundary:** this is an editorial inventory of the six current chapters and their existing frozen fact sheets, plus a unit/index inventory. It is not a new live owner-versus-spec extraction, a fresh factual approval, proof of full Book I coverage, or closure of the user's broad technical audit. The broad audit and graphics-output items in `README.md` remain open. The DMA supplement below addresses the first bounded rate/boundary teaching task, not this entire inventory. No new publisher/schema/check layer is proposed.

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

## What is already explicit, versus what still needs a paragraph

Line ranges describe the inspected baseline, not stable manuscript anchors.
The T02 DMA supplement adds the route-rate table, block/tail/wait examples and
GPU image transport budgets identified below. A combined actual raw-image
upload/download trace remains a separate GPU teaching task; the controller
rate replays alone are not VRAM completion evidence.

### PCRTC

Already recognizable rather than merely implicit:
- Capacities/organization/widths: chapter `pcrtc.md:20–43` gives main RAM versus shared local memory, two circuits, 26 mapped words versus 22-word program/display banks, aligned word interface, geometry field capacities.
- Clocks/cycles/latency: `45–79` supplies reset half-line/field conversion, four cycle landmarks, fractional deadlines, scalar/sequence instruction costs and no PCRTC write-ready stall. `331–365` distinguishes immediate readback, VBlank latching, multiword hazards and beam restart.
- Formats/addressing: `145–273` gives sample packing, zero-format results and the complete page/block/linear layout families. Sharing: `22–25` says both circuits share one local memory. `81–85` expressly does not invent an electrical arbitration/fetch/bandwidth contract.
- Frozen basis: `facts/pcrtc.md:148–252,308–365,952–1028`.

Concrete next paragraph/figure task: **observed display effect**, not another register table. Add a captured before/after for a sourced window/source-origin or PMODE change alongside the existing source and output coordinate explanation (`89–127`, `275–329`). State the settings and VBlank visibility condition. The frozen sheet has programming inputs (`540–669`) but does not supply an existing finished cart/capture for that contrast. A new bounded source/execution task is needed before claiming an observed result. No missing electrical number was established by this inventory.

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
1. **Cross-unit raw image transport budget:** add one actual RAM→GP0 image-upload route and one READY GPUREAD→RAM readout route, with header/payload counts, 16-word blocks/tail, request conditions and separately observed destination readiness/completion. This is missing from the currently detailed CPU picture example and the DMA chapter's five-word fill stream. Reuse frozen GPU ingress/readback contracts plus DMA DMT13–17/DMP07–14; do not claim a fixed C0-to-READY latency or a direct VRAM DMA aperture. Exact combined traces still require real owner execution.
2. **Observed picture plate — bounded insertion completed since this baseline:**
   the actual `gpu_manual` frame and nine-region legend now connect raw/modulated
   textures, palette indices, bit-15 black versus exact-zero transparency and
   blending/protection to the executable packet choices. Fresh guest execution,
   independent source/image checks and final actual-print review pass. Further
   before/after dither/coverage comparisons remain distinct capture tasks.

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
2. **What a VRAM transfer actually is:** add a compact route explanation with a real raw-image upload/readback, not just the existing five-word GP0 fill. Cross-reference the GPU's pixel packing and READY rules and include command/header/payload distinctions. A memory-to-GP0 rate is not an arbitrary RAM-to-VRAM completion rate. Combine this with the GPU assignment above rather than duplicate explanations.
3. **Request waits and competing work in the budget:** existing prose explains eligibility and round-robin. Put the rate table beside a clear denominator statement: count admitted block costs, add actual request-starved gaps/other-channel block intervals to obtain a defined observed interval. Do not invent fixed waits or CPU-versus-DMA electrical contention. The existing two-channel trace is usable evidence and should be reused, not replaced by a new abstraction.

### APU

Already explicit:
- `apu.md:15–40`: sixteen slots, 21-word banks/staging, command/FIFO capacities, private RAM, stereo width/cadence, 768 cycles/frame and 32 cycles/transfer word.
- `235–432`: source-region/lifetime constraints; PCM mono/stereo byte stride; BADP blocks/seek/nibbles/step table; signed Q16 phase. `481–556`: Q12 gain, stereo sum/final saturation, Q14 filter/history and fade.
- `587–638`: installed rates, whole-batch visibility, exact transfer/sample ordering, cartridge-ROM upload trace including DMA DONE680 versus sample-RAM commit808.
- `640–726`: private RAM extent versus transfer offset, wrap, modes, 16-word FIFO/DREQ, CPU/DMA ownership and download's unwanted prefetch hazard. `42–79` explicitly says there is no specified per-command elapsed-cycle charge.
- Frozen basis: `facts/apu.md:241–353` APT01–20, `372–585` voice/format/rate/filter, `603–606` scope limits, `650–673` executed actual cart observations.

Concrete next paragraph task: **a controlled download timing companion** to the upload trace. Start from defined sample RAM and DMA_READ setup, account for full-16-word prefill even when the requested count/tail is short, DMA transport, final BLOCK_END prefetch and STOP cancellation, and distinguish requested data receipt from an unneeded busy prefetch. Current text teaches all these rules, but supplies only an upload numerical timeline. APT08/09/12–18 plus DMT13–17 support extraction/replay. This can be a short teaching addition; do not build a new audio harness or fake transport latency. Per-format physical fetch rates/independent DAC clocks are not present in the frozen sources and must not be invented.

## Installed-unit chapter assignments and follow-ups

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

**Still open:** complete call/permission/dynamic/string-byte contracts;
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
all44 actual PDF pages have been inspected with the final four-page layout
correction rechecked. See [the scene acceptance](../book1/reviews/geo-scene-source.md)
and [print acceptance](../book1/reviews/geo-print.md). No new publisher/capture
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
