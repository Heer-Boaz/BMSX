struct bios_os_manual_result
	completed: word
	clock_sample: f32
	time_sample: word
	nil_time_sample: word
	noon_timestamp: word
	carried_timestamp: word
	elapsed: word
	negative_difference: word
	large_difference: f32
	infinite_difference: f32
	indeterminate_difference: f32
end

bss result: bios_os_manual_result

-- Tables and dynamic strings remain guest values, not byte-memory encodings.
return { result = result, observations = {} }
