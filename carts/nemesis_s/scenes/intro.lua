local scene_library<const> = require('cartlib/world/scene_library')
local presentation<const> = require('presentation')

local intro_scene<const> = { id = 'nemesis_s.intro.presentation' }

function intro_scene.register()
	scene_library.register(intro_scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = presentation.cover_definition_id,
				options = {
					sx = 256, sy = 192, color = 0xffffffff,
					pos = { x = 0, y = 0, z = -1 },
				},
			},
			{
				member_id = 'logo',
				definition_id = presentation.sprite_definition_id,
				options = {
					imgid = 'intro_konami',
					pos = { x = 40, y = 64, z = 0 },
				},
			},
		},
	})
end

return intro_scene
