-- clock.lua
-- Cart-library clock helpers backed by the machine time and VBlank-timing words.

module<const>

-- Tick work is admitted to one of two retained schedules. Gameplay time can be
-- stopped by game-flow ownership; frame work remains admitted whenever the
-- cart advances its world, so transitions and modal presentation can continue.
-- The bit values are also the component tick-lane mask.
local gameplay<const> = 0x01
local frame<const> = 0x02
bss cartlib_update_milliseconds_q16: word

local milliseconds<const> = function()
	local time_milliseconds<const>: *word = 0x08010228
	return *time_milliseconds
end

-- A cart's world module fixes its update quantum before authored timeline and
-- animation modules initialize. Systems consume this retained value directly;
-- a two-VBlank update therefore advances millisecond transports by two
-- physical frame periods without sampling platform time.
local configure_update_interval<const> = function(vblank_interval)
	local vblank_milliseconds_q16<const>: *word = 0x0801022c
	*cartlib_update_milliseconds_q16 = *vblank_milliseconds_q16 * vblank_interval
	return *cartlib_update_milliseconds_q16 / 0x00010000
end

local update_milliseconds<const> = function()
	return *cartlib_update_milliseconds_q16 / 0x00010000
end

-- SYS_TIME_MS is a wrapping hardware word. Durations shorter than one complete
-- word period use the unsigned distance between two retained samples.
local elapsed_milliseconds<const> = function(start_time_ms, current_time_ms)
	local elapsed<const> = current_time_ms - start_time_ms
	if elapsed < 0 then
		return elapsed + 0x100000000
	end
	return elapsed
end

return {
	gameplay = gameplay,
	frame = frame,
	milliseconds = milliseconds,
	configure_update_interval = configure_update_interval,
	update_milliseconds = update_milliseconds,
	elapsed_milliseconds = elapsed_milliseconds,
}
