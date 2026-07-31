local irq_ack_register<const>: *word = 0x08000004

local handlers<const> = {}
local irq<const> = {}

function irq.register(mask, handler)
	handlers[mask] = handler
end

function irq.unregister(mask)
	handlers[mask] = nil
end

function irq.dispatch(flags)
	local ack = 0
	for mask, handler in pairs(handlers) do
		local matched<const> = flags & mask
		if matched ~= 0 then
			handler(matched, flags)
			ack = ack | matched
		end
	end
	if ack ~= 0 then
		*irq_ack_register = ack
	end
end

return irq
