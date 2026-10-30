local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.title' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = 'pietious.sprite',
				initial = { base_sprite = { order = 350, imgid = 'title_screen' } },
				options = {
					id = 'title.background',
					space_id = 'title',
				},
			},
			{
				member_id = 'sparkle',
				definition_id = 'pietious.sprite',
				spatial = { local_transform = { 1, 0, 0, 1, 96, 71 } },
				initial = { base_sprite = { order = 351, imgid = 'tsf4' } },
				options = {
					id = 'title.sparkle',
					space_id = 'title',
				},
			},
		},
	})
end

return scene
