module<entry>

local state<const> = require('results')
local result<const>: *irq_manual_result = state.result
local irq_flags<const>: *word = 0x08000000
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240

function irq(flags)
	result.handler_flags[result.gpu_services] = flags
	if (flags & 0x00000040) ~= 0 then
		if result.gpu_services == 0 then
			-- The vector supplied the complete pending word, not FLAGS & MASK.
			result.phases[4].flags = flags
			result.phases[4].mask = *irq_mask
			result.phases[4].gpu_local = *gp1 & 0x01000000
			result.phases[4].services = result.gpu_services
			result.phases[4].ack = *irq_ack
		end
		*gp1 = 0x02000000
		*irq_ack = 0x00000040
		result.gpu_services = result.gpu_services + 1
	end
end

-- Keep the standard BIOS's running beam; this is not a display-reset demo.
*irq_mask = 0
while (*gp1 & 0x04000000) == 0 do
end
*gp1 = 0x02000000
-- Preparation clears stale boot requests but deliberately preserves VBlank.
*irq_ack = 0xfffffffb
while (*irq_flags & 0x00000004) == 0 do
end
result.phases[0].flags = *irq_flags
result.phases[0].mask = *irq_mask
result.phases[0].gpu_local = *gp1 & 0x01000000
result.phases[0].services = result.gpu_services
result.phases[0].ack = *irq_ack
result.completed_phase = 0

-- First masked GPU request: the controller retains both pending sources.
*gp0 = 0x1f000000
while (*gp1 & 0x01000000) == 0 do
end
result.phases[1].flags = *irq_flags
result.phases[1].mask = *irq_mask
result.phases[1].gpu_local = *gp1 & 0x01000000
result.phases[1].services = result.gpu_services
result.phases[1].ack = *irq_ack
result.completed_phase = 1

-- Clear only the source latch. The controller's pending bit is independent.
*gp1 = 0x02000000
while (*gp1 & 0x01000000) ~= 0 do
end
result.phases[2].flags = *irq_flags
result.phases[2].mask = *irq_mask
result.phases[2].gpu_local = *gp1 & 0x01000000
result.phases[2].services = result.gpu_services
result.phases[2].ack = *irq_ack
result.completed_phase = 2
*irq_ack = 0
result.ack_zero_flags = *irq_flags

-- A second independent request coalesces into the already-pending bit.
*gp0 = 0x1f000000
while (*gp1 & 0x01000000) == 0 do
end
result.phases[3].flags = *irq_flags
result.phases[3].mask = *irq_mask
result.phases[3].gpu_local = *gp1 & 0x01000000
result.phases[3].services = result.gpu_services
result.phases[3].ack = *irq_ack
result.completed_phase = 3

*irq_mask = 0x00000040
while result.gpu_services == 0 do
	halt_until_irq
end
result.phases[5].flags = *irq_flags
result.phases[5].mask = *irq_mask
result.phases[5].gpu_local = *gp1 & 0x01000000
result.phases[5].services = result.gpu_services
result.phases[5].ack = *irq_ack
result.completed_phase = 5

-- Both GPU latches were acknowledged; a fresh marker can request service.
*gp0 = 0x1f000000
while result.gpu_services == 1 do
	halt_until_irq
end
result.phases[6].flags = *irq_flags
result.phases[6].mask = *irq_mask
result.phases[6].gpu_local = *gp1 & 0x01000000
result.phases[6].services = result.gpu_services
result.phases[6].ack = *irq_ack
result.completed_phase = 6

*irq_mask = 0
result.phases[7].flags = *irq_flags
result.phases[7].mask = *irq_mask
result.phases[7].gpu_local = *gp1 & 0x01000000
result.phases[7].services = result.gpu_services
result.phases[7].ack = *irq_ack
result.completed_phase = 7
while true do
	halt_until_irq
end
