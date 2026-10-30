local scene_library<const> = require('cartlib/world/scene_library')
local presentation<const> = require('presentation')

local title_scene<const> = { id = 'nemesis_s.title' }

function title_scene.register()
	scene_library.register(title_scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = presentation.sprite_definition_id,
				options = {
					images = { 'title_screen_1', 'title_screen_2' },
				},
			},
			{
				member_id = 'selector',
				definition_id = presentation.sprite_definition_id,
				spatial = { local_transform = { 1, 0, 0, 1, 80, 136 } },
				initial = { base_sprite = { imgid = 'title_selector', order = 1 } },
			},
			{
				member_id = 'selection_cover',
				definition_id = presentation.cover_definition_id,
				options = {
					visible = false,
				},
				spatial = { local_transform = { 1, 0, 0, 1, 104, 136 } },
				initial = { rectangle = { width = 64, height = 8, color = 0xff000000, order = 2 } },
			},
		},
	})
end

return title_scene
