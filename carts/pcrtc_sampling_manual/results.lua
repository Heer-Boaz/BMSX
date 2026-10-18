module<const>

struct pcrtc_sampling_result
	completed: word
	vblank_sequence: word
	before_vblank: word
	after_vblank: word
	programmed_source: word
	programmed_window: word
	programmed_extent: word
	source_words: word[8]
end

bss result: pcrtc_sampling_result

return { result = result }
