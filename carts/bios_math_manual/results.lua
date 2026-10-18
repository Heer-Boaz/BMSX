module<const>

struct bios_math_manual_result
	completed: word
	absolute: f64
	rounding: f64[6]
	fmod_value: f64
	modulo_value: f64
	integer_part: f64
	fraction_part: f64
	minimum: f64
	maximum: f64
	text_minimum: word
	abs_identity: word
	abs_text: word
	abs_missing: word
	arithmetic_nan: f64
	large_integer: f64
	fraction_rejected: word
	text_rejected: word
	classifications: word
	unsigned_wrap: word
	unsigned_fraction: word
	unsigned_equal: word
	signs: f64[3]
	abs_negative_zero: word
	floor_negative_zero: word
	ceil_negative_zero: word
	round_positive_zero: word
	modf_integer_negative_zero: word
	modf_fraction_positive_zero: word
	fmod_positive_zero: word
	min_error: word
	max_error: word
	trig: f64[6]
	angles: f64[6]
	square_root: f64
	root_negative_zero: word
	root_nan: f64
	exponentials: f64[3]
	exp_edges: f64[2]
	logarithms: f64[4]
	log_nan: f64
	trig_nonnumeric: f64[3]
	atan_false: f64
	random_seed_count: word
	random_seed_nil: word
	random_unit: f64
	random_single: f64
	random_interval: f64
	random_truncated: f64
	random_repeated: f64
	random_error: word
	random_after_error: f64
	random_two_error: word
	random_two_after_error: f64
	random_false_seed: f64
	random_false_value: f64
	random_nil_upper: f64
	integer_bounds: f64[2]
	pi: f64
	huge: f64
end

bss result: bios_math_manual_result

return { result = result }
