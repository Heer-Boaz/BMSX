module<const>

struct bios_format_manual_result
	completed: word
	basic_match: word
	sign_match: word
	prefix_match: word
	stars_match: word
	left_match: word
	zero_integer_match: word
	float_match: word
	quote_match: word
	unsigned_match: word
	special_match: word
	fixed_large_match: word
	empty_integer_length: word
	nul_length: word
	nul_codepoint: word
	nul_trailing_codepoint: word
	nonnumeric_width_match: word
	incomplete_error: word
	unsupported_error: word
end

bss result: bios_format_manual_result

return { result = result }
