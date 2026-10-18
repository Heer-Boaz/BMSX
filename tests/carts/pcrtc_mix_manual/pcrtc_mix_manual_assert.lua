local state<const> = require('results')
local result<const>: *pcrtc_mix_result = state.result
local pmode<const>: *word = 0x08010354
local framebuffer1<const>: *word = 0x0801035c
local source1<const>: *word = 0x08010360
local window1<const>: *word = 0x08010364
local extent1<const>: *word = 0x08010368
local framebuffer2<const>: *word = 0x0801036c
local source2<const>: *word = 0x08010370
local window2<const>: *word = 0x08010374
local extent2<const>: *word = 0x08010378
local background<const>: *word = 0x0801037c
local gp1<const>: *word = 0x08010240

rodata modes: word[4] = { 0x00008023, 0x00008003, 0x00008083, 0x00008043 }
rodata pixels: word[3] = { 0x001f, 0x801f, 0xfc00 }

return {
	kind = 'integration',
	tests = {
		composition_words_and_source_lifetime = function(t)
			t:wait_until('all four PMODE phases published', function()
				return result.completed_phase == 4
			end, 16)
			for phase = 0, 3 do
				assert(result.programmed_pmode[phase] == modes[phase])
				assert(result.after_vblank[phase] > result.before_vblank[phase])
				if phase > 0 then
					assert(result.before_vblank[phase] - result.after_vblank[phase - 1] >= 2)
				end
			end
			for index = 0, 2 do
				assert(result.source_words[index] == pixels[index])
			end
			assert(*pmode == 0x00008043)
			assert(*framebuffer1 == 0x000fa000)
			assert(*framebuffer2 == 0x000fa040)
			assert(*source1 == 0 and *source2 == 0)
			assert(*window1 == 0x018252a8 and *window2 == 0x018252a8)
			assert(*extent1 == 0x000bf3ff and *extent2 == 0x000bf3ff)
			assert(*background == 0x0000ff00)
			assert((result.system_origin >> 16) >= 448)
			assert(result.system_size == 0x00fc0140)
			assert((*gp1 & 0x0c000000) == 0x04000000)
			t:log('four PMODE words, raw source alpha bits, fixed sources/windows/background, firmware exclusion, idle and fresh VBlanks pass; output RGB/alpha checked separately')
		end,
	},
}
