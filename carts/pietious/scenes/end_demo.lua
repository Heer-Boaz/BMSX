local scene_library<const> = require('cartlib/world/scene_library')
local game_text_module<const> = require('game_text')
local game_text<const>: *game_text_record = game_text_module.game_text
local scene<const> = { id = 'pietious.end_demo' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = 'pietious.sprite',
				options = {
					id = 'end_demo.background',
					space_id = 'end_demo',
					pos = { x = 0, y = 0, z = 0 },
					imgid = 'end_demo',
				},
			},
			{
				member_id = 'cover',
				definition_id = 'pietious.rectangle',
				options = {
					id = 'end_demo.cover',
					space_id = 'end_demo',
					pos = { x = 0, y = 176, z = 1 },
					width = 256,
					height = 8,
					color = 0xff000000,
				},
			},
			{
				member_id = 'caption',
				definition_id = 'pietious.caption',
				options = {
					id = 'end_demo.caption',
					space_id = 'end_demo',
					pos = { x = 0, y = 176, z = 2 },
					text = game_text[0].end_demo_message,
				},
			},
		},
	})
end

return scene
