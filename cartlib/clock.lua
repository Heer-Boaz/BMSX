-- clock.lua
-- Cart-library clock helpers backed by the machine time and VBlank-timing words.

module<const>

-- Tick work is admitted to one of two retained schedules. Gameplay time can be
-- stopped by game-flow ownership; frame work remains admitted whenever the
-- cart advances its world, so transitions and modal presentation can continue.
-- The bit values are also the component tick-lane mask.
local gameplay<const> = 0x01
local frame<const> = 0x02
bss cartlib_gameplay_delta_milliseconds_q16: word
bss cartlib_frame_delta_milliseconds_q16: word

local milliseconds<const> = function()
	local time_milliseconds<const>: *word = 0x08010228
	return *time_milliseconds
end

-- World configuration fixes both schedule quanta before runtime program
-- registration and object construction. Gameplay may advance less often than
-- the frame schedule, so retaining one shared delta would couple simulation
-- pacing to presentation cadence.
local configure_tick_intervals<const> = function(
	gameplay_interval_vblanks,
	frame_interval_vblanks
)
	local system_frame_milliseconds_q16<const>: *word = 0x0801022c
	local physical_frame_milliseconds_q16<const> = *system_frame_milliseconds_q16
	*cartlib_gameplay_delta_milliseconds_q16 =
		physical_frame_milliseconds_q16 * gameplay_interval_vblanks
	*cartlib_frame_delta_milliseconds_q16 =
		physical_frame_milliseconds_q16 * frame_interval_vblanks
	return *cartlib_gameplay_delta_milliseconds_q16 / 0x00010000,
		*cartlib_frame_delta_milliseconds_q16 / 0x00010000
end

local gameplay_delta_milliseconds<const> = function()
	return *cartlib_gameplay_delta_milliseconds_q16 / 0x00010000
end

local frame_delta_milliseconds<const> = function()
	return *cartlib_frame_delta_milliseconds_q16 / 0x00010000
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
	configure_tick_intervals = configure_tick_intervals,
	gameplay_delta_milliseconds = gameplay_delta_milliseconds,
	frame_delta_milliseconds = frame_delta_milliseconds,
	elapsed_milliseconds = elapsed_milliseconds,
}
