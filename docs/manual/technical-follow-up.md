# Bounded Book I technical-detail inventory

2026-10-17; checkout `cb893c6d5`; worktree was clean at inspection. Baseline inventory recorded before the T02 DMA supplement. Neither `docs/architecture.md` nor a reference PDF was opened.

**Boundary:** this is an editorial inventory of the six current chapters and their existing frozen fact sheets, plus a unit/index inventory. It is not a new live owner-versus-spec extraction, a fresh factual approval, proof of full Book I coverage, or closure of the user's broad technical audit. The broad audit and graphics-output items in `README.md` remain open. The DMA supplement below addresses the first bounded rate/boundary teaching task, not this entire inventory. No new publisher/schema/check layer is proposed.

**Progress after this baseline:** GEO now has a separately extracted and reviewed
owner chapter, an executed three-operation BLua cartridge and paired timing/data
replays; see [its source review](../book1/reviews/geo-source.md). This closes the
missing GEO chapter assignment below, not the broad technical audit or the real
graphics-output illustrations. IMGDEC is the next chapter assignment.

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

### GTE

Already explicit:
- `gte.md:13–79` separates operand/register capacities, 44/32/16-bit arithmetic stages, history depths, system frequency, normal synchronous results, PLUS latency and the five-cycle arithmetic admission ceiling; it distinguishes nominal normal CYCLES from elapsed time.
- `4981–5086` supplies PLUS publication/interlock, direct CPU versus DMA command access, ordered word/sequence effects, faults, no completion IRQ and reset cancellation.
- `4831–4980` budgets an entire geometry/lighting/packet-construction instruction interval; `5716–5887` gives repeated PLUS work including feeding/readout. Thus the chapter is not currently missing all cycle-budget or CPU-fed-work teaching.
- Frozen basis: `facts/gte.md:430–618` (capacity/clock/admission/limits), `1082–1125` (real BLua route), `1126` onward (expanded operations and repeated PLUS evidence).

Concrete next paragraph/figure task: **connect the already executed triangle to actual output images** in/after `1814–2180`. Use the initial versus translated captured frames and their corresponding programmed translation/projection values, rather than another schematic. The existing screenshots do not yet appear in the chapter. Broader useful contrasts (clipping, lighting, depth cue, affine projection behavior) need separately controlled programs/captures; one triangle pair must not be reported as closing all graphics-output teaching. Do not republish a nominal-command count as instructions/second.

### GPU

Already explicit:
- `gpu.md:22–106`: 2 MiB shared local memory, 16-bit stored versus 32-bit input words, separate 16-word CPU/DMA ingress, coordinate/color formats, system cycles versus two command ticks, setup/issue costs, fill/copy examples and what readback's one tick does not cover.
- `941–967`: actual 1024-word rows, word/byte indexing, full-memory wrap versus nine/ten-bit Y gate, RGB555 placement and example stride.
- `885–939`: CPU/DMA ownership and block/packet distinctions. `2699–2703` explains upload supply versus command cost; `2746–2791` distinguishes pending/submitted/READY, retained reads, packing and ownership.
- `3091–3182` gives drawing-family command-cost equations and numerical threshold cases; `3185–3310` budgets issue, fence, polls, acknowledgement and return together. These are substantial positive timing facts, not just “rates unspecified.”
- Frozen basis: `facts/gpu.md:19–38,253–271,397–420,538–565`.

Concrete next paragraph tasks:
1. **Cross-unit raw image transport budget:** add one actual RAM→GP0 image-upload route and one READY GPUREAD→RAM readout route, with header/payload counts, 16-word blocks/tail, request conditions and separately observed destination readiness/completion. This is missing from the currently detailed CPU picture example and the DMA chapter's five-word fill stream. Reuse frozen GPU ingress/readback contracts plus DMA DMT13–17/DMP07–14; do not claim a fixed C0-to-READY latency or a direct VRAM DMA aperture. Exact combined traces still require real owner execution.
2. **Observed picture plate:** embed the actual `gpu_manual` output with captioned regions relating raw/modulated textures, palette/index interpretation, bit15 black versus zero transparency, blending/protection to the authored packet choices (`109–416`). Existing real output is available as a lead, not newly verified by this inventory. Further before/after dither/coverage comparisons remain distinct future capture tasks.

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

## Installed units still without an owner chapter

Catalog currently contains only PCRTC/GTE/GPU/IRQ/DMA/APU (`docs/manual/catalog.json:1–44`). Actual construction/index evidence, **not filename behavior inference**:
- `machine/ts/machine/machine.ts:58–97` constructs CPU, GeometryController, ImgDecController, SystemController and InputController in addition to documented units; paired `machine/cpp/machine/machine.cpp:14–38` confirms them.
- `machine/ts/spec/bmsx/io.ts:20–56,110–114,123–124,138–148` exposes GEO, input, system and IMGDEC register groups. These names/indices identify extraction scope only; this report makes no claim about their register behavior.
- `machine/ts/spec/bmsx/memory_map.ts:1–33` is the index for CPU/memory/bus overview extraction, not evidence that address-window size equals installed capacity.
- Cartridge controller/socket/card work remains Book II by the existing manual boundary. Naming cartridge request bits in Book I does not finish Book II.

Recommended authoring order, keeping one unit per source extraction:
1. **GEO:** existing GTE boundary explicitly says it is separate (`gte.md:9`); an owner chapter is absent. This completes a named graphics-adjacent gap without pretending GTE covers it.
2. **IMGDEC:** another installed graphics-adjacent unit with named DMA request interactions already used in the DMA chapter. Extract its own capacities/stream/format/timing/destination ownership first.
3. **Input controller/output ports:** separate installed unit and register group, no chapter.
4. **System control/time/bus-fault interface**, then **CPU/memory/program execution** shared reference. The latter is a substantial separate scope, not merely duplicated CPU-cost notes from other chapters.

This order is editorial dependency reasoning, not a claim about an uninspected reference manual's order. Source extraction could change paragraph assignments if actual owners/specs disagree.

## Real graphics-capture leads — backlog remains open

Existing ignored files are present, but were not freshly executed or visually approved here:
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
