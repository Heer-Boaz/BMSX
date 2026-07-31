local interrupts<const> = {}
local handlers<const> = {}
local irq_ack_addr<const> = 0x08000004

function interrupts.dispatch(flags)
	local ack = 0
	for mask, handler in pairs(handlers) do
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

function interrupts.on(mask, handler)
	handlers[mask] = handler
end

return interrupts
