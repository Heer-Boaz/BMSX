module<const>

struct dma_manual_channel
	read_address: word
	write_address: word
	count: word
	control: word
	status: word
	trigger: word
end

struct dma_manual_result
	completed_phase: word
	dma0_sequence: word
	dma1_sequence: word
	seed_address: word
	gpu_stream_address: word
	source: word[20]
	copies: word[2][20]
	rom_copy: dma_manual_channel
	parallel: dma_manual_channel[2]
	parallel_status: word[2]
	gpu_copy: dma_manual_channel
	gpu_at_dma_done: word
	gpu_at_marker: word
	irq_at_marker: word
	gpu_at_idle: word
	final_irq_flags: word
end

bss result: dma_manual_result

return { result = result }
