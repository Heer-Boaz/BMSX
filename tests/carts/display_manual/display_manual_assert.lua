local state<const> = require('results')
local result<const>: *display_manual_result = state.result
local framebuffer<const>: *word = 0x0801035c

return {
	kind = 'integration',
	tests = {
		publication_and_two_surface_reuse = function(t)
			t:wait_until('red surface A published', function()
				return result.completed_phase >= 1
			end, 6)
			assert(result.completed_phase == 1)
			assert(*framebuffer == 0x000fa000)
			assert(result.samples[0] == 0x001f)
			assert(result.samples[1] == 0x7c00)

			t:wait_until('blue B selected while A is rebuilt', function()
				return result.completed_phase >= 2
			end, 6)
			assert(result.completed_phase == 2)
			assert(*framebuffer == 0x000fa040)
			assert(result.samples[2] == 0x03e0)
			assert(result.samples[3] == 0x7c00)

			t:wait_until('reused green surface A published', function()
				return result.completed_phase == 3
			end, 6)
			assert(*framebuffer == 0x000fa000)

			assert(result.system_origin == 0x02d002c0)
			assert(result.system_size == 0x00fc0140)
			for index = 0, 2 do
				assert(result.after_vblank[index] > result.before_vblank[index])
			end
			assert(result.programmed_framebuffer[0] == 0x000fa000)
			assert(result.programmed_framebuffer[1] == 0x000fa040)
			assert(result.programmed_framebuffer[2] == 0x000fa000)
		end,
	},
}
