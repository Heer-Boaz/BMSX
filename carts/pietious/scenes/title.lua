local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.title' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = 'pietious.sprite',
				options = {
					id = 'title.background',
					space_id = 'title',
					pos = { x = 0, y = 0, z = 350 },
					imgid = 'title_screen',
				},
			},
			{
				member_id = 'sparkle',
				definition_id = 'pietious.sprite',
				options = {
					id = 'title.sparkle',
					space_id = 'title',
					pos = { x = 96, y = 71, z = 351 },
					imgid = 'tsf4',
				},
			},
		},
	})
end

return scene
