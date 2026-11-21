module<entry>

-- A changing scanout and a continuous hardware voice exercise the transport.
-- The long retention test need not render or simulate a full game each tick.
local display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
require('cartlib/apu') -- Provides the command register layout.

local pmode<const>: *word = 0x08010354
local background<const>: *word = 0x0801037c
local command<const>: *word = 0x08000120
local input_control<const>: *word = 0x08000064
local pad_buttons<const>: *word = 0x0800009c

rodata tone: apu_command_registers = {
	source_addr = 0, source_bytes = 0, sample_rate_hz = 440,
	channels = 1, bits_per_sample = 16, frame_count = 1,
	data_offset = 0, data_bytes = 0, loop_start_sample = 0, loop_end_sample = 1,
	slot = 4, rate_step_q16 = 0x00010000, gain_q12 = 0x00000400,
	start_sample = 0, filter_control = 0, filter_b0_b1 = 0x00004000,
	filter_b2_a1 = 0, filter_a2 = 0, fade_samples = 0,
	generator_kind = 1, generator_duty_q12 = 0x00000800, cmd = 1,
}
local tone_words<const>: *word = tone
for index = 0, 21 do
	command[index] = tone_words[index]
end

display.reset_256x192()
*pmode = 0
-- Suspend with an implicit result placement still live in the guest frame.
local next_frame<const> = setmetatable({}, {
	__index = function(_, tick)
		vblank.wait()
		return tick
	end,
})
local frame = 0
while true do
	*background = 0x00400000 | ((*pad_buttons & 0x7f) << 8) | (frame & 0xff)
	*input_control = 1
	frame = next_frame[frame + 1]
end
