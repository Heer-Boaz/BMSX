struct bios_os_manual_result
	completed: word
	clock_sample: f64
	time_sample: f64
	nil_time_sample: f64
	noon_timestamp: f64
	carried_timestamp: f64
	elapsed: f64
	negative_difference: f64
	large_difference: f64
	infinite_difference: f64
	indeterminate_difference: f64
end

bss result: bios_os_manual_result

-- Tables and dynamic strings remain guest values, not byte-memory encodings.
return { result = result, observations = {} }
