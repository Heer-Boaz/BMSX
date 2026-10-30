local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.lithograph' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = 'pietious.sprite',
				spatial = { local_transform = { 1, 0, 0, 1, 32, 48 } },
				initial = { base_sprite = { imgid = 'lithograph_mode' } },
				options = {
					id = 'lithograph.background',
					space_id = 'lithograph',
				},
			},
			{
				member_id = 'caption',
				definition_id = 'pietious.caption',
				spatial = { local_transform = { 1, 0, 0, 1, 0, 80 } },
				initial = { text = { order = 1, background_color = 0xff000000, center_block_width = 256 } },
				options = {
					id = 'lithograph.caption',
					space_id = 'lithograph',
				},
			},
		},
	})
end

return scene
