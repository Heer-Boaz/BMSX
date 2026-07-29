-- clock.lua
-- Cart-library clock helpers backed by the firmware clock and frame-timing word.

local clock<const> = {}

local frame_milliseconds_q16<const>: *word = 0x08010228

function clock.frame_milliseconds()
	return *frame_milliseconds_q16 / 0x00010000
end

return clock
