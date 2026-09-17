local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.shrine' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = 'pietious.sprite',
				options = {
					id = 'shrine.background',
					space_id = 'shrine',
					pos = { x = 0, y = 32, z = 0 },
					imgid = 'shrine_inside',
				},
			},
			{
				member_id = 'caption',
				definition_id = 'pietious.caption',
				options = {
					id = 'shrine.caption',
					space_id = 'shrine',
					pos = { x = 48, y = 72, z = 1 },
				},
			},
		},
	})
end

return scene
