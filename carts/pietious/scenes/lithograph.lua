local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.lithograph' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = 'pietious.sprite',
				options = {
					id = 'lithograph.background',
					space_id = 'lithograph',
					pos = { x = 32, y = 48, z = 0 },
					imgid = 'lithograph_mode',
				},
			},
			{
				member_id = 'caption',
				definition_id = 'pietious.caption',
				options = {
					id = 'lithograph.caption',
					space_id = 'lithograph',
					pos = { x = 0, y = 80, z = 1 },
					center_block_width = 256,
					background_color = 0xff000000,
				},
			},
		},
	})
end

return scene
