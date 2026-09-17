local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = { id = 'pietious.intro' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = 'pietious.rectangle',
				options = {
					id = 'intro.background',
					space_id = 'intro',
					pos = { x = 0, y = 0, z = -1 },
					width = 256,
					height = 192,
					color = 0xffffffff,
				},
			},
			{
				member_id = 'logo',
				definition_id = 'pietious.sprite',
				options = {
					id = 'intro.logo',
					space_id = 'intro',
					pos = { x = 40, y = 64, z = 0 },
					imgid = 'intro_konami',
					region = { x = 0, y = 0, width = 168, height = 1 },
				},
			},
		},
	})
end

return scene
