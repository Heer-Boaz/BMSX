local action_effect_system<const> = require('cartlib/action_effects/action_effect_system')
local state_machine_system<const> = require('cartlib/fsm/state_machine_system')
local input_action_effect_system<const> = require('cartlib/input/action_effect/system')
local player_input_system<const> = require('cartlib/input/player_input_system')
local timeline_system<const> = require('cartlib/timeline/timeline_system')

return {
	spaces = { 'main' },
	systems = {
		player_input_system,
		input_action_effect_system,
		action_effect_system,
		state_machine_system,
		timeline_system,
	},
}
