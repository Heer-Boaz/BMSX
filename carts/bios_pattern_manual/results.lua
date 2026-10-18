module<const>

struct bios_pattern_manual_result
	completed: word
	plain_start: word
	plain_end: word
	pattern_start: word
	pattern_end: word
	capture_match: word
	coordinate_match: word
	position_capture: word
	position_text_match: word
	negative_start: word
	empty_find_nil: word
	empty_match_length: word
	word_count: word
	word_heads: word[3]
	anchored_count: word
	greedy_match: word
	minimal_match: word
	balanced_match: word
	frontier_match: word
	backreference_match: word
	complement_match: word
	string_replacement_match: word
	string_replacement_count: word
	table_replacement_match: word
	table_replacement_count: word
	callback_replacement_match: word
	callback_replacement_count: word
	callback_calls: word
	empty_substitution_match: word
	empty_substitution_count: word
	zero_limit_match: word
	zero_limit_count: word
	deferred_replacement_match: word
	deferred_replacement_count: word
	invalid_pattern_error: word
	invalid_capture_error: word
	invalid_replacement_error: word
	unicode_start: word
	unicode_end: word
end

bss result: bios_pattern_manual_result

return { result = result }
