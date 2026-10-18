module<const>

struct cpu_irq_manual_result
	status: word
	cause: word
	epc: word
	system_status: word
	flags: word
	services: word
	resumed: word
end

bss result: cpu_irq_manual_result

return { result = result }
