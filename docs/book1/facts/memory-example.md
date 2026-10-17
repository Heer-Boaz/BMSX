# Executed static-storage cartridge: worked-example facts

Internal input only, 2026-10-17. A bounded complete memory-only program, not
whole-CPU/boot/device ownership approval. The exact two modules below built
through ordinary toolchain and executed after BIOS handoff. Root separately
ran `npm run validate:toolchain:cart -- memory_manual --debug` and
`npm run headless:test -- memory_manual tests/carts/memory_manual/memory_manual_assert.lua`;
the single integration case passed. This is execution through the current
headless tooling product, not native parity, a physical transfer measurement
or visual output. No runtime/compiler/BIOS/cartlib/runner change.

Source acceptance: [memory manuscript review](../reviews/memory-source.md).

## Worked facts and public limits

- MW01: The complete program consists of the storage module (`module<const>`)
  and entry module (`module<entry>`). The latter requires `storage`, takes
  typed address views from its exported static addresses, and executes at
  entry after generated DATA/BSS startup. These exact module forms and
  cross-module struct views compiled and ran; no general parameter/return or
  dynamic module ABI is inferred. Sources: the literal two modules below;
  startup facts BM15–17; test execution named above.
- MW02: A single `local input_count<const> = 2` supplies both record-array
  dimensions and the exported count. It is a source count, not a raw pointer
  or number of bytes. The named constant is necessary in this chosen constant
  export form: `input_count = #inputs` in the export table is rejected by the
  constant-module export producer even though # of a named static array is
  supported elsewhere. Do not describe # as universally exportable. Exact
  source for restriction: `toolchain/ts/lua/compiler/passes/const_module_exports.ts:46–111,
  115–144` (unary evaluator accepts Negate, not Length; identifier constants
  and static-address exports have explicit accepted paths). First ordinary
  build exposed this restriction; no compiler fix or fallback was added.
- MW03: `memory_sample` fields: tag u8 offset0 size1; alignment padding
  offsets1–3; value word offset4 size4; samples u16[2] offset8 size4.
  Struct alignment4 and total size12; array of2 occupies24 bytes. This follows
  BS03–08 layout and is separately checked by actual sizeof/offsetof/word
  values in the integration case.
- MW04: The two RODATA samples are exactly the literals in storage. The DATA
  counter is initially12345678H. BSS output is24 bytes; BSS status is12 bytes,
  with three word fields at offsets0,4,8. These are declared linked storage,
  not guessed numerical RAM addresses. Sources: both modules, BS11–14 and
  BM01–06; actual guest checks.
- MW05: At entry the program saves the initial counter, then ORs all6 output
  words before writing output. The observed initial counter was12345678H and
  the initial output OR was0. It then copies4 scalar fields per record, not
  a whole-struct assignment. Sources: entry module and guest test.
- MW06: At completion the output's six words, in address order, are
  00000011H,12345678H,33441122H,00000022H,9ABCDEF0H,77885566H. They equal the
  RODATA input's six words; the3 padding bytes per record remain0. Actual
  guest checks read every word and padding byte. These are data words, not
  device register addresses or special RAM bases.
- MW07: Final counter is1234567AH (initial+2), status.initial_counter
  12345678H, status.initial_output_or0 and status.completed1. Entry then loops
  on halt_until_irq; it does not configure/submit display, DMA, IRQ or any
  hardware job and claims no visible image. HALT is not a new completion IRQ
  source. Sources: entry and completed integration checks; do not add a
  general IRQ/wakeup/recovery contract to this example.
- MW08: Actual address checks confirmed &inputs[1]=input_base+12,
  &inputs[0].value=input_base+4, &inputs[0].samples[0]=input_base+8,
  &inputs[1].samples[1]=input_base+22, and corresponding output offsets.
  `input_bytes+1` was input_base+1, not &inputs[1], and accessed a zero padding
  byte. Do not print an unobserved absolute linked base or claim free-space
  ownership. Sources: sizeof/offsetof/type rules BS03–06/15–18 and guest case.
- MW09: Production code contains no assertions, validation layer, local byte
  encoder, raw allocator, register-table facade or private BIOS helper call.
  All diagnostic assertions are in the separate ordinary guest case. The
  listing is the complete production program, not the guest-test harness.
- MW10: This example supplies no asynchronous device buffer reuse, string
  byte ABI, dynamic-value contiguous storage, persistence/reboot or speed
  guarantee. For a hardware-facing buffer, the particular device's address,
  layout, count units, admission and completion/lifetime contract remains
  necessary. Do not present memory copy alone as a rendering example.

The ending HALT dispatch/callee does not request an IRQ: `machine/ts/machine/cpu/cpu.ts:1611-1619,2471-2473`; `machine/cpp/machine/cpu/cpu.cpp:1643-1651` and `cpu_dispatch.inl:132-135`. Existing pending-event consumption versus waiting does not add a new completion-interrupt source.

## Exact storage module

```lua
module<const>

local input_count<const> = 2

struct memory_sample
	tag: u8
	value: word
	samples: u16[2]
end

struct memory_status
	initial_counter: word
	initial_output_or: word
	completed: word
end

rodata inputs: memory_sample[input_count] = {
	{ tag = 0x11, value = 0x12345678, samples = { 0x1122, 0x3344 } },
	{ tag = 0x22, value = 0x9abcdef0, samples = { 0x5566, 0x7788 } },
}

data counter: word = 0x12345678
bss output: memory_sample[input_count]
bss status: memory_status

return {
	inputs = inputs,
	input_count = input_count,
	counter = counter,
	output = output,
	status = status,
}
```

## Exact entry module

```lua
module<entry>

local storage<const> = require('storage')
local inputs<const>: *memory_sample = storage.inputs
local output<const>: *memory_sample = storage.output
local counter<const>: *word = storage.counter
local status<const>: *memory_status = storage.status
local output_words<const>: *word = storage.output

-- Observe startup contents before writing the output records.
status.initial_counter = *counter
local initial_output_or = 0
for index = 0, storage.input_count * sizeof(memory_sample) // sizeof(word) - 1 do
	initial_output_or = initial_output_or | output_words[index]
end
status.initial_output_or = initial_output_or

-- Typed arrays start at zero. Copy scalar fields, not whole records.
for index = 0, storage.input_count - 1 do
	output[index].tag = inputs[index].tag
	output[index].value = inputs[index].value
	output[index].samples[0] = inputs[index].samples[0]
	output[index].samples[1] = inputs[index].samples[1]
end
*counter = *counter + storage.input_count
status.completed = 1

while true do
	halt_until_irq
end
```

---

# Actual memory-fault cartridge and terminal observations

Internal bounded facts-only author input, 2026-10-17. This is actual current TypeScript product/firmware execution, not native parity, a cycle measurement, UI-only verification, a new exception API, or general recovery proof. Other than the example and its ordinary host test, no runtime/compiler/BIOS/tooling changes.

MF01: Complete program is literal `carts/memory_fault_manual/entry.lua`, 11lines, included below. It declares one BSS Word, creates a typed Word view at0x01000000 and attempts to assign the dereferenced value to that BSS word. The only later source is a HALT loop. It defines no irq or exception callback, no display setup, byte encoder or register wrapper. Source: actual source below. Declaration/startup meanings use already audited memory-storage and memory-boot facts, not new rules from this observation.

MF02: Ordinary commands `npm run validate:toolchain:cart -- memory_fault_manual --debug` and `npm run ide:test -- memory_fault_manual tests/ide/memory_fault_manual.idetest.js` both exited0. Artifact9075e412f1a3486f1e27031ffe3e2915aef5ce79e817d2943d05d8aa8087573a. Test completed20assertions. Actual log `/tmp/bmsx-memory-fault-manual-execution.log`. This proves only this executed artifact and test, not all builds/platforms.

MF03: After BIOS handled the fault, actual physical mapped words: faultCODE1 at08010208H, faultADDR01000000H at0801020CH, faultACCESS00000801H at08010210H. Saved supervisor cause0000001CH and faultdomain0 were asserted; a retained cartridge source stack was present. Exact test `tests/ide/memory_fault_manual.idetest.js:4-17`. Numeric supervisor words are inspection details, not a replacement for complete system-register reference. The actual load disassembled as LOAD_MEM_D Wordkind0 at1001A7ECH in this artifact. EPC is linked/build-specific, NOT universal.

MF04: Actual BIOS terminal output included `EXCEPTION DBE  DATA BUS ERROR`, cause0000001C, status0000000C, IRQMASK00000000, and the faulting source statement. Root individually viewed original320×240 `tests/ide/screenshots/frame_00071.png` from this run. Image is unmodified, no labels or magnification painted into it. Meaning of the CPU status/cause uses separately extracted handler/COP0 facts. DBE does not by itself establish a new CP0 BAD_ADDRESS; actual paired primary evidence TS cpu.ts:1732-1739 versus3073-3077, C++cpu.cpp:2290-2297 versus cpu_dispatch.inl:571-575.

MF05: Test sends real keyboard button down/up events for `MEM 08010208 3`, then Enter, without running guest expressions or changing registers/handlers. Actual terminal line:

```text
08010208: 00000001 01000000 00000801
```

Root individually viewed original screenshot `frame_00146.png`; console log reproduces the same line. This is three addressed 32bitwords starting at CODE, not three CPU cause registers or an electrical trace. Test source:21-32. The full-image target for the manual may be `figures/memory-bus-fault.png`; preserve bytes of this actual screenshot.

MF06: Test then types `FAULT CLEAR`, Enter. Hardware CODE/ADDR/ACCESS remain exactly1/01000000H/801H; the physical supervisor fault sequence is unchanged. Root viewed `frame_00209.png`, showing typed command and prompt, no automatic resume. Test source:21-42. Software clearing semantics and no acknowledgment require the separate live monitor/commands facts; do not infer all effects solely from this observation.

MF07: Test then types `CONT`, Enter, without repairing the invalid address. A new physical supervisor fault sequence appears and saved cause is againDBE; the original hardware CODE/ADDR/ACCESS remain latched. Console prints the same current-artifact EPC1001A7EC and faulting source. Root viewed `frame_00244.png`, visually equal to the initial fault screen; new fault sequence/console establish real reentry, not image difference. Test source:36-39. This is retry failure, NOT successful recovery or automatic instruction skipping.

MF08: The host test is actual input plus read-only physical machine inspection. It never executes Studio commands, writes guest state through the runtime, restores snapshots, replaces exception handling, manipulates source, acknowledges the bus fault, or enables missing interrupts to make progress. It uses the existing IDE-test harness only as execution/evidence infrastructure. Do not describe it as pure UI-only proof, normal headless-player output, or a required cartridge dependency.

## Literal complete cartridge

```lua
module<entry>

bss reached_after_load: word
local unmapped<const>: *word = 0x01000000

-- This unmapped load enters the BIOS monitor before the assignment completes.
*reached_after_load = *unmapped

while true do
	halt_until_irq
end

```

## Subsequent device-buffer example executions

Root, 2026-10-17, starting at `dbf99b501`; no runtime/cartridge source changes.
The current tooling product build, full cart validation and ordinary named guest
suite for each of GEO, GTE, IMGDEC and APU exited zero. Exact test sources were
read, not inferred from file names. These are existing working routes, not newly
executed mutation/alias/fault-attribution tests.

| Project / actual case | Primary assertions | Bounded observation and actual log |
|---|---|---|
| `geo_manual` / `transforms_sat_contacts_and_fault_ack` | `tests/carts/geo_manual/geo_manual_assert.lua:1-73` | All vertices/AABBs, SAT, both contacts/summaries, six phases, local fault ACK, five DONE/one ERROR; `/tmp/bmsx-memory-buffers-geo_manual.log` |
| `gte_manual` / `static_operand_layout`, `geometry_color_and_buffer_lifetime` | `tests/carts/gte_manual/gte_manual_assert.lua:1-82` | Normal operand layout/projection/color and original triangle captures, NOT timed PLUS; `/tmp/bmsx-memory-buffers-gte_manual.log` |
| `imgdec_manual` / `ram_gp0_fault_and_recovery` | `tests/carts/imgdec_manual/imgdec_manual_assert.lua:1-101` | 26 retained words/four phases plus separate 12 texture/8 CLUT GPUREAD checks; `/tmp/bmsx-memory-buffers-imgdec_manual.log` |
| `apu_manual` / `pcm_transfer_generator_and_badp` | `tests/carts/apu_manual/apu_manual_assert.lua:1-93` | Sixteen-word private-RAM transfer, distinct upload/commit/download-STOP, paused active source, four end events; NOT audible evidence; `/tmp/bmsx-memory-buffers-apu_manual.log` |

Separately, the existing TypeScript GTE owner suite ran 43 tests, all passed:
`npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts tests/lua/gx_gte.test.ts`.
Log `/tmp/bmsx-memory-plus-owner-tests.log`. This is owner-level PLUS coverage,
not a new complete cartridge program or native execution. No universal latency,
whole-console coverage or newly captured mutation result follows.
