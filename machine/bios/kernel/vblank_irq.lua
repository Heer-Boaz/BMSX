module<const>

local gc<const> = require('kernel/gc_maintenance')
local layout<const> = require('kernel/gc_runtime_layout')
local events<const> = require('kernel/interrupts')
local bridge<const> = require('kernel/exception_bridge')
bss cartridge_target: word
bss cartridge_frame_width: word

local user_irq<const> = function()
	local accepted_irq<const>: *word = 0x083fd8d4
	local accepted<const> = *accepted_irq
	if (accepted & events.vblank) ~= 0 then
		gc.vblank_maintenance(layout.management_offset, accepted >> 31, 0)
	end
	-- The cartridge's IRQ vector still reads and acknowledges its sources.
	local target<const>: *word = cartridge_target
	local width<const>: *word = cartridge_frame_width
	bridge.prepare(*width, false)
	cop0.exception_target = *target
end

return { user_irq = user_irq, cartridge_target = cartridge_target, cartridge_frame_width = cartridge_frame_width }
