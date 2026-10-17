local state<const> = require('results')
local result<const>: *irq_manual_result = state.result
local irq_flags<const>: *word = 0x08000000
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local gp1<const>: *word = 0x08010240

rodata expected_phases: irq_manual_phase[8] = {
	{ flags = 0x04, mask = 0x00, gpu_local = 0x00000000, services = 0, ack = 0 },
	{ flags = 0x44, mask = 0x00, gpu_local = 0x01000000, services = 0, ack = 0 },
	{ flags = 0x44, mask = 0x00, gpu_local = 0x00000000, services = 0, ack = 0 },
	{ flags = 0x44, mask = 0x00, gpu_local = 0x01000000, services = 0, ack = 0 },
	{ flags = 0x44, mask = 0x40, gpu_local = 0x01000000, services = 0, ack = 0 },
	{ flags = 0x04, mask = 0x40, gpu_local = 0x00000000, services = 1, ack = 0 },
	{ flags = 0x04, mask = 0x40, gpu_local = 0x00000000, services = 2, ack = 0 },
	{ flags = 0x04, mask = 0x00, gpu_local = 0x00000000, services = 2, ack = 0 },
}

return {
	kind = 'integration',
	tests = {
		masked_pending_coalescing_and_source_ack = function(t)
			t:wait_until('IRQ experiment completed', function()
				return result.completed_phase == 7
			end, 8)
			assert(result.gpu_services == 2)
			assert(result.handler_flags[0] == 0x00000044)
			assert(result.handler_flags[1] == 0x00000044)
			assert(result.ack_zero_flags == 0x00000044)
			for phase = 0, #expected_phases - 1 do
				assert(result.phases[phase].flags == expected_phases[phase].flags)
				assert(result.phases[phase].mask == expected_phases[phase].mask)
				assert(result.phases[phase].gpu_local == expected_phases[phase].gpu_local)
				assert(result.phases[phase].services == expected_phases[phase].services)
				assert(result.phases[phase].ack == expected_phases[phase].ack)
			end
			assert(*irq_flags == 0x00000004)
			assert(*irq_mask == 0)
			assert(*irq_ack == 0)
			assert((*gp1 & 0x01000000) == 0)
			t:log('IRQ phases 0..7 match; full handler flags 44/44; services 2; pending 04; MASK 0; GPU-local clear; ACK zero')
		end,
	},
}
