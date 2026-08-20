local aem<const> = require('cartlib/aem')
local clock<const> = require('cartlib/clock')
local fsm_system<const> = require('cartlib/fsm/fsm_system')
local input_system<const> = require('cartlib/input/input_system')
local timeline_system<const> = require('cartlib/timeline/timeline_system')

local update_interval_vblanks<const> = 2

return {
	update_milliseconds = clock.configure_update_interval(update_interval_vblanks),
	spaces = { 'main' },
	systems = {
		input_system,
		aem,
		fsm_system,
		timeline_system,
	},
}
