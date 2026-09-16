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
					imgid = 'title_screen_1',
					alternate_imgid = 'title_screen_2',
					pos = { x = 0, y = 0, z = 0 },
				},
			},
			{
				member_id = 'selector',
				definition_id = presentation.sprite_definition_id,
				options = {
					imgid = 'title_selector',
					pos = { x = 80, y = 136, z = 1 },
				},
			},
			{
				member_id = 'selection_cover',
				definition_id = presentation.cover_definition_id,
				options = {
					sx = 64, sy = 8, color = 0xff000000,
					visible = false,
					pos = { x = 104, y = 136, z = 2 },
				},
			},
		},
	})
end

return title_scene
