module<const>

local layout<const> = require('kernel/gc_runtime_layout')
local word_mask<const> = 0x003ffffc
local control_count_mask<const> = (1 << 18) - 1
local completion_or_exception<const> = (1 << 0) | (1 << 1)
local cartridge_bank<const> = 1 << 3

local yieldable<const> = function(address, protected_handler)
	local thread<const>: *stopped_thread = address
	local block<const>: *stopped_frame = layout.ram_base + (thread.frame_block & word_mask)
	for i = (thread.frame_depth & control_count_mask) - 1, 0, -1 do
		local flags<const> = block[i].flags
		if (flags & completion_or_exception) ~= 0
			or ((flags & cartridge_bank) == 0 and block[i].fn == protected_handler) then
			return false
		end
	end
	return true
end

return yieldable
