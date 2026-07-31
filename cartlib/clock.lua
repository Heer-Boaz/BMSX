-- clock.lua
-- Cart-library clock helpers backed by the machine time and frame-timing words.

local clock<const> = {}

local time_milliseconds<const>: *word = 0x08010224
local frame_milliseconds_q16<const>: *word = 0x08010228

function clock.milliseconds()
	return *time_milliseconds
end

function clock.frame_milliseconds()
	return *frame_milliseconds_q16 / 0x00010000
end

return clock
