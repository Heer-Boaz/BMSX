module<const>

struct gte_cue_result
	completed: word
	vblank_sequence: word
	before_vblank: word
	after_vblank: word
	system_origin: word
	system_size: word
	projected_xy: word[4]
	projected_z: word[4]
	ir0: word[4]
	ir0_after_color: word[4]
	rgb2: word[4]
	projection_flags: word[4]
	color_flags: word[4]
	swatch_words: word[4]
end

bss result: gte_cue_result

return { result = result }
