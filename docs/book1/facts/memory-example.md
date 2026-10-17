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
