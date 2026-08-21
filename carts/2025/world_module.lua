local aem<const> = require('cartlib/aem')
local fsm_system<const> = require('cartlib/fsm/fsm_system')
local input_system<const> = require('cartlib/input/input_system')
local timeline_system<const> = require('cartlib/timeline/timeline_system')

local tick_interval_vblanks<const> = 2

return {
	gameplay_interval_vblanks = tick_interval_vblanks,
	frame_interval_vblanks = tick_interval_vblanks,
	spaces = { 'main' },
	systems = {
		input_system,
		aem,
		fsm_system,
		timeline_system,
	},
}
