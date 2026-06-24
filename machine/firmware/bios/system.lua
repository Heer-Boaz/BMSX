local system<const> = {}
local irq_handlers<const> = {}
local irq_ack_addr<const> = 0x0800010c

function system.irq(flags)
	local ack = 0
	for mask, handler in pairs(irq_handlers) do
		if (flags & mask) ~= 0 then
			handler(flags & mask, flags)
			ack = ack | (flags & mask)
		end
	end
	if ack ~= 0 then
		mem[irq_ack_addr] = ack
	end
	return ack
end

function system.on_irq(mask, handler)
	irq_handlers[mask] = handler
end

return system
