module<const>

struct apu_download_result
	completed_phase: word
	received: word[24]
	dma_status: word[2]
	remaining: word[2]
	pending: word[2]
	apu_after_dma: word[2]
	apu_after_stop: word[2]
	mode_after_stop: word[2]
end

bss result: apu_download_result

return { result = result }
