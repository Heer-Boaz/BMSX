local events<const> = require('kernel/interrupts')

local irq_flags<const>: *word = 0x08000000
local irq_ack<const>: *word = 0x08000004
local dma_sequence<const>: *word = events.dma_completion_sequence
local vblank_count<const>: *word = events.vblank_count

local handled<const> = *irq_flags & (events.dma_done | events.vblank)
if handled == 0 then return end
if (handled & events.dma_done) ~= 0 then
	*dma_sequence = *dma_sequence + 1
end
if (handled & events.vblank) ~= 0 then
	*vblank_count = *vblank_count + 1
end
*irq_ack = handled
