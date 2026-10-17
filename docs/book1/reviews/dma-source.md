# DMA source, programming and figure review

Editorial evidence for `docs/book1/dma.md`; frozen sources are in
`docs/book1/facts/dma.md`. Book I as a whole remains unfinished.
The complete source/listing/figure and whole-reader reviews pass with no open
factual or instructional failures. Print acceptance is separate in dma-print.md.

## Scope and independent assignments

Separate extractions cover the twelve register words, admitted transfers and
installed timing, device requests/mapped access/fault behavior, and actual
firmware/source-language patterns. Scoped TypeScript/C++ owners agree. Shared
firmware/compiler producers are identified as single-source, not called a
second independently mirrored implementation. Neither architecture prose nor a
historical hardware PDF supplied facts or authorship input.

P03, P04/T01 and P05/F01 were separate prose assignments from frozen fact slices.
A separate author implements the runnable cartridge and ordinary guest suite.
Root integrates the resource, programming, register and completion reference.
Nonauthor source/math/diagram and full-reader checks are separate assignments.
No new publishing framework, validation layer, stylesheet or runtime is needed.

Production comparisons inspected MAME's
[AM9517/8237 DMA source](https://github.com/mamedev/mame/blob/master/src/devices/machine/am9517a.cpp)
and the
[PSn00bSDK GTE example](https://github.com/Lameguy64/PSn00bSDK/blob/master/examples/graphics/gte/main.c)
for responsibility separation and real operand-data organization. No foreign
address, channel count, pin timing, priority, command API or electrical rating
was adopted as a BMSX fact.

## Existing BIOS precedents, not invented BLua

DMB01–10 name actual firmware examples: `kernel/dma.lua` programs typed scalar
word ports, snapshots explicit BSS completion state before START and waits with a
sequence predicate and `halt_until_irq`. `gpu/commandlist.lua` waits separately
for DMA submission and the GPU marker. `shell/commands.lua`, `tty/terminal.lua`
and `math/sin.lua` supply static typed records/arrays, BSS and typed word views.
Private firmware requires are not described as cartridge exports.

A separate bounded audit of the current GTE complete program found that its
listing exactly matches its cartridge after whitespace normalization. Both
obsolete user-quoted register-initialization snippets are absent. Current
geometry operands use authored `rodata` records, direct whole-word transfers and
explicit BSS following those same BIOS precedents. No further cosmetic GTE
rewrite or removal of an unused library export was justified by that audit.
This source-style audit was not a fresh GTE execution claim.

## Independent executed timing and state replay

Scratch harnesses constructed real current Memory, CPU, IRQ, scheduler and DMA
owners in both runtimes. They applied installed timing `(1,1,1,8,4)`, not the
unit fixtures' zero-setup defaults. Their eight JSON traces were byte-identical:

| Case | Executed total, system cycles |
|---|---:|
| RAM20, block16 | 44 |
| RAM20, block4 | 50 |
| Cartridge-ROM20 → RAM, block16 | 168 |
| Cartridge-ROM5 → fixed I/O, block16 | 44 |
| System-ROM20 → RAM, block16 | 22 |
| Two RAM20 channels, blocks16/4 | 94 |
| Captured config/live payload/BUSY rewrites | 10 |
| Faulting source still progresses to DONE/IRQ | 4 |

The two-channel trace was `(channel,words,deadline)`:
`(0,16,34),(1,4,44),(0,4,54),(1,4,64),(1,4,74),(1,4,84),(1,4,94)`.
All ordinary copied destination words, counts, DONE and IRQ requests were
asserted. The BUSY case changed the original payload plus programmed addresses,
count and CONTROL after admission; both owners transferred the changed payload
through the captured endpoints, overwrote address/count with captured
progression and retained the new CONTROL for the next block. START while BUSY
was ignored. The bus-fault case retained first-fault details while counting all
three slots and still raising completion.

The fixed-GP0-address replay used FORCE without a GPU owner and establishes only
DMA timing classification, not GPU acceptance. Actual GPU submission/pixel
behavior belongs to the ordinary cartridge execution, not that scratch replay.
No CPU issue-to-IRQ latency or sustained electrical bandwidth follows from these
cycle totals. The harnesses reused existing dependencies, not a new build layer.

Existing baseline DMA tests pass: 24 TypeScript tests and the native
`bmsx_dma_controller_tests` suite. These are scoped regression evidence, not
complete-manual acceptance or physical-machine qualification.

## Source/figure findings

The initial nonauthor review found a missing precondition in the overlap lesson:
alignment alone does not ensure writes modify memory. The final example assumes
ordinary writable RAM over A..A+15, outside I/O. DMD01 records the source
boundary. This was an editorial error, not an owner disagreement.

Initial register, control, status/trigger, visibility, request-edge, timing and
IRQ prose passes live-source review. The diagram has separate configuration and
live-payload routes, one admitted block and read-before-write service. Its
caption assigns address/count writeback to the serviced bank without falsely
drawing feedback only into one channel or rewriting CONTROL. Final requests/faults/reset and complete-example delta reviews pass. The final
reader independently verifies the full programming route and all six code fences.

## Software-authoritative limits

This edition follows the explicitly requested live software contract. No
independent DMA pin/bus oscillator, physical arbitration waveform, electrical
propagation guarantee or sustained transfer rating is declared by the scoped
owners. Those remain separate future hardware-specification decisions, not
invented numbers or pending editorial claims. Cartridge selector names do not
import Book II socket/card programming.

## Runnable cartridge: actual BIOS route

The [cartridge](../../../carts/dma_manual/README.md),
[entry module](../../../carts/dma_manual/cart.lua),
[retained BSS module](../../../carts/dma_manual/results.lua) and
[ordinary integration case](../../../tests/carts/dma_manual/dma_manual_assert.lua)
are normal cartridge artifacts. No runtime, firmware, compiler, cartlib,
runner or publisher source was edited. Six printed Lua blocks reproduce both
actual modules: one const-module block and five consecutive entry-module parts.
The chapter explicitly instructs concatenation in order into one entry module.

Executed against freshly built ordinary product and BIOS artifacts:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- dma_manual --debug
npm run headless:test -- dma_manual tests/carts/dma_manual/dma_manual_assert.lua
```

All builds and the integration case pass. Actual observations:

| Observation | Result |
|---|---|
| Seed RAM and both RAM destinations | All 60 words match the readonly source exactly, including high-bit/FFFFFFFF values |
| Completion sequences | DMA0=3; DMA1=1 |
| Two post-START status reads | Both BUSY1; not claimed to be an atomic sample or arbitration trace |
| Every completed record | Count0, STATUS2, TRIGGER0, CONTROL retained |
| Memory endpoints | Exactly80-byte advancement |
| GP0 transfer endpoints | Source+20 bytes; destination fixed0801023C |
| First GPU observation after DMA | Local24=0, idle26=0 for this controlled fill workload |
| Later GPU marker | Local24=1 and controller GPU bit6 set |
| Separate idle observation | Idle26=1 with local24 still set |
| Final owned IRQ bits | DMA0/DMA1/GPU bits clear, MASK0; disabled VBlank not required clear |
| Independent actual C0 pixel readback |0000001F at(0,0), high half zero for the odd final pixel |

A first execution passed, then product/BIOS rebuilds and repeat execution passed.
This is full normal TypeScript guest-path evidence, not native guest/backend
parity, electrical bandwidth, IRQ latency or displayed-picture acceptance.
The GPU marker/idle bits alone are not treated as pixel proof. Source ownership
and exclusive-port assumptions are stated before the listing; the sample owns
only its DMA sources in the handler, preserving unrelated masked pending bits.

The whole-reader and source reviews independently caught ambiguous STATUS fault
wording. It now says the read-only write faults **without changing** STATUS,
matching both Memory owners' immediate return. The reader also required explicit
concatenation of the five entry parts; that instruction is present. No runtime
behavior was changed to accommodate the example.


## Final acceptance

The nonauthor final source review rechecked current corrected prose, all tables,
P05/F01 predicates/reset, full code and observed results against live owners,
frozen sheets and actual execution evidence: no outstanding factual mismatch.
A separate final whole-reader reread found no remaining instructional failure
or placeholder. Both independently verified the exact printed two-module source.
All 16 existing manual tests pass; `git diff --check` is clean. These checks do
not substitute for the separately completed actual PDF-page visual inspection.
