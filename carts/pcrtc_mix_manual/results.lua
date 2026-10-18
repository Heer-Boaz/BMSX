module<const>

struct pcrtc_mix_result
	completed_phase: word
	vblank_sequence: word
	system_origin: word
	system_size: word
	source_words: word[3]
	before_vblank: word[4]
	after_vblank: word[4]
	programmed_pmode: word[4]
end

bss result: pcrtc_mix_result

return { result = result }
