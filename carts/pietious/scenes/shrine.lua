local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.shrine' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = 'pietious.sprite',
				position = { x = 0, y = 32 },
				options = {
					imgid = 'shrine_inside',
					id = 'shrine.background',
					space_id = 'shrine',
				},
			},
			{
				member_id = 'caption',
				definition_id = 'pietious.caption',
				position = { x = 48, y = 72 },
				options = {
					order = 1,
					id = 'shrine.caption',
					space_id = 'shrine',
				},
			},
		},
	})
end

return scene
