local scene_library<const> = require('cartlib/world/scene_library')
local presentation<const> = require('presentation')

local intro_scene<const> = { id = 'nemesis_s.intro.presentation' }

function intro_scene.register()
	scene_library.register(intro_scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = presentation.cover_definition_id,
				initial = { rectangle = { width = 256, height = 192, color = 0xffffffff, order = -1 } },
			},
			{
				member_id = 'logo',
				definition_id = presentation.sprite_definition_id,
				spatial = { local_transform = { 1, 0, 0, 1, 40, 64 } },
				initial = { base_sprite = { imgid = 'intro_konami' } },
			},
		},
	})
end

return intro_scene
