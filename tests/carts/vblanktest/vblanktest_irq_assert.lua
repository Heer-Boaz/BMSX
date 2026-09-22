local gpustat_pal_mode<const> = 0x00100000
local gpustat_display_disabled<const> = 0x00800000
local gpustat_ready_command<const> = 0x04000000

return {
	kind = 'integration',
	tests = {
		vblank_interrupts_resume_the_entry_loop = function(t)
			t:wait_until('50 vblank interrupts', function()
				assert(vblank_test_fail_reason == nil, tostring(vblank_test_fail_reason))
				return vblank_test_passed == true
			end, 120)
			assert(vblank_test_irq_count >= 50, 'vblank IRQ count below target')
			assert(vblank_test_update_count > 0, 'entry loop did not resume after IRQ')
			assert((vblank_test_last_gpustat & gpustat_pal_mode) ~= 0, 'GPUSTAT PAL bit clear')
			assert((vblank_test_last_gpustat & gpustat_display_disabled) == 0, 'GPUSTAT display disabled')
			assert((vblank_test_last_gpustat & gpustat_ready_command) ~= 0, 'GPUSTAT command port not ready')
		end,
	},
}
