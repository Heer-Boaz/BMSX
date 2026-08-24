module<entry>
local gx_display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
gx_display.reset_256x192()
local input<const> = require('cartlib/input/input')
local left_stick<const> = input.stick_directions('ls', 0x00008000)
input.add_player(1)
input.add_player(2)
input.push_context(1, 'nemesis_s', {
	confirm = { 'Space', 'AltRight' },
	fire = { 'Space' },
	pause = { 'F1' },
	powerup = { 'KeyM', 'KeyN' },
	key_a = { 'KeyA' },
	key_b = { 'KeyB' },
	key_c = { 'KeyC' },
	key_d = { 'KeyD' },
	key_e = { 'KeyE' },
	key_f = { 'KeyF' },
	key_g = { 'KeyG' },
	key_h = { 'KeyH' },
	key_i = { 'KeyI' },
	key_j = { 'KeyJ' },
	key_k = { 'KeyK' },
	key_l = { 'KeyL' },
	key_m = { 'KeyM' },
	key_n = { 'KeyN' },
	key_o = { 'KeyO' },
	key_p = { 'KeyP' },
	key_q = { 'KeyQ' },
	key_r = { 'KeyR' },
	key_s = { 'KeyS' },
	key_t = { 'KeyT' },
	key_u = { 'KeyU' },
	key_v = { 'KeyV' },
	key_w = { 'KeyW' },
	key_x = { 'KeyX' },
	key_y = { 'KeyY' },
	key_z = { 'KeyZ' },
	key_1 = { 'Digit1' },
	key_8 = { 'Digit8' },
	key_enter = { 'Enter' },
	key_character = {
		'KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF', 'KeyG',
		'KeyH', 'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyM', 'KeyN',
		'KeyO', 'KeyP', 'KeyQ', 'KeyR', 'KeyS', 'KeyT', 'KeyU',
		'KeyV', 'KeyW', 'KeyX', 'KeyY', 'KeyZ',
		'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
		'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
	},
}, {
	confirm = { 'a', 'start', 'touch' },
	up = { 'up', left_stick.up },
	right = { 'right', left_stick.right },
	down = { 'down', left_stick.down },
	left = { 'left', left_stick.left },
	fire = { 'a' },
	pause = { 'start' },
	powerup = { 'x' },
})
input.push_context(2, 'nemesis_s', {
	up = { 'Numpad5' },
	right = { 'Numpad3' },
	down = { 'Numpad2' },
	left = { 'Numpad1' },
	fire = { 'ControlLeft' },
	powerup = { 'AltLeft' },
}, {
	up = { 'up', left_stick.up },
	right = { 'right', left_stick.right },
	down = { 'down', left_stick.down },
	left = { 'left', left_stick.left },
	fire = { 'a' },
	pause = { 'start' },
	powerup = { 'x' },
})
local world<const> = require('cartlib/world/world')
local world_module<const> = require('world_module')
world:configure(world_module)
require('constants')
local director_module<const> = require('director')
local end_demo_module<const> = require('end_demo')
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
local explosion<const> = require('effects/explosion')
local roodje<const> = require('items/roodje')
local option_pickup<const> = require('items/option_pickup')
local noot<const> = require('enemies/noot')
local kerk<const> = require('enemies/kerk')
local bel<const> = require('enemies/bel')
local mini_moon<const> = require('enemies/mini_moon')
local moon_small_ray<const> = require('enemies/moon_small_ray')
local moon_death_ray<const> = require('enemies/moon_death_ray')
local moon_tree<const> = require('enemies/moon_tree')
local moon<const> = require('enemies/moon')
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
	end_demo_module.define_fsm()
	stage_module.define_stage_fsm()
	player_module.define_player_fsm()
	mijter_foe.register()
	sint_pop.register()
	schoorsteen_ray.register()
	schoorsteen_foe.register()
	rook.register()
	rook_generator.register()
	enemy_bullet.register()
	explosion.register()
	roodje.register()
	option_pickup.register()
	noot.register()
	kerk.register()
	bel.register()
	mini_moon.register()
	moon_small_ray.register()
	moon_death_ray.register()
	moon_tree.register()
	moon.register()
	zak_foe.register()
	sneeuwpop_ray.register()
	destroyed_sneeuwpop.register()
	sneeuwpop.register()
	director_module.define_director_fsm()
	intro_module.register_definition()
	story_module.register_definition()
	title_screen_module.register_definition()
	end_demo_module.register_definition()
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
