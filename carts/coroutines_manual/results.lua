module<const>

struct coroutines_manual_result
	completed: word
	protected_values: f64[3]
	protected_flags: word[8]
	thread_values: f64[3]
	thread_flags: word[14]
	failed_flags: word[4]
	close_value: f64
	close_flags: word[3]
	wrap_values: f64[2]
	wrap_flags: word[2]
end

bss result: coroutines_manual_result

return { result = result }
