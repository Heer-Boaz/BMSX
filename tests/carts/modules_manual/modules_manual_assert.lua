local state<const> = require('results')
local result<const>: *modules_manual_result = state.result

return {
	kind = 'integration',
	tests = {
		modules_and_globals = function(t)
			t:wait_until('module observations complete', function()
				return result.completed == 1
			end, 8)
			assert(result.counter_loads == 1)
			assert(result.false_loads == 1)
			assert(result.nil_loads == 1)
			assert(result.nil_seen_from_false == 1)
			assert(result.entry_counter_loads == 1)
			assert(result.entry_false_loads == 1)
			assert(result.entry_nil_loads == 1)
			assert(result.same_module == 1)
			assert(result.first_value == 16)
			assert(result.second_value == 32)
			assert(result.false_exports == 1)
			assert(result.nil_exports == 1)
			assert(result.initial_global_nil == 1)
			assert(result.first_step == 2)
			assert(result.local_shadow == 99)
			assert(result.shadow_value == 36)
			assert(result.final_value == 46)
			assert(result.global_after_shadow == 4)
			assert(result.changed_global == 5)
		end,
	},
}
