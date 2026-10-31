local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.gameplay', player_start = { x = 160, y = 104 } }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'player',
				definition_id = 'player',
				position = scene.player_start,
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
