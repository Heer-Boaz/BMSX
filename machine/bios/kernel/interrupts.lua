local interrupts<const> = {}
local handlers<const> = {}
local irq_ack<const>: *word = 0x08000004

function interrupts.dispatch(flags)
	local ack = 0
	for mask, handler in pairs(handlers) do
		if (flags & mask) ~= 0 then
			handler(flags & mask, flags)
			ack = ack | (flags & mask)
		end
	end
	if ack ~= 0 then
		*irq_ack = ack
	end
	return ack
end

function interrupts.on(mask, handler)
	handlers[mask] = handler
end

return interrupts
