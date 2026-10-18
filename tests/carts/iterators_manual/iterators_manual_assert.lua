local storage<const> = require('results')
local result<const>: *iterators_manual_result = storage.result

return {
	kind = 'integration',
	tests = {
		generic_iteration_control = function(t)
			t:wait_until('iterator observations complete', function()
				return result.completed == 1
			end, 8)
			assert(result.iterator_calls == 3)
			assert(result.body_count == 2)
			assert(result.payload_sum == 30)
			assert(result.false_key_count == 1)
			assert(result.missing_third_count == 2)
			assert(result.first_control == 0)
			assert(result.second_control_false == 1)
			assert(result.third_control == 2)
			assert(result.visible_after_write == 198)
			assert(result.stop_payload == 999)
		end,
	},
}
