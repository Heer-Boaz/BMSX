local state_machine_system<const> = require('cartlib/fsm/state_machine_system')
local player_input_system<const> = require('cartlib/input/player_input_system')
local timeline_system<const> = require('cartlib/timeline/timeline_system')

return {
	spaces = { 'main' },
	systems = {
		player_input_system,
		state_machine_system,
		timeline_system,
	},
}
