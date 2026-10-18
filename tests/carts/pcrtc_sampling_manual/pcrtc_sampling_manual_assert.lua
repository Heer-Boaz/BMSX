local state<const> = require('results')
local result<const>: *pcrtc_sampling_result = state.result
local pmode<const>: *word = 0x08010354
local framebuffer<const>: *word = 0x0801035c
local gp1<const>: *word = 0x08010240

rodata expected: word[8] = {
	0x80018000, 0x80038002, 0x80058004, 0x80078006,
	0x80098008, 0x800b800a, 0x800d800c, 0x800f800e,
}

return {
	kind = 'integration',
	tests = {
		unequal_magnification_source_row = function(t)
			t:wait_until('eight-pixel sampling window published', function()
				return result.completed == 1
			end, 4)
			for index = 0, #expected - 1 do
				assert(result.source_words[index] == expected[index])
			end
			assert(result.programmed_source == 0x00008020)
			assert(result.programmed_window == 0x010252aa)
			assert(result.programmed_extent == 0x0000001f)
			assert(result.after_vblank > result.before_vblank)
			assert(*pmode == 0x0000ff21)
			assert(*framebuffer == 0x000fa000)
			assert((*gp1 & 0x0c000000) == 0x04000000)
			t:log('sixteen raw source pixels8000..800F recovered; source32,16; signal682,37; factor3; extent31; freshVBlank; GPUidle/readbackdrained. Output selection is checked separately from the capture.')
		end,
	},
}
