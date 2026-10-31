local scene_library<const> = require('cartlib/world/scene_library')
local presentation<const> = require('presentation')
local player_start<const> = require('player/player_start')
local starfield<const> = require('starfield')
local stage<const> = require('stage')
local status_bar<const> = require('status_bar')

local gameplay_scene<const> = { id = 'nemesis_s.gameplay' }

function gameplay_scene.register()
	scene_library.register(gameplay_scene.id, {
		objects = {
			{
				member_id = 'starfield',
				definition_id = starfield.definition_id,
				options = {
					order = 16,
					id = starfield.instance_id,
					space_id = 'main',
				},
			},
			{
				member_id = 'stage',
				definition_id = stage.stage_def_id,
				options = {
					order = 16,
					id = stage.stage_instance_id,
					space_id = 'main',
				},
			},
			{
				member_id = 'status_bar',
				definition_id = status_bar.definition_id,
				options = {
					id = status_bar.instance_id, space_id = 'game_start', order = 100,
				},
				spatial = { local_transform = { 1, 0, 0, 1, 0, 176 } },
			},
			{
				member_id = 'player_start_1',
				definition_id = player_start.definition_id,
				options = {
					player_id = 'nemesis_s.player.1', space_id = 'main',
				},
				spatial = { local_transform = { 1, 0, 0, 1, 80, 60 } },
			},
			{
				member_id = 'player_start_2',
				definition_id = player_start.definition_id,
				options = {
					player_id = 'nemesis_s.player.2', space_id = 'main',
				},
				spatial = { local_transform = { 1, 0, 0, 1, 120, 80 } },
			},
			{
				member_id = 'game_over_curtain',
				definition_id = presentation.cover_definition_id,
				options = {
					width = 0,
					height = 192,
					color = 0xff000000,
					order = 200,
					space_id = 'main',
					visible = false,
				},
			},
		},
	})
end

return gameplay_scene
