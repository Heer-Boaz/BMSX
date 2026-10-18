local state<const> = require('results')
local result<const>: *bios_string_manual_result = state.result

return {
	kind = 'integration',
	tests = {
		string_operations = function(t)
			t:wait_until('String observations complete', function()
				return result.completed == 1
			end, 8)
			assert(result.byte_count == 8)
			assert(result.text_length == 4)
			assert(result.codepoints[0] == 0x41)
			assert(result.codepoints[1] == 0x7a)
			assert(result.codepoints[2] == 0xe9)
			assert(result.codepoints[3] == 0x1f680)
			assert(result.upper_match == 1)
			assert(result.lower_match == 1)
			assert(result.slice_tail_match == 1)
			assert(result.slice_fraction_match == 1)
			assert(result.slice_zero_length == 0)
			assert(result.slice_clamped_match == 1)
			assert(result.reverse_match == 1)
			assert(result.repeat_match == 1)
			assert(result.repeat_zero_length == 0)
			assert(result.repeat_default_match == 1)
			assert(result.byte_missing_nil == 1)
			assert(result.byte_result_count == 1)
			assert(result.byte_fraction == 0x7a)
			assert(result.byte_wrapped == 0x41)
			assert(result.char_wrapped_match == 1)
			assert(result.char_empty_length == 0)
			assert(result.invalid_char_error == 1)
			assert(result.invalid_position_error == 1)
			assert(result.decoded_match == 1)
			assert(result.nul_length == 3)
			assert(result.nul_codepoint == 0)
			assert(result.short_span_codepoint == 0xe9)
			assert(result.chunk_length == 257)
			assert(result.chunk_edges[0] == 0x41)
			assert(result.chunk_edges[1] == 0x41)
			assert(result.chunk_edges[2] == 0x41)
		end,
	},
}
