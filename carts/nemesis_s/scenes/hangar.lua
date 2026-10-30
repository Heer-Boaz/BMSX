local scene_library<const> = require('cartlib/world/scene_library')
local presentation<const> = require('presentation')
local hangar_ship<const> = require('hangar_ship')

local hangar_scene<const> = { id = 'nemesis_s.hangar' }

function hangar_scene.register()
	scene_library.register(hangar_scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = presentation.sprite_definition_id,
				options = {
					images = { 'title_hangar_1', 'title_hangar_2' },
				},
			},
			{
				member_id = 'ship',
				definition_id = hangar_ship.definition_id,
				spatial = { local_transform = { 1, 0, 0, 1, 48, 129 } },
			},
			{
				member_id = 'foreground',
				definition_id = presentation.sprite_definition_id,
				spatial = { local_transform = { 1, 0, 0, 1, 0, 128 } },
				initial = { base_sprite = { imgid = 'title_hangar_bottom_hider', order = 4 } },
			},
		},
	})
end

return hangar_scene
