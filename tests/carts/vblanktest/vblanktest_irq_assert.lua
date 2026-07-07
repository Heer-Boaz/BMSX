__bmsx_host_test = __bmsx_host_test or {
	frames = 0,
}

local gpustat_pal_mode<const> = 0x00100000
local gpustat_display_disabled<const> = 0x00800000
local gpustat_ready_command<const> = 0x04000000

function __bmsx_host_test.ready()
	return true
end

function __bmsx_host_test.setup()
end

function __bmsx_host_test.update(_frame)
	__bmsx_host_test.frames = __bmsx_host_test.frames + 1
	assert(vblank_test_fail_reason == nil, tostring(vblank_test_fail_reason))
	if vblank_test_passed == true then
		assert(vblank_test_irq_count >= 50, 'vblank IRQ count below target: ' .. tostring(vblank_test_irq_count))
		assert(vblank_test_update_count > 0, 'vblank cart update loop did not resume after IRQ')
		assert((vblank_test_last_gpustat & gpustat_pal_mode) ~= 0, 'GPUSTAT PAL bit clear')
		assert((vblank_test_last_gpustat & gpustat_display_disabled) == 0, 'GPUSTAT display disabled')
		assert((vblank_test_last_gpustat & gpustat_ready_command) ~= 0, 'GPUSTAT command port not ready')
		return true
	end
	assert(__bmsx_host_test.frames < 120, 'vblanktest timed out at irqs=' .. tostring(vblank_test_irq_count) .. ' gpustat=' .. tostring(vblank_test_last_gpustat))
	return false
end
