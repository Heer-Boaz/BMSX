local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.lithograph' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = 'pietious.sprite',
				spatial = { local_transform = { 1, 0, 0, 1, 32, 48 } },
				options = {
					imgid = 'lithograph_mode',
					id = 'lithograph.background',
					space_id = 'lithograph',
				},
			},
			{
				member_id = 'caption',
				definition_id = 'pietious.caption',
				spatial = { local_transform = { 1, 0, 0, 1, 0, 80 } },
				options = {
					order = 1,
					background_color = 0xff000000,
					center_block_width = 256,
					id = 'lithograph.caption',
					space_id = 'lithograph',
				},
			},
		},
	})
end

return scene
