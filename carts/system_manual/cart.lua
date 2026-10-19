module<entry>

local state<const> = require('results')
local result<const>: *system_manual_result = state.result
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local time_ms<const>: *word = 0x08010228
local frame_ms_q16<const>: *word = 0x0801022c
local print_char<const>: *word = 0x08010230
local print_flush<const>: *word = 0x08010234
local cycles_per_frame<const>: *word = 0x08010238
local control<const>: *word = 0x0801034c
local status<const>: *word = 0x08010350
local fault_words<const>: *word = 0x08010428

function irq(flags)
	if (flags & 0x00000004) ~= 0 then
		*irq_ack = 0x00000004
		result.vblanks = result.vblanks + 1
	end
end

-- Fresh BIOS entry, current user mode, exclusive VBlank handler and mask.
-- Keep the inherited running beam; do not reprogram PCRTC in this example.
*irq_mask = 0
*irq_ack = 0x00000004
*irq_mask = 0x00000004

-- All four supervisor commands are ignored in current user mode. No RESET.
*control = 0x0000001e
result.ignored_control = *control
result.ignored_status = *status
for index = 0, 5 do
	result.faults[index] = fault_words[index]
end

-- BIOS functions are ordinary globals. These are separate clock reads.
result.clock_before_ms = *time_ms
result.clock_seconds = os.clock()
result.clock_after_ms = *time_ms
result.time_before_ms = *time_ms
result.time_seconds = os.time()
result.time_after_ms = *time_ms
print('SYSTEM timer experiment')

for index = 0, 3 do
	local sample<const>: *system_manual_sample = &result.samples[index]
	sample.before_ms = *time_ms
	while ((*time_ms - sample.before_ms) % 0x100000000) < 100 do
		halt_until_irq
	end
	sample.after_ms = *time_ms
	sample.elapsed_ms = (sample.after_ms - sample.before_ms) % 0x100000000
	sample.frame_ms_q16 = *frame_ms_q16
	sample.cycles_per_frame = *cycles_per_frame
	sample.status = *status
	result.completed_samples = index + 1
end

-- Raw codepoints, not UTF-8 bytes: S, é, a supplementary character, invalid.
*print_char = 0x00000053
*print_char = 0x000000e9
*print_char = 0x0001f600
*print_char = 0xffffffff
result.char_readback = *print_char
*print_flush = 0
result.flush_readback = *print_flush
print('SYSTEM samples complete')

while true do
	halt_until_irq
end
