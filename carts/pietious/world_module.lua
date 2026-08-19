local bt_system<const> = require('cartlib/behaviour_tree/bt_system')
local elevator_system<const> = require('elevator/system')
local fsm_system<const> = require('cartlib/fsm/fsm_system')
local input_actioneffect_system<const> = require('cartlib/input/actioneffect/system')
local input_system<const> = require('cartlib/input/input_system')
local overlap_2d_system<const> = require('cartlib/collision/overlap_2d_system')
local screen_boundary_capture_system<const> = require('cartlib/physics/screen_boundary_capture_system')
local screen_boundary_system<const> = require('cartlib/physics/screen_boundary_system')
local velocity_system<const> = require('cartlib/physics/velocity_system')
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
		input_system,
		bt_system,
		velocity_system,
		input_actioneffect_system,
		fsm_system,
		screen_boundary_capture_system,
		screen_boundary_system,
		overlap_2d_system,
		tile_collision_system,
		timeline_system,
		elevator_system,
	},
}
