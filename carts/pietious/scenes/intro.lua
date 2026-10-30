local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.intro' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = 'pietious.rectangle',
				initial = { rectangle = { order = -1, width = 256, height = 192, color = 0xffffffff } },
				options = {
					id = 'intro.background',
					space_id = 'intro',
				},
			},
			{
				member_id = 'logo',
				definition_id = 'pietious.sprite',
				spatial = { local_transform = { 1, 0, 0, 1, 40, 64 } },
				initial = { base_sprite = { imgid = 'intro_konami', region = { x = 0, y = 0, width = 168, height = 1 } } },
				options = {
					id = 'intro.logo',
					space_id = 'intro',
				},
			},
		},
	})
end

return scene
