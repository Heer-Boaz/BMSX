module<const>

struct bios_pack_manual_result
	completed: word
	header_size: word
	record_length: word
	record_codepoints_match: word
	version_match: word
	flags_match: word
	delta_match: word
	sample_match: word
	calibration_match: word
	tag_match: word
	header_next: word
	header_padding_match: word
	flags_first_codepoint: word
	flags_second_codepoint: word
	delta_first_codepoint: word
	delta_second_codepoint: word
	payload_length: word
	payload_zero_codepoint: word
	payload_match: word
	status_match: word
	record_next: word
	fixed_length: word
	fixed_padding_codepoint: word
	fixed_match: word
	fixed_next: word
	wide_length: word
	wide_copied_codepoint: word
	wide_unsigned: word
	wide_signed: word
	wide_unsigned_next: word
	wide_signed_next: word
	integer_range_error: word
	zero_text_error: word
	variable_size_error: word
end

bss result: bios_pack_manual_result

return { result = result }
