module<const>

struct modules_manual_result
	completed: word
	counter_loads: word
	false_loads: word
	nil_loads: word
	nil_seen_from_false: word
	entry_counter_loads: word
	entry_false_loads: word
	entry_nil_loads: word
	same_module: word
	first_value: word
	second_value: word
	false_exports: word
	nil_exports: word
	initial_global_nil: word
	first_step: word
	local_shadow: word
	shadow_value: word
	global_after_shadow: word
	changed_global: word
	final_value: word
end

bss result: modules_manual_result

return { result = result }
