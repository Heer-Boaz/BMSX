local state<const> = require('results')
local result<const>: *language_manual_result = state.result

return {
	kind = 'integration',
	tests = {
		calls_values_and_utf8_storage = function(t)
			t:wait_until('language observations complete', function()
				return result.completed == 1
			end, 8)
			assert(sizeof(language_manual_result) == 140)
			assert(result.written[0] == 17)
			assert(result.written[1] == 25)
			assert(result.sum == 42)
			assert(result.written_count == 2)
			assert(result.argument_next[0] == 5)
			assert(result.argument_next[1] == 5)
			assert(result.missing_is_nil == 1)
			assert(result.second_with_extra == 2)
			assert(result.head == 7)
			assert(result.extra_count == 2)
			assert(result.extra[0] == 8)
			assert(result.extra[1] == 9)
			assert(result.bare_return_count == 1)
			assert(result.bare_return_is_nil == 1)
			assert(result.parenthesized[0] == 11)
			assert(result.parenthesized[1] == 22)
			assert(result.table_alias_value == 33)
			assert(result.table_zero_is_nil == 1)
			assert(result.counter_values[0] == 12)
			assert(result.counter_values[1] == 15)
			assert(result.utf8_byte_count == 8)
			assert(result.text_length == 4)
			assert(result.codepoints[0] == 0x41)
			assert(result.codepoints[1] == 0xe9)
			assert(result.codepoints[2] == 0)
			assert(result.codepoints[3] == 0x1f642)
			assert(result.constructed_matches == 1)
			assert(result.escape_length == 2)
			assert(result.escape_codepoints[0] == 0xc3)
			assert(result.escape_codepoints[1] == 0xa9)
			assert(result.past_end_is_nil == 1)
			assert(result.zero_index_is_nil == 1)
			assert(result.system_origin == 0x02d002c0)
			assert(result.system_size == 0x00fc0140)
		end,
	},
}
