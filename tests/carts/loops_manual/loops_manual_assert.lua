local state<const> = require('results')
local result<const>: *loops_manual_result = state.result

return {
	kind = 'integration',
	tests = {
		numeric_loop_control = function(t)
			t:wait_until('numeric loop observations complete', function()
				return result.completed == 1
			end, 8)
			assert(result.header_calls == 3)
			assert(result.header_count == 4)
			assert(result.header_sum == 10)
			assert(result.cached_count == 4)
			assert(result.cached_sum == 10)
			assert(result.changed_limit == 0)
			assert(result.changed_step == 7)
			assert(result.forward_count == 3)
			assert(result.forward_sum == 9)
			assert(result.reverse_count == 3)
			assert(result.reverse_sum == 9)
			assert(result.zero_empty_count == 0)
			assert(result.zero_fixed_count == 3)
			assert(result.zero_fixed_sum == 9)
			assert(result.zero_equal_count == 2)
			assert(result.zero_equal_sum == 4)
		end,
	},
}
