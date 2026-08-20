module<entry>
local gx_display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
gx_display.reset_256x192()
local input<const> = require('cartlib/input/input')
input.add_player(1)
local world<const> = require('cartlib/world/world')
local world_module<const> = require('world_module')
world:configure(world_module)
require('constants')
local director_module<const> = require('director')
local intro_module<const> = require('intro')
local nemesis_font<const> = require('nemesis_font')
local stage_module<const> = require('stage')
local player_module<const> = require('player/player')
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
	local stage<const> = world:spawn(stage_module.stage_def_id, {
		id = stage_module.stage_instance_id,
		space_id = 'main',
		pos = { x = 0, y = 0, z = 0 },
	})
	world:spawn(player_module.player_def_id, {
		id = player_module.player_instance_id,
		player_index = 1,
		space_id = 'main',
		stage = stage,
		pos = { x = player_start_x, y = player_start_y, z = 70 },
	})
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
	local status_bar<const> = world:spawn(status_bar_module.definition_id, {
		space_id = 'game_start',
		pos = { x = 0, y = 0, z = 100 },
	})
	world:spawn(director_module.director_def_id, {
		stage = stage,
		status_bar = status_bar,
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
