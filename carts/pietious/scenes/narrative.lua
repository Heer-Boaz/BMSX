local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.narrative' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'caption',
				definition_id = 'pietious.caption',
				options = {
					id = 'narrative.caption',
					space_id = 'narrative',
					pos = { x = 0, y = 0, z = 0 },
				},
			},
		},
	})
end

return scene
