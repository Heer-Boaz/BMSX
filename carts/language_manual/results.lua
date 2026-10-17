module<const>

struct language_manual_result
	completed: word
	written: word[2]
	sum: word
	written_count: word
	argument_next: word[2]
	missing_is_nil: word
	second_with_extra: word
	head: word
	extra_count: word
	extra: word[2]
	bare_return_count: word
	bare_return_is_nil: word
	parenthesized: word[2]
	table_alias_value: word
	table_zero_is_nil: word
	counter_values: word[2]
	utf8_byte_count: word
	text_length: word
	codepoints: word[4]
	constructed_matches: word
	escape_length: word
	escape_codepoints: word[2]
	past_end_is_nil: word
	zero_index_is_nil: word
	system_origin: word
	system_size: word
end

bss result: language_manual_result

return { result = result }
