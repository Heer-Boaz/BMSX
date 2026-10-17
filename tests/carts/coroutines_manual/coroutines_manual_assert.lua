local state<const> = require('results')
local result<const>: *coroutines_manual_result = state.result

return {
	kind = 'integration',
	tests = {
		protected_calls_and_thread_lifecycle = function(t)
			t:wait_until('coroutine observations complete', function()
				return result.completed == 1
			end, 8)
			assert(result.protected_values[0] == 10)
			assert(result.protected_values[1] == 4)
			assert(result.protected_values[2] == 77)
			for index = 0, 7 do
				assert(result.protected_flags[index] == 1)
			end
			assert(result.thread_values[0] == 13)
			assert(result.thread_values[1] == 40)
			assert(result.thread_values[2] == 3)
			for index = 0, 13 do
				assert(result.thread_flags[index] == 1)
			end
			for index = 0, 3 do
				assert(result.failed_flags[index] == 1)
			end
			assert(result.close_value == 19)
			for index = 0, 2 do
				assert(result.close_flags[index] == 1)
			end
			assert(result.wrap_values[0] == 12)
			assert(result.wrap_values[1] == 34)
			for index = 0, 1 do
				assert(result.wrap_flags[index] == 1)
			end
		end,
	},
}
