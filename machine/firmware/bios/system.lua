local system<const> = {}
local irq_handlers<const> = {}
local irq_ack_addr<const> = 0x0800010c

function system.irq(flags)
	local ack = flags
	for mask, handler in pairs(irq_handlers) do
		if (flags & mask) ~= 0 then
			handler(flags & mask, flags)
			ack = ack | (flags & mask)
		end
	end
	mem[irq_ack_addr] = ack
	return ack
end

function system.on_irq(mask, handler)
	irq_handlers[mask] = handler
end

return system
