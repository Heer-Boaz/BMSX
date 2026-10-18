local state<const> = require('results')
local result<const>: *apu_download_result = state.result
local apu_fault<const>: *word = 0x08010218
local bus_fault<const>: *word = 0x08010208

return {
	kind = 'integration',
	tests = {
		requested_words_before_surplus_prefetch = function(t)
			t:wait_until('both bounded downloads stopped', function()
				return result.completed_phase == 2
			end, 2)
			for index = 0, 19 do
				assert(result.received[index] == (0x5a000000 | index))
			end
			for index = 0, 3 do
				assert(result.received[20 + index] == (0x5a000000 | (16 + index)))
			end
			for phase = 0, 1 do
				assert(result.dma_status[phase] == 0x00000002)
				assert(result.remaining[phase] == 0)
				assert(result.pending[phase] == 0x00000001)
				assert(result.apu_after_dma[phase] == 0x00000420)
				assert(result.apu_after_stop[phase] == 0x00000020)
				assert(result.mode_after_stop[phase] == 0)
			end
			assert(*apu_fault == 0)
			assert(*bus_fault == 0)
			t:log('20-word and 4-word payloads, count/DONE/masked pending, surplus busy and STOP pass; ideal cycle tables checked separately')
		end,
	},
}
