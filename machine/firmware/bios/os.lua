-- os.lua
-- BIOS os compatibility backed by BMSX time registers.

local numeric<const> = require('bios/common/numeric')
local trunc<const> = numeric.trunc
local time_ms<const>: *word = sys_time_ms

function clock_now()
	return time_ms[0]
end

os.clock = function()
	return time_ms[0] / 1000
end

os.difftime = function(t2, t1)
	local t2_int<const> = trunc(t2)
	local t1_int<const> = trunc(t1)
	if t2_int ~= t2 then
		error('os.difftime t2 must be an integer.')
	end
	if t1_int ~= t1 then
		error('os.difftime t1 must be an integer.')
	end
	return t2_int - t1_int
end

return os
