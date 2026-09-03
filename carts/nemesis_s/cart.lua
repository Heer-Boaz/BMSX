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
local scene_library<const> = require('cartlib/world/scene_library')
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
local root_scene<const> = require('scenes/root')

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
	root_scene.register()
end

function new_game()
	world:clear()
	scene_library.instantiate(root_scene.id)
end

init()
new_game()
vblank.wait()

while true do
	world:update()
	vblank.wait()
	world:render()
end
