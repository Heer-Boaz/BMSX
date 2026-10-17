module<const>

struct irq_manual_phase
	flags: word
	mask: word
	gpu_local: word
	services: word
	ack: word
end

struct irq_manual_result
	completed_phase: word
	gpu_services: word
	handler_flags: word[2]
	ack_zero_flags: word
	phases: irq_manual_phase[8]
end

bss result: irq_manual_result

return { result = result }
