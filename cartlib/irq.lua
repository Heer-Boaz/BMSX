local irq_ack_register<const>: *word = 0x08000004
local irq_mask_register<const>: *word = 0x08000008

local handlers<const> = {}
local irq_dispatcher<const> = {}

-- One retained callback slot corresponds to one physical IRQ source bit. The
-- dispatcher walks only asserted, unmasked sources instead of scanning every
-- registered subsystem on every interrupt. Each source is acknowledged before
-- its callback so an edge raised during the callback remains pending. The
-- callback owner also owns the corresponding hardware mask bit. Physical
-- source words live in the compile-time cartlib/irq/source contract.
function irq_dispatcher.register(source, handler)
	handlers[source] = handler
	*irq_mask_register = *irq_mask_register | source
end

function irq_dispatcher.unregister(source)
	handlers[source] = nil
	*irq_mask_register = *irq_mask_register & ~source
end

-- Requiring cartlib/irq installs the cartridge IRQ vector before any subsystem
-- can unmask its source. Bare-metal carts remain free to define their own irq()
-- instead of requiring this dispatcher.
function irq(flags)
	local pending = flags & *irq_mask_register
	while pending ~= 0 do
		local source<const> = pending & (0 - pending)
		local handler<const> = handlers[source]
		*irq_ack_register = source
		handler(source)
		pending = pending - source
	end
end

return irq_dispatcher
