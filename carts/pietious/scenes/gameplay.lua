local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.gameplay' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'player',
				definition_id = 'player',
				spatial = { local_transform = { 1, 0, 0, 1, 160, 104 } },
				initial = { base_sprite = { order = 250 } },
				options = {
					id = 'pietolon',
					space_id = 'main',
				},
			},
			{
				member_id = 'hud',
				definition_id = 'ui',
				initial = { visual = { order = 1000 } },
				options = {
					id = 'ui',
					space_id = 'ui',
				},
			},
		},
	})
end

return scene
