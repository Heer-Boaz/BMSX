local state<const> = require('results')
local result<const>: *gte_cue_result = state.result
local pmode<const>: *word = 0x08010354
local framebuffer<const>: *word = 0x0801035c
local source<const>: *word = 0x08010360
local window<const>: *word = 0x08010364
local extent<const>: *word = 0x08010368
local gp1<const>: *word = 0x08010240

rodata depths: word[4] = { 256, 384, 512, 768 }
rodata coefficients: word[4] = { 0, 2048, 3072, 4096 }
rodata colors: word[4] = { 0x344b519e, 0x34755876, 0x348a5c63, 0x34a05f4f }
rodata pixels: word[4] = { 0xa553, 0xb96e, 0xc56c, 0xd169 }
rodata material_colors: word[3] = { 0x3464d9fc, 0x344b519e, 0x343ea33f }
rodata material_pixels: word[3] = { 0xb37f, 0xa553, 0x9e87 }

return {
	kind = 'integration',
	tests = {
		depth_cue_and_display_words = function(t)
			t:wait_until('four depth-cued swatches published', function()
				return result.completed == 1
			end, 4)
			for index = 0, 3 do
				assert(result.projected_xy[index] == 0)
				assert(result.projected_z[index] == depths[index])
				assert(result.ir0[index] == coefficients[index])
				assert(result.ir0_after_color[index] == coefficients[index])
				assert(result.rgb2[index] == colors[index])
				assert(result.projection_flags[index] == 0)
				assert(result.color_flags[index] == 0x00400000)
				assert(result.swatch_words[index] == pixels[index])
			end
			assert(result.after_vblank > result.before_vblank)
			assert((result.system_origin >> 16) >= 448)
			assert(result.system_size == 0x00fc0140)
			assert(*pmode == 0x0000ff21)
			assert(*framebuffer == 0x000fa000)
			assert(*source == 0)
			assert(*window == 0x018252a8)
			assert(*extent == 0x000bf3ff)
			assert((*gp1 & 0x0c000000) == 0x04000000)
			t:wait_until('lighting reference and materials published from second surface', function()
				return result.completed == 2
			end, 8)
			for index = 0, 2 do
				assert(result.material_rgb2[index] == material_colors[index])
				assert(result.material_flags[index] == 0x00400000)
				assert(result.material_words[index] == material_pixels[index])
			end
			for index = 0, 3 do
				assert(result.preserved_depth_words[index] == pixels[index])
			end
			assert(result.material_ir0 == 4096)
			assert(result.material_after_vblank > result.material_before_vblank)
			assert(result.material_before_vblank - result.after_vblank >= 2)
			assert(*framebuffer == 0x000fa040)
			assert(*pmode == 0x0000ff21)
			assert((*gp1 & 0x0c000000) == 0x04000000)
			t:log('depth cue and NCS/NCCS material rows, flags, retained IR0, both raw surfaces, firmware exclusion and freshVBlank passed. Both full output images are checked separately.')
		end,
	},
}
