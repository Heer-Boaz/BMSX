local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.gameplay' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'player',
				definition_id = 'player',
				options = {
					id = 'pietolon',
					space_id = 'main',
					pos = { x = 160, y = 104, z = 140 },
				},
			},
			{
				member_id = 'hud',
				definition_id = 'ui',
				options = {
					id = 'ui',
					space_id = 'ui',
					pos = { x = 0, y = 0, z = 1000 },
				},
			},
		},
	})
end

return scene
