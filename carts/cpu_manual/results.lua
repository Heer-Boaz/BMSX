module<const>

struct cpu_manual_result
	completed: word
	operands: f64[5]
	quotient: f64
	floor_quotient: f64
	mod_positive: f64
	mod_negative: f64
	number_sum: f64
	word_sum: word
	signed_word: f64
	shift_right: f64
	shift_32: f64
	shift_negative: f64
	truncated_word: f64
	zero_is_true: word
	comparison: word
	read_u16: word[2]
	read_u32: word
	rounded: f32
	rounded_readback: f64
	call_sum: f64
	counter: f64[2]
end

bss result: cpu_manual_result

return { result = result }
