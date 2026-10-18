struct bios_loader_manual_result
	completed: word
	environment_before: f64
	environment_first: f64
	environment_second: f64
	external_first: f64
	external_second: f64
	global_first: f64
	global_second: f64
	capture_first: f64
	capture_second: f64
	mode_value: f64
	bare_count: word
	fallthrough_count: word
	expanded_count: word
	single_count: word
	factory_value: f64
	symbol_value: f64
end

bss result: bios_loader_manual_result

return { result = result, observations = {} }
