local input_system<const> = require('cartlib/input/input_system')
local overlap_2d_system<const> = require('cartlib/collision/overlap_2d_system')

local tick_interval_vblanks<const> = 1

return {
	framebuffer_count = 1,
	gameplay_interval_vblanks = tick_interval_vblanks,
	frame_interval_vblanks = tick_interval_vblanks,
	spaces = { 'main', 'alternate' },
	systems = { input_system, overlap_2d_system },
}
