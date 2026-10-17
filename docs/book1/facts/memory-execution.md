# Execution addressing and instruction fetch: bounded facts

Internal authoring input, extracted 2026-10-17. No architecture document or
reference PDF read. Scope is the paired instruction-format/domain leaves,
CPU fetch/function-record/EXEC methods, the directly named execution-address
owner and mapped big-endian read. This is not a complete CPU ISA, permission,
cartridge-controller, writable-code/coherency or call ABI. No runtime changes.

Source acceptance: [memory foundations review](../reviews/memory-foundations-source.md).

## Representation and selection

**EF01. Instruction words occupy four bytes and their byte representation is
big-endian.** The format producer writes high byte first and reads it back in
that order. This is distinct from the already sourced little-endian scalar
main-RAM data and image descriptor words. It is not a claim that every kind of
console data has one byte order.
Sources: `machine/ts/spec/blua32/instruction_format.ts:1,58-71`;
`machine/cpp/spec/blua32/instruction_format.h:8,47-48`;
`machine/cpp/spec/blua32/instruction_format.cpp:28-42`;
LE scalar contrast `machine/ts/machine/memory/memory.ts:503-521,544-570` /
`machine/cpp/machine/memory/memory.cpp:393-411,434-460`;
LE image-descriptor producer `toolchain/ts/rompack/blua32_linker.ts:859-882`.

**EF02. Execution domains are system -1 and cartridge slots 0 and 1.** There
are three domains. Domain masks are system 1 and all-domains 7, with bit
`1 << (domain + 1)`. These IDs/masks are not RAM addresses or isolated RAM
allocations.
Sources: `machine/ts/spec/blua32/execution_domain.ts:1-11`;
`machine/cpp/spec/blua32/execution_domain.h:7-16`.

**EF03. Active-image execution selects its cartridge socket on the instruction
fetch bus.** Latching the active image retains CPU bus signals for system or
an explicit slot override for cartridge domain 0/1; instruction decode passes
those signals into each mapped instruction-word read. The helper encodes
slot override 4 and slot1 bit8, but these are internal bus-strobe encodings,
not new MMIO register fields to expose publicly. This does not establish all
CALL/data-access/socket-selection policy.
Sources: `machine/ts/machine/cpu/cpu.ts:1145-1155,1257-1298`;
`machine/cpp/machine/cpu/cpu.cpp:665-673,826-869`;
`machine/ts/machine/memory/bus_signals.ts:1-5,12-14`;
`machine/cpp/machine/memory/bus_signals.h:9-24`.

**EF04. Address-to-domain selection and instruction reading are different
operations.** `domainIdOnBus` returns system for the SystemRom mapped region,
the selected socket for Cartridge region and no new domain for other regions.
`readFunctionRecordOnBus` uses the ambient execution image when that query
returns no domain. Thus those methods do not prove that any non-ROM address is
universally non-executable, or that RAM creates its own execution image.
Sources: `machine/ts/machine/execution_address_space.ts:36-44`;
`machine/cpp/machine/execution_address_space.cpp:10-24`;
`machine/ts/machine/cpu/cpu.ts:1499-1508`;
`machine/cpp/machine/cpu/cpu.cpp:1082-1092`.

**EF05. A function address denotes a record, not its first instruction.** The
record's CODE_ADDRESS word is read little-endian, via direct readable page or
mapped LE32 fallback, and is separate from instruction-word BE decode. EXEC
reads the target record, requires STATIC and otherwise hard-halts; on success
it clears the call stack, latches the target image/domain, sets entry status
and pushes the static function with zero arguments. This extends existing
BM14/BM28, not a promise that copying instruction bytes to RAM alone creates a
callable function or a valid image. Full record validation and arbitrary-call
policy are not extracted here.
Sources: `machine/ts/machine/cpu/cpu.ts:1424-1496,1523-1546`;
`machine/cpp/machine/cpu/cpu.cpp:1019-1079,1095-1118`;
frame PC from CODE_ADDRESS `machine/ts/machine/cpu/cpu.ts:3220-3225` /
`machine/cpp/machine/cpu/cpu.cpp:3009-3011`;
record specification `machine/ts/spec/blua32/image_format.ts:30-42`;
`machine/cpp/spec/blua32/image_format.h:36-48`.

## Fetch edges and faults

**EF06. PC is four-byte aligned at the ordinary instruction-dispatch edge.**
The ordinary run path tests `PC & 3` before decoding; failure writes BAD_ADDRESS
and enters address-error-load at that PC. The native templated path applies
the same test. A WIDE prefix causes a second four-byte word to be fetched from
PC+4 and decoded as the body; a normal decoded instruction has width one word,
a WIDE instruction two. This extract makes no unqualified overflow/wrap claim
for PC+4 or width advance at the top of the address space, and no complete ISA
claim about malformed prefix combinations.
Sources: `machine/ts/machine/cpu/cpu.ts:1257-1298,1829-1853`;
`machine/cpp/machine/cpu/cpu.cpp:826-869,2439-2475`.

**EF07. Instruction decode reads mapped BE32 words and observes bus-fault
sequence changes.** After either prefix/normal word or WIDE body read, a
changed sequence enters instruction-bus-error with the original instruction
PC. The BE32 memory method obtains a mapped LE32 word and byte-reverses it;
this is not a separate permission-bypassing/raw-backing read. The default
memory fault-access code is READ_U32, not an invented distinct FETCH code.
This statement covers a decode/read edge, not a claim every cached instruction
is reread on every dispatch or that all mapped regions have equal fetch side
effects/permissions.
Sources: `machine/ts/machine/cpu/cpu.ts:1257-1298`;
`machine/cpp/machine/cpu/cpu.cpp:826-869`;
`machine/ts/machine/memory/memory.ts:528-538`;
`machine/cpp/machine/memory/memory.cpp:418-429`;
default argument `machine/cpp/machine/memory/memory.h:83-87`.

**EF08. Fetch exceptions retain the faulting instruction PC, not the WIDE
body address.** The fetch-exception helper charges one cycle, restores the
interrupted frame PC to the supplied PC and enters the system exception
function. Exception entry records EPC and CAUSE, shifts the low six status
mode-stack bits left by two (preserving the remaining status bits), clears the
HALT wait and pushes the exception frame. This is the specific entry edge,
not the BIOS handler/recovery/return contract or a physical bus latency.
CAUSE address-error-load is `4 << 2 = 0x10`, instruction-bus-error
`6 << 2 = 0x18`; CAUSE code mask is `0x7c`. These indices/words come from the
paired COP0 spec, not new CPU-mapped MMIO words.
Sources: `machine/ts/machine/cpu/cpu.ts:1742-1746,1764-1784`;
`machine/cpp/machine/cpu/cpu.cpp:2300-2304,2312-2339`;
`machine/ts/spec/blua32/cop0.ts:1-24`;
`machine/cpp/spec/blua32/cop0.h:7-30`.

## Explicit gaps

No complete executable-region table, user-mode memory protection, code-write
coherency/self-modification, branch/call ABI, instruction listing, complete
COP0 programming/BIOS exception-handler API, bus bandwidth/arbitration,
cache/fetch timing or all-PC overflow behavior is established. Boot image
base-plus-offset overflow remains separately WITHHELD in BM22; this extract
neither repairs nor resolves it. Metadata binding to installed ROM is not an
execute-never proof for all RAM; conversely mapped instruction reads do not
suffice to teach a valid RAM-resident program.

## Narrow nominal instruction-cost extension

**EF09. The installed model's CPU/system-cycle frequency is 33,868,800 cycles
per second.** This is the cycle timebase, not a separately proved electrical
RAM/ROM/VRAM bus clock or a promise of sustained byte bandwidth. The ordinary
installed producer chain uses the canonical model (already separately audited
ML02–ML03); no cartridge-selectable profile is inferred.
Sources: `machine/ts/spec/bmsx/model.ts:7,27-38,46-57`;
`machine/cpp/spec/bmsx/model.h:12,32-43,51-62`;
ordinary installed chain primary ranges are ML02–ML03 in memory-lifecycle.md.

**EF10. Scalar memory instruction base charge is two cycles.** Nominal
BASE_CYCLES for LOAD_MEM, STORE_MEM and their scalar displaced forms
LOAD_MEM_D/STORE_MEM_D are2; ADD/SUB/MUL base1; WIDE base0. The decoded dispatch
base table copies those entries, and ordinary dispatch subtracts the selected
base before executing. These are instruction base charges, not a BLua source
expression cost, bus-word duration or throughput guarantee. This extract does
not turn the vector-store base entries into whole-transfer cost and does not
specify store-admission wait/retry, interrupts, exceptions, device completion
or complete program time. A WIDE body's dispatch uses its decoded body op and
word width; no additional standalone prefix dispatch is inserted on this
named decode/run path. Existing EF08 separately states the fetch-exception
helper's one-cycle charge, not a new physical fetch latency.
Sources: `machine/ts/spec/blua32/opcode.ts:1-65,75-84`;
`machine/cpp/spec/blua32/opcode.cpp:5-25,52-57`;
`machine/ts/machine/cpu/execution_image.ts:20-24`;
`machine/cpp/machine/cpu/execution_image.cpp:7-14`;
`machine/ts/machine/cpu/cpu.ts:1257-1298,1842-1853`;
`machine/cpp/machine/cpu/cpu.cpp:826-869,2465-2486`.
