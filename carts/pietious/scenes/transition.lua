local scene_library<const> = require('cartlib/world/scene_library')
local game_text_module<const> = require('game_text')
local game_text<const>: *game_text_record = game_text_module.game_text
local scene<const> = { id = 'pietious.transition' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = 'pietious.rectangle',
				initial = { rectangle = { width = 256, height = 192, color = 0xff000000 } },
				options = {
					id = 'transition.background',
					space_id = 'transition',
				},
			},
			{
				member_id = 'banner',
				definition_id = 'pietious.caption',
				spatial = { local_transform = { 1, 0, 0, 1, 0, 104 } },
				initial = { text = { order = 1, center_block_width = 256 } },
				options = {
					id = 'transition.banner',
					space_id = 'transition',
				},
			},
			{
				member_id = 'death_caption',
				definition_id = 'pietious.caption',
				spatial = { local_transform = { 1, 0, 0, 1, 0, 80 } },
				initial = { text = { order = 1, center_block_width = 256, text = game_text[0].death_screen } },
				options = {
					id = 'transition.death',
					space_id = 'transition',
				},
			},
		},
	})
end

return scene
