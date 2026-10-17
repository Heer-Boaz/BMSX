local state<const> = require('results')
local result<const>: *cpu_manual_result = state.result

return {
	kind = 'integration',
	tests = {
		numbers_words_calls_and_memory = function(t)
			t:wait_until('CPU observations complete', function()
				return result.completed == 1
			end, 8)
			assert(result.operands[0] == -7)
			assert(result.operands[1] == 3)
			assert(result.operands[2] == -1.75)
			assert(result.operands[3] == 2147483647)
			assert(result.operands[4] == 2147483648)
			assert(result.quotient == -7 / 3)
			assert(result.floor_quotient == -3)
			assert(result.mod_positive == 2)
			assert(result.mod_negative == -2)
			assert(result.number_sum == 2147483648)
			assert(result.word_sum == 0x80000000)
			assert(result.signed_word == -2147483648)
			assert(result.shift_right == -1073741824)
			assert(result.shift_32 == 1)
			assert(result.shift_negative == -2147483648)
			assert(result.truncated_word == -1)
			assert(result.zero_is_true == 1)
			assert(result.comparison == 1)
			assert(result.read_u16[0] == 0x5678)
			assert(result.read_u16[1] == 0x1234)
			assert(result.read_u32 == 0x12345678)
			assert(result.rounded == 2147483648)
			assert(result.rounded_readback == 2147483648)
			assert(result.call_sum == -4)
			assert(result.counter[0] == 12)
			assert(result.counter[1] == 15)
		end,
	},
}
