local state<const> = require('results')
local result<const>: *bios_pack_manual_result = state.result

return {
	kind = 'integration',
	tests = {
		binary_records = function(t)
			t:wait_until('pack observations complete', function()
				return result.completed == 1
			end, 8)
			assert(result.header_size == 23)
			assert(result.record_length == 33)
			assert(result.record_codepoints_match == 1)
			assert(result.version_match == 1)
			assert(result.flags_match == 1)
			assert(result.delta_match == 1)
			assert(result.sample_match == 1)
			assert(result.calibration_match == 1)
			assert(result.tag_match == 1)
			assert(result.header_next == 24)
			assert(result.header_padding_match == 1)
			assert(result.flags_first_codepoint == 52)
			assert(result.flags_second_codepoint == 18)
			assert(result.delta_first_codepoint == 254)
			assert(result.delta_second_codepoint == 212)
			assert(result.payload_length == 3)
			assert(result.payload_zero_codepoint == 0)
			assert(result.payload_match == 1)
			assert(result.status_match == 1)
			assert(result.record_next == 34)
			assert(result.fixed_length == 4)
			assert(result.fixed_padding_codepoint == 0)
			assert(result.fixed_match == 1)
			assert(result.fixed_next == 5)
			assert(result.wide_length == 1)
			assert(result.wide_copied_codepoint == 256)
			assert(result.wide_unsigned == 256)
			assert(result.wide_signed == 0)
			assert(result.wide_unsigned_next == 2)
			assert(result.wide_signed_next == 2)
			assert(result.integer_range_error == 1)
			assert(result.zero_text_error == 1)
			assert(result.variable_size_error == 1)
		end,
	},
}
