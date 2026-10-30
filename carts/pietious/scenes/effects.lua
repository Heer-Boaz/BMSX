local scene_library<const> = require('cartlib/world/scene_library')
local game_text_module<const> = require('game_text')
local game_text<const>: *game_text_record = game_text_module.game_text
local scene<const> = { id = 'pietious.effects' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'seal_backdrop',
				definition_id = 'pietious.rectangle',
				initial = { rectangle = { order = -1, width = 256, height = 192, color = 0xffcccccc, visible = false } },
			},
			{
				member_id = 'curtain',
				definition_id = 'pietious.rectangle',
				initial = { rectangle = { order = 1100, width = 256, height = 192, color = 0xff000000, visible = false } },
				options = {
					id = 'effects.curtain',
				},
			},
			{
				member_id = 'victory_cover',
				definition_id = 'pietious.rectangle',
				spatial = { local_transform = { 1, 0, 0, 1, 8, 64 } },
				initial = { rectangle = { order = 1100, width = 240, height = 8, color = 0xff000000, visible = false } },
				options = {
					id = 'effects.victory_cover',
				},
			},
			{
				member_id = 'victory_caption',
				definition_id = 'pietious.caption',
				spatial = { local_transform = { 1, 0, 0, 1, 8, 64 } },
				initial = { text = { order = 1101, text = game_text[0].victory_message, visible = false } },
				options = {
					id = 'effects.victory_caption',
				},
			},
		},
	})
end

return scene
