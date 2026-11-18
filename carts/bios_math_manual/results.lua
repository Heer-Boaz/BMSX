module<const>

struct bios_math_manual_result
	completed: word
	absolute: f32
	rounding: f32[6]
	fmod_value: f32
	modulo_value: f32
	integer_part: word
	fraction_part: f32
	minimum: word
	maximum: word
	text_minimum: word
	abs_table_error: word
	abs_text_error: word
	abs_missing_error: word
	arithmetic_error: word
	wrapped_integer: word
	fraction_rejected: word
	text_rejected: word
	classifications: word
	unsigned_wrap: word
	unsigned_fraction_error: word
	unsigned_out_of_range_error: word
	signs: word[3]
	abs_positive_zero: word
	floordiv_negative_zero: word
	ceil_integer_zero: word
	round_positive_zero: word
	modf_integer_zero: word
	modf_fraction_positive_zero: word
	fmod_negative_zero: word
	min_error: word
	max_error: word
	trig: f32[6]
	angles: f32[6]
	square_root: f32
	root_negative_zero: word
	root_nan: f32
	exponentials: f32[3]
	exp_edges: f32[2]
	logarithms: f32[4]
	log_nan: f32
	trig_errors: word[3]
	atan_false_error: word
	random_seed_count: word
	random_seed_nil: word
	random_unit: f32
	random_single: word
	random_interval: word
	random_fraction_error: word
	random_repeated: f32
	random_error: word
	random_after_error: f32
	random_two_error: word
	random_two_after_error: f32
	random_seed_error: word
	random_false_error: word
	random_nil_upper: f32
	random_full: word
	random_high: word
	integer_bounds: word[2]
	pi: f32
	huge: f32
end

bss result: bios_math_manual_result

return { result = result }
