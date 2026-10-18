local state<const> = require('results')
local result<const>: *cpu_irq_manual_result = state.result
local irq_mask<const>: *word = 0x08000008

return {
	kind = 'integration',
	tests = {
		cp0_in_irq_callback_and_normal_return = function(t)
			t:wait_until('IRQ callback returned to cartridge main', function()
				return result.resumed == 1
			end, 8)
			assert(sizeof(cpu_irq_manual_result) == 28)
			assert(result.status == 0x0000000c)
			assert(result.cause == 0x00000400)
			assert((result.epc & 3) == 0)
			assert(result.epc ~= 0)
			assert(result.system_status == 0)
			assert((result.flags & 0x00000004) ~= 0)
			assert(result.services == 1)
			assert(*irq_mask == 0)
			t:log('cartridge IRQ read CP0 in non-user mode; SYSTEM context stayed inactive; generated RFE resumed main')
		end,
	},
}
