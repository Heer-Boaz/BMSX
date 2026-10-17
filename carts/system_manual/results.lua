module<const>

struct system_manual_sample
	before_ms: word
	after_ms: word
	elapsed_ms: word
	frame_ms_q16: word
	cycles_per_frame: word
	status: word
end

struct system_manual_result
	completed_samples: word
	vblanks: word
	ignored_control: word
	ignored_status: word
	faults: word[6]
	clock_before_ms: word
	clock_after_ms: word
	clock_seconds: f64
	time_before_ms: word
	time_after_ms: word
	time_seconds: word
	char_readback: word
	flush_readback: word
	samples: system_manual_sample[4]
end

bss result: system_manual_result

return { result = result }
