module<const>

struct bios_string_manual_result
	completed: word
	byte_count: word
	text_length: word
	codepoints: word[4]
	upper_match: word
	lower_match: word
	slice_tail_match: word
	slice_fraction_match: word
	slice_zero_length: word
	slice_clamped_match: word
	reverse_match: word
	repeat_match: word
	repeat_zero_length: word
	repeat_default_match: word
	byte_missing_nil: word
	byte_result_count: word
	byte_fraction: word
	byte_wrapped: word
	char_wrapped_match: word
	char_empty_length: word
	invalid_char_error: word
	invalid_position_error: word
	decoded_match: word
	nul_length: word
	nul_codepoint: word
	short_span_codepoint: word
	chunk_length: word
	chunk_edges: word[3]
end

bss result: bios_string_manual_result
bss chunk_bytes: u8[257]

return { result = result, chunk_bytes = chunk_bytes }
