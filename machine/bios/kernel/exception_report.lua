module<const>

local nmi<const> = 0x00010000
local enter<const>, leave<const> = 0x02, 0x04
local fault<const>, publish<const> = 0x08, 0x10

local report<const> = function(cause)
	local control<const>: *word = 0x0801034c
	if (cause & nmi) ~= 0 then
		-- A SYSTEM request has already quiesced the running devices.
		*control = enter | leave
		return true
	end
	*control = fault | publish
	return false
end

return { report = report }
