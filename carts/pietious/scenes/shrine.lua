local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.shrine' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = 'pietious.sprite',
				spatial = { local_transform = { 1, 0, 0, 1, 0, 32 } },
				initial = { base_sprite = { imgid = 'shrine_inside' } },
				options = {
					id = 'shrine.background',
					space_id = 'shrine',
				},
			},
			{
				member_id = 'caption',
				definition_id = 'pietious.caption',
				spatial = { local_transform = { 1, 0, 0, 1, 48, 72 } },
				initial = { text = { order = 1 } },
				options = {
					id = 'shrine.caption',
					space_id = 'shrine',
				},
			},
		},
	})
end

return scene
