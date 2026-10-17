module<const>

struct display_manual_result
	completed_phase: word
	vblank_sequence: word
	system_origin: word
	system_size: word
	samples: word[4]
	before_vblank: word[3]
	after_vblank: word[3]
	programmed_framebuffer: word[3]
end

bss result: display_manual_result

return { result = result }
