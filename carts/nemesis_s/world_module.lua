local aem<const> = require('cartlib/aem')
local actioneffect_system<const> = require('cartlib/actioneffects/actioneffect_system')
local clock<const> = require('cartlib/clock')
local overlap_2d_system<const> = require('cartlib/collision/overlap_2d_system')
local sprite_animation_system<const> = require('cartlib/component/sprite_animation_system')
local fsm_system<const> = require('cartlib/fsm/fsm_system')
local input_system<const> = require('cartlib/input/input_system')
local velocity_system<const> = require('cartlib/physics/velocity_system')
local timeline_system<const> = require('cartlib/timeline/timeline_system')

local update_interval_vblanks<const> = 2

return {
	update_milliseconds = clock.configure_update_interval(update_interval_vblanks),
	gameplay_clock_rate = {
		numerator = 5,
		denominator = 6,
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
		velocity_system,
		aem,
		fsm_system,
		actioneffect_system,
		overlap_2d_system,
		sprite_animation_system,
		timeline_system,
	},
}
