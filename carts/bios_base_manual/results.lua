module<const>

struct bios_base_manual_result
	completed: word
	assert_first: f64
	assert_last: f64
	assert_count: word
	assert_hole: word
	assert_nil_error: word
	assert_default_error: word
	conversions: f64[6]
	conversion_rejected: word
	conversion_bad_base: word
	type_names_match: word
	object_labels_match: word
	identity_same: word
	identity_distinct: word
	next_key: f64
	next_value: f64
	next_done_count: word
	next_done_nil: word
	pairs_count: word
	pairs_sum: f64
	ipairs_count: word
	ipairs_sum: f64
	ipairs_after_hole: f64
	select_count: word
	select_suffix_count: word
	select_first_nil: word
	select_last: f64
	select_empty_count: word
	global_values: f64[2]
	global_error: word
	global_cleared: word
	print_count: word
end

bss result: bios_base_manual_result

return { result = result }
