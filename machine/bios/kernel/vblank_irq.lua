module<const>

local gc<const> = require('kernel/gc_maintenance')
local layout<const> = require('kernel/gc_runtime_layout')
local source<const> = 0x0004
bss cartridge_target: word

local user_irq<const> = function()
	local accepted_irq<const>: *word = 0x083fd8d4
	local accepted<const> = *accepted_irq
	if (accepted & source) ~= 0 then
		gc.vblank_maintenance(layout.management_offset, accepted >> 31, 0)
	end
	-- The cartridge's IRQ vector still reads and acknowledges its sources.
	local target<const>: *word = cartridge_target
	cop0.exception_target = *target
end

return { source = source, user_irq = user_irq, cartridge_target = cartridge_target }
