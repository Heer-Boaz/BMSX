local fsm_system<const> = require('cartlib/fsm/fsm_system')
local input_system<const> = require('cartlib/input/input_system')

local tick_interval_vblanks<const> = 1

return {
	framebuffer_count = 1,
	gameplay_interval_vblanks = tick_interval_vblanks,
	frame_interval_vblanks = tick_interval_vblanks,
	spaces = { 'main' },
	systems = {
		input_system,
		fsm_system,
	},
}
