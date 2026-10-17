module<entry>

local state<const> = require('results')
local result<const>: *input_manual_result = state.result
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local control<const>: *word = 0x08000064
local status<const>: *word = 0x08000068
local keys<const>: *word = 0x0800006c
local pointer<const>: *word = 0x0800008c
local pads<const>: *word = 0x0800009c
local output_status<const>: *word = 0x08000118

function irq(flags)
	*irq_ack = flags & 0x00000004
end

-- This isolated cartridge owns the input latch and central VBlank IRQ route.
*irq_mask = 0
*control = 2
*irq_ack = 0x00000004
*irq_mask = 0x00000004
local previous_key = 0

while true do
	local before<const> = *status
	*control = 1
	while *status == before do
		halt_until_irq
	end

	-- Do not re-arm until every word of this retained snapshot has been read.
	for index = 0, 7 do
		result.keyboard[index] = keys[index]
	end
	result.pointer_buttons = pointer[0]
	result.pointer_x = pointer[1]
	result.pointer_y = pointer[2]
	result.pointer_wheel = pointer[3]
	for index = 0, 27 do
		result.pads[index] = pads[index]
	end
	result.rumble_support = *output_status
	result.previous_sequence = before
	result.sample_sequence = *status

	-- HID usage 04H occupies bit 4 of keyboard word 0. These are software edges.
	local current<const> = result.keyboard[0] & 0x00000010
	result.key_a = current
	result.key_pressed = current & ~previous_key
	result.key_released = previous_key & ~current
	if result.key_pressed ~= 0 then
		result.press_count = result.press_count + 1
		result.last_press = result.key_pressed
	end
	if result.key_released ~= 0 then
		result.release_count = result.release_count + 1
		result.last_release = result.key_released
	end
	previous_key = current
	result.completed_samples = result.completed_samples + 1
end
