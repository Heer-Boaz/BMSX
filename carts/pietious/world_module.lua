local action_effect_system<const> = require('cartlib/action_effects/action_effect_system')
local behaviour_tree_system<const> = require('cartlib/behaviour_tree/behaviour_tree_system')
local elevator_system<const> = require('elevator/system')
local state_machine_system<const> = require('cartlib/fsm/state_machine_system')
local input_action_effect_system<const> = require('cartlib/input/action_effect/system')
local player_input_system<const> = require('cartlib/input/player_input_system')
local overlap_2d_system<const> = require('cartlib/collision/overlap_2d_system')
local screen_boundary_capture_system<const> = require('cartlib/collision/screen_boundary_capture_system')
local screen_boundary_system<const> = require('cartlib/collision/screen_boundary_system')
local tile_collision_system<const> = require('cartlib/collision/tile_collision_system')
local timeline_system<const> = require('cartlib/timeline/timeline_system')

return {
	spaces = {
		'main',
		'title',
		'transition',
		'shrine',
		'lithograph',
		'item',
		'ui',
	},
	systems = {
		player_input_system,
		behaviour_tree_system,
		input_action_effect_system,
		action_effect_system,
		state_machine_system,
		screen_boundary_capture_system,
		screen_boundary_system,
		overlap_2d_system,
		tile_collision_system,
		timeline_system,
		elevator_system,
	},
}
