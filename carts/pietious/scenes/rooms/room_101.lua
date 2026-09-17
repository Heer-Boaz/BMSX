-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_101' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'item_01',
				definition_id = 'world_item',
				conditions = { { key = 'map_world1', equals = false } },
				options = {
					id = 'item_101_01',
					space_id = 'main',
					pos = { x = 32, y = 104, z = 130 },
					item_type = 'map_world1',
				},
			},
		},
	})
end

return room_scene
