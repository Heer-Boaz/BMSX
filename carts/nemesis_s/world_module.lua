local aem<const> = require('cartlib/aem')
local actioneffect_system<const> = require('cartlib/actioneffects/actioneffect_system')
local behaviour_tree_system<const> = require('cartlib/behaviour_tree/bt_system')
local overlap_2d_system<const> = require('cartlib/collision/overlap_2d_system')
local sprite_animation_system<const> = require('cartlib/component/sprite_animation_system')
local fsm_system<const> = require('cartlib/fsm/fsm_system')
local input_actioneffect_system<const> = require('cartlib/input/actioneffect/system')
local input_system<const> = require('cartlib/input/input_system')
local velocity_system<const> = require('cartlib/physics/velocity_system')
local timeline_system<const> = require('cartlib/timeline/timeline_system')

local gameplay_interval_vblanks<const> = 2

return {
	gameplay_interval_vblanks = gameplay_interval_vblanks,
	frame_interval_vblanks = 1,
	gameplay_clock_rate = {
		numerator = 5,
		denominator = 12,
	},
	spaces = {
		'intro',
		'story',
		'title',
		'game_start',
		'main',
		'game_over',
		'end_demo',
	},
	systems = {
		input_system,
		input_actioneffect_system,
		behaviour_tree_system,
		velocity_system,
		aem,
		fsm_system,
		actioneffect_system,
		overlap_2d_system,
		sprite_animation_system,
		timeline_system,
	},
}
