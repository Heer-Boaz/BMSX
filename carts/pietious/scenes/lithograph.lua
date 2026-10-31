local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.lithograph' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = 'pietious.sprite',
				position = { x = 32, y = 48 },
				options = {
					imgid = 'lithograph_mode',
					id = 'lithograph.background',
					space_id = 'lithograph',
				},
			},
			{
				member_id = 'caption',
				definition_id = 'pietious.caption',
				position = { x = 0, y = 80 },
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
