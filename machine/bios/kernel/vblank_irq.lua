module<const>

local gc<const> = require('kernel/gc_maintenance')
local source<const> = 0x0004

local before_cart_irq<const> = function(management, enabled_flags, waiting)
	if (enabled_flags & source) ~= 0 then
		gc.vblank_maintenance(management, waiting, 0)
	end
	-- The cartridge's IRQ vector still reads and acknowledges its sources.
end

return { source = source, before_cart_irq = before_cart_irq }
