module<const>

struct cpu_values_manual_result
	completed: word
	zero: f64
	powers: f64[12]
	reciprocals: f64[4]
	format_match: word[18]
	table_lengths: word[8]
	table_values: word[9]
	table_checks: word[7]
	metatable_checks: word[10]
end

bss result: cpu_values_manual_result

return { result = result }
