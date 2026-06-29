-- os.lua
-- BIOS os compatibility backed by BMSX time registers.

local time_ms<const>: *word = sys_time_ms

function clock_now()
	return time_ms[0]
end

os.clock = function()
	return time_ms[0] / 1000
end

return os
