module<const>

struct iterators_manual_result
	completed: word
	iterator_calls: word
	body_count: word
	payload_sum: word
	false_key_count: word
	missing_third_count: word
	first_control: word
	second_control_false: word
	third_control: word
	visible_after_write: word
	stop_payload: word
end

bss result: iterators_manual_result

return { result = result }
