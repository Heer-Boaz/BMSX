-- clock.lua
-- BIOS clock module backed by the machine clock builtin.

local clock<const> = {
	now = clock_now,
	perf_now = clock_now,
}

return clock
