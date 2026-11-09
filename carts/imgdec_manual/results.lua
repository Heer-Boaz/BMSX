module<const>

-- The two DMA channels expose the same six-word register run.
struct imgdec_manual_dma_registers
	read_address: word
	write_address: word
	count: word
	control: word
	status: word
	trigger: word
end

struct imgdec_manual_registers
	input_word_count: word
	output_word_count: word
	unassigned0: word
	unassigned1: word
	control: word
	status: word
	data: word
	input_words_received: word
	decoded_word_count: word
end

-- Per-phase observations exclude DATA: reading DATA consumes output.
struct imgdec_manual_phase_result
	status: word
	received: word
	decoded: word
	dma_count: word[2]
	dma_status: word[2]
	armed_status: word[2]
	sequences: word[3]
end

struct imgdec_manual_result
	completed_phase: word
	dma0_sequence: word
	dma1_sequence: word
	decoder_sequence: word
	ram_output: word[20]
	recovery_output: word[3]
	phases: imgdec_manual_phase_result[4]
	gpu_initial_status: word
	gpu_idle_status: word
	fault_reads: word[3]
	fault_retained_read: word
	final_irq_flags: word
end

bss result: imgdec_manual_result

return { result = result }
