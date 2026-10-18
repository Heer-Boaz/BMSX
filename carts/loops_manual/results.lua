module<const>

struct loops_manual_result
	completed: word
	header_calls: word
	header_count: word
	header_sum: word
	cached_count: word
	cached_sum: word
	changed_limit: word
	changed_step: word
	forward_count: word
	forward_sum: word
	reverse_count: word
	reverse_sum: word
	zero_empty_count: word
	zero_fixed_count: word
	zero_fixed_sum: word
	zero_equal_count: word
	zero_equal_sum: word
end

bss result: loops_manual_result

return { result = result }
