module<const>

struct pcrtc_window_result
	completed_phase: word
	vblank_sequence: word
	system_origin: word
	system_size: word
	samples: word[3]
	before_vblank: word[3]
	after_vblank: word[3]
	programmed_source: word[3]
	programmed_window: word[3]
end

bss result: pcrtc_window_result

return { result = result }
