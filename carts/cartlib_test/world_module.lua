local input_system<const> = require('cartlib/input/input_system')
local overlap_2d_system<const> = require('cartlib/collision/overlap_2d_system')
local collision_2d<const> = require('cartlib/collision/collision_2d')

-- GEO overlap passes stage their colliders (24 bytes each) and contacts (36
-- bytes each) here: 32 KiB holds 256 colliders, their layer index and 682 contacts per pass.
bss geo_overlap_workspace: word[8192]
collision_2d.use_workspace(geo_overlap_workspace, 8192 * 4)

local tick_interval_vblanks<const> = 1

return {
	framebuffer_count = 1,
	gameplay_interval_vblanks = tick_interval_vblanks,
	frame_interval_vblanks = tick_interval_vblanks,
	spaces = { 'main' },
	systems = { input_system, overlap_2d_system },
}
