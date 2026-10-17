module<const>

struct bios_table_manual_result
	completed: word
	packed_count: word
	tuple_first: f64
	tuple_third: f64
	tuple_holes: word
	tuple_count: word
	packed_text_match: word
	insert_count: word
	removed: f64
	sequence_length: word
	sort_count: word
	ascending: f64[4]
	default_unpack_count: word
	negative_text_match: word
	zero_text_match: word
	empty_concat_length: word
	empty_unpack_count: word
	descending: f64[4]
	last_removed: f64
	remaining_length: word
	comparison_count: word
	failure_identity: word
	partial: f64[3]
end

bss result: bios_table_manual_result

return { result = result }
