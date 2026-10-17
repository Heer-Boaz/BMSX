local state<const> = require('results')
local result<const>: *bios_table_manual_result = state.result

return {
	kind = 'integration',
	tests = {
		table_library_observations = function(t)
			t:wait_until('table library observations complete', function()
				return result.completed == 1
			end, 8)
			assert(result.packed_count == 4)
			assert(result.tuple_first == 10)
			assert(result.tuple_third == 30)
			assert(result.tuple_holes == 1)
			assert(result.tuple_count == 4)
			assert(result.packed_text_match == 1)
			assert(result.insert_count == 1)
			assert(result.removed == 3)
			assert(result.sequence_length == 4)
			assert(result.sort_count == 1)
			assert(result.ascending[0] == 5.5)
			assert(result.ascending[1] == 7)
			assert(result.ascending[2] == 8)
			assert(result.ascending[3] == 9)
			assert(result.default_unpack_count == 4)
			assert(result.negative_text_match == 1)
			assert(result.zero_text_match == 1)
			assert(result.empty_concat_length == 0)
			assert(result.empty_unpack_count == 0)
			assert(result.descending[0] == 9)
			assert(result.descending[1] == 8)
			assert(result.descending[2] == 7)
			assert(result.descending[3] == 5.5)
			assert(result.last_removed == 5.5)
			assert(result.remaining_length == 3)
			assert(result.comparison_count == 5)
			assert(result.failure_identity == 1)
			assert(result.partial[0] == 1)
			assert(result.partial[1] == 3)
			assert(result.partial[2] == 2)
		end,
	},
}
