module<entry>
local gx_display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
gx_display.reset_256x192()
local input<const> = require('cartlib/input/input')
input.add_player(1)
input.add_player(2)
input.push_context(1, 'nemesis_s', {
	fire = { 'Space' },
}, {
	fire = { 'a' },
})
input.push_context(2, 'nemesis_s', {
	up = { 'Numpad5' },
	right = { 'Numpad3' },
	down = { 'Numpad2' },
	left = { 'Numpad1' },
	fire = { 'ControlLeft' },
}, {
	fire = { 'a' },
})
local world<const> = require('cartlib/world/world')
local world_module<const> = require('world_module')
world:configure(world_module)
require('constants')
local director_module<const> = require('director')
local intro_module<const> = require('intro')
local nemesis_font<const> = require('nemesis_font')
local stage_module<const> = require('stage')
local player_module<const> = require('player/player')
local mijter_foe<const> = require('enemies/mijter_foe')
local schoorsteen_ray<const> = require('enemies/schoorsteen_ray')
local schoorsteen_foe<const> = require('enemies/schoorsteen_foe')
local rook<const> = require('enemies/rook')
local rook_generator<const> = require('enemies/rook_generator')
local enemy_bullet<const> = require('enemies/enemy_bullet')
local zak_foe<const> = require('enemies/zak_foe')
local sneeuwpop_ray<const> = require('enemies/sneeuwpop_ray')
local destroyed_sneeuwpop<const> = require('enemies/destroyed_sneeuwpop')
local sneeuwpop<const> = require('enemies/sneeuwpop')
local sint_pop<const> = require('enemies/sint_pop')
local status_bar_module<const> = require('status_bar')
local story_module<const> = require('story')
local title_screen_module<const> = require('title_screen')

local function init<init>()
	nemesis_font.register()
	intro_module.define_fsm()
	story_module.define_fsm()
	title_screen_module.define_fsm()
	stage_module.define_stage_fsm()
	player_module.define_player_fsm()
	mijter_foe.register()
	sint_pop.register()
	schoorsteen_ray.register()
	schoorsteen_foe.register()
	rook.register()
	rook_generator.register()
	enemy_bullet.register()
	zak_foe.register()
	sneeuwpop_ray.register()
	destroyed_sneeuwpop.register()
	sneeuwpop.register()
	director_module.define_director_fsm()
	intro_module.register_definition()
	story_module.register_definition()
	title_screen_module.register_definition()
	stage_module.register_stage_definition()
	player_module.register_player_definition()
	status_bar_module.register_definition()
	director_module.register_director_definition()
end

function new_game()
	world:clear()
	world:spawn(intro_module.definition_id, {
		space_id = 'intro',
		pos = { x = 0, y = 0, z = 0 },
	})
	world:spawn(story_module.definition_id, {
		space_id = 'story',
		pos = { x = 0, y = 0, z = 0 },
	})
	world:spawn(title_screen_module.definition_id, {
		space_id = 'title',
		pos = { x = 0, y = 0, z = 0 },
	})
	world:spawn(director_module.director_def_id, {
		space_id = 'intro',
		pos = { x = 0, y = 0, z = 0 },
	})
end

init()
new_game()
vblank.wait()

while true do
	world:update()
	vblank.wait()
	world:render()
end
