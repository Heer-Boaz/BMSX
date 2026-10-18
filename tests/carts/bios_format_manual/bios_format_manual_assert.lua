local state<const> = require('results')
local result<const>: *bios_format_manual_result = state.result

return {
	kind = 'integration',
	tests = {
		formatted_text = function(t)
			t:wait_until('format observations complete', function()
				return result.completed == 1
			end, 8)
			assert(result.basic_match == 1)
			assert(result.sign_match == 1)
			assert(result.prefix_match == 1)
			assert(result.stars_match == 1)
			assert(result.left_match == 1)
			assert(result.zero_integer_match == 1)
			assert(result.float_match == 1)
			assert(result.quote_match == 1)
			assert(result.unsigned_match == 1)
			assert(result.special_match == 1)
			assert(result.fixed_large_match == 1)
			assert(result.empty_integer_length == 0)
			assert(result.nul_length == 2)
			assert(result.nul_codepoint == 0)
			assert(result.nul_trailing_codepoint == 0)
			assert(result.nonnumeric_width_match == 1)
			assert(result.incomplete_error == 1)
			assert(result.unsupported_error == 1)
		end,
	},
}
