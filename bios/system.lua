local romdir<const> = require('system/romdir')

local system<const> = {}
local irq_handlers<const> = {}

system.rom_data = romdir.data

function system.irq(flags)
	local ack = flags
	for mask, handler in pairs(irq_handlers) do
		if (flags & mask) ~= 0 then
			handler(flags & mask, flags)
			ack = ack | (flags & mask)
		end
	end
	mem[sys_irq_ack] = ack
	return ack
end

function system.on_irq(mask, handler)
	irq_handlers[mask] = handler
end

return system
