local aem<const> = require('cartlib/aem')
local overlap_2d_system<const> = require('cartlib/collision/overlap_2d_system')
local sprite_animation_system<const> = require('cartlib/component/sprite_animation_system')
local fsm_system<const> = require('cartlib/fsm/fsm_system')
local input_system<const> = require('cartlib/input/input_system')
local velocity_system<const> = require('cartlib/physics/velocity_system')
local timeline_system<const> = require('cartlib/timeline/timeline_system')
local rook_animation_system<const> = require('enemies/rook_animation_system')

return {
	spaces = {
		'intro',
		'story',
		'title',
		'game_start',
		'main',
	},
	systems = {
		input_system,
		velocity_system,
		aem,
		fsm_system,
		overlap_2d_system,
		sprite_animation_system,
		rook_animation_system,
		timeline_system,
	},
}
