local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.title' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = 'pietious.sprite',
				options = {
					order = 350,
					imgid = 'title_screen',
					id = 'title.background',
					space_id = 'title',
				},
			},
			{
				member_id = 'sparkle',
				definition_id = 'pietious.sprite',
				spatial = { local_transform = { 1, 0, 0, 1, 96, 71 } },
				options = {
					order = 351,
					imgid = 'tsf4',
					id = 'title.sparkle',
					space_id = 'title',
				},
			},
		},
	})
end

return scene
