local state<const> = require('results')
local result<const>: *pcrtc_window_result = state.result
local source1<const>: *word = 0x08010360
local window1<const>: *word = 0x08010364
local framebuffer2<const>: *word = 0x0801036c
local source2<const>: *word = 0x08010370
local window2<const>: *word = 0x08010374
local extent2<const>: *word = 0x08010378

return {
	kind = 'integration',
	tests = {
		source_and_window_are_independent = function(t)
			t:wait_until('source0 window64 published', function()
				return result.completed_phase >= 1
			end, 6)
			assert(result.completed_phase == 1)
			assert(*source1 == 0)
			assert(*window1 == 0x018553a8)
			t:wait_until('source32 window64 published', function()
				return result.completed_phase >= 2
			end, 6)
			assert(result.completed_phase == 2)
			assert(*source1 == 0x00008020)
			assert(*window1 == 0x018553a8)
			t:wait_until('source32 window96 published', function()
				return result.completed_phase == 3
			end, 6)
			assert(*source1 == 0x00008020)
			assert(*window1 == 0x01855428)
			assert(result.programmed_source[0] == 0)
			assert(result.programmed_source[1] == 0x00008020)
			assert(result.programmed_source[2] == 0x00008020)
			assert(result.programmed_window[0] == 0x018553a8)
			assert(result.programmed_window[1] == 0x018553a8)
			assert(result.programmed_window[2] == 0x01855428)
			assert(*framebuffer2 == 0x000fa000)
			assert(*source2 == 0)
			assert(*window2 == 0x018252a8)
			assert(*extent2 == 0x000bf3ff)
			assert(result.samples[0] == 0xffff)
			assert(result.samples[1] == 0x8000)
			assert(result.samples[2] == 0x801f)
			assert(result.system_origin == 0x02d002c0)
			assert(result.system_size == 0x00fc0140)
			for index = 0, 2 do
				assert(result.after_vblank[index] > result.before_vblank[index])
			end
			t:log('three source/window stages published; fixed circuit2; raw white/black/red FFFF/8000/801F; three fresh VBlank sequence changes; firmware VRAM region excluded')
		end,
	},
}
