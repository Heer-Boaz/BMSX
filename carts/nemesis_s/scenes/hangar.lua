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
				position = { x = 48, y = 129 },
			},
			{
				member_id = 'foreground',
				definition_id = presentation.sprite_definition_id,
				position = { x = 0, y = 128 },
				options = {
					imgid = 'title_hangar_bottom_hider',
					order = 4,
				},
			},
		},
	})
end

return hangar_scene
