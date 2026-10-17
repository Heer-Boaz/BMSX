local state<const> = require('results')
local result<const>: *system_manual_result = state.result

return {
	kind = 'integration',
	tests = {
		time_words_privilege_and_transmit = function(t)
			t:wait_until('four SYSTEM observations', function()
				return result.completed_samples == 4 and result.char_readback == 0xffffffff
			end, 40)
			assert(sizeof(system_manual_result) == 172)
			assert(result.ignored_control == 0)
			assert(result.ignored_status == 0)
			for index = 0, 5 do
				assert(result.faults[index] == 0)
			end
			assert(result.clock_seconds >= result.clock_before_ms / 1000)
			assert(result.clock_seconds <= result.clock_after_ms / 1000)
			assert(result.time_seconds >= result.time_before_ms // 1000)
			assert(result.time_seconds <= result.time_after_ms // 1000)
			for index = 0, 3 do
				local sample<const>: *system_manual_sample = &result.samples[index]
				assert(sample.elapsed_ms == ((sample.after_ms - sample.before_ms) & 0xffffffff))
				assert(sample.elapsed_ms >= 100)
				assert(sample.frame_ms_q16 ~= 0)
				assert(sample.cycles_per_frame ~= 0)
				assert(sample.status == 0)
			end
			assert(result.vblanks >= 4)
			assert(result.char_readback == 0xffffffff)
			assert(result.flush_readback == 0)
			t:log('four >=100ms observations; user commands ignored; six fault words zero; BIOS time reads bracketed; raw CHAR/FLUSH readbacks correct')
		end,
	},
}
