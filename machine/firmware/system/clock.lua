-- clock.lua
-- BIOS clock module backed by the machine clock builtin.

local clock<const> = {
	now = clock_now,
	perf_now = clock_now,
}

local frame_milliseconds_q16<const>: *word = 0x08010228

function clock.frame_milliseconds()
	return *frame_milliseconds_q16 / 0x00010000
end

return clock
