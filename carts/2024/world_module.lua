local fsm_system<const> = require('cartlib/fsm/fsm_system')
local input_system<const> = require('cartlib/input/input_system')
local clock<const> = require('cartlib/clock')

local update_interval_vblanks<const> = 1

return {
	update_milliseconds = clock.configure_update_interval(update_interval_vblanks),
	spaces = { 'main' },
	systems = {
		input_system,
		fsm_system,
	},
}
