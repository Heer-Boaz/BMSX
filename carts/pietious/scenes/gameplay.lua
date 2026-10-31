local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.gameplay' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'player',
				definition_id = 'player',
				spatial = { local_transform = { 1, 0, 0, 1, 160, 104 } },
				options = {
					order = 250,
					id = 'pietolon',
					space_id = 'main',
				},
			},
			{
				member_id = 'hud',
				definition_id = 'ui',
				options = {
					order = 1000,
					id = 'ui',
					space_id = 'ui',
				},
			},
		},
	})
end

return scene
