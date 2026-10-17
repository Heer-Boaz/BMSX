local state<const> = require('results')
local result<const>: *cpu_values_manual_result = state.result

return {
	kind = 'integration',
	tests = {
		power_text_and_table_contracts = function(t)
			t:wait_until('value observations complete', function()
				return result.completed == 1
			end, 8)
			local zero<const> = result.zero
			local infinity<const> = 1 / zero
			assert(result.powers[0] == 0)
			assert(result.powers[1] == 0)
			assert(result.powers[2] == -infinity)
			assert(result.powers[3] == infinity)
			assert(result.powers[4] == 0)
			assert(result.powers[5] ~= result.powers[5])
			assert(result.powers[6] == 1)
			assert(result.powers[7] ~= result.powers[7])
			assert(result.powers[8] == -1)
			assert(result.powers[9] == 1)
			assert(result.powers[10] == 5e-324)
			assert(result.powers[11] == 0)
			assert(result.reciprocals[0] == -infinity)
			assert(result.reciprocals[1] == infinity)
			assert(result.reciprocals[2] == -infinity)
			assert(result.reciprocals[3] == -infinity)
			for index = 0, 17 do
				assert(result.format_match[index] == 1)
			end
			local lengths<const> = { 3, 1, 1, 4, 0, 4, 4, 4 }
			for index = 0, 7 do
				assert(result.table_lengths[index] == lengths[index + 1])
			end
			local values<const> = { 91, 12, 15, 16, 17, 18, 22, 23, 24 }
			for index = 0, 8 do
				assert(result.table_values[index] == values[index + 1])
			end
			for index = 0, 6 do
				assert(result.table_checks[index] == 1)
			end
			for index = 0, 9 do
				assert(result.metatable_checks[index] == 1)
			end
		end,
	},
}
