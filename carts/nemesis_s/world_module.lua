local actioneffect_system<const> = require('cartlib/actioneffects/actioneffect_system')
local fsm_system<const> = require('cartlib/fsm/fsm_system')
local input_system<const> = require('cartlib/input/input_system')
local timeline_system<const> = require('cartlib/timeline/timeline_system')

return {
	spaces = { 'main' },
	systems = {
		input_system,
		actioneffect_system,
		fsm_system,
		timeline_system,
	},
}
