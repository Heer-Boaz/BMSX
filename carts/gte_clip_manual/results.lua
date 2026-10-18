module<const>

local gte<const> = require('cartlib/gx/gte')

struct gte_clip_result
	completed: word
	vblank_sequence: word
	before_vblank: word[2]
	after_vblank: word[2]
	system_origin: word
	system_size: word
	original: gte_vector[3]
	quad: gte_vector[4]
	screen: word[3][3]
	depth: word[3][4]
	projection_flags: word[3]
	projection_cycles: word[3]
	ir0: word[3]
	area: word[3]
	area_flags: word[3]
	probe_words: word[2][2]
end

bss result: gte_clip_result

return { result = result }
