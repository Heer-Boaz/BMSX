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
					pos = { x = 0, y = 0, z = 0 },
				},
			},
			{
				member_id = 'ship',
				definition_id = hangar_ship.definition_id,
				options = {
					pos = { x = 48, y = 129, z = 3 },
				},
			},
			{
				member_id = 'foreground',
				definition_id = presentation.sprite_definition_id,
				options = {
					imgid = 'title_hangar_bottom_hider',
					pos = { x = 0, y = 128, z = 4 },
				},
			},
		},
	})
end

return hangar_scene
