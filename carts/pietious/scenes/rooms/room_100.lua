-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_100' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'seal_01',
				definition_id = 'seal',
				conditions = {},
				options = {
					id = 'seal_100_01',
					space_id = 'main',
					pos = { x = 96, y = 80, z = 23 },
					command = 'eyndbaes',
				},
			},
			{
				member_id = 'enemy_01',
				definition_id = 'enemy.daemon',
				conditions = {},
				options = {
					id = 'enemy_100_01',
					space_id = 'main',
					pos = { x = 0, y = 32, z = 140 },
					damage = 12,
					health = 60,
					max_health = 60,
				},
			},
		},
	})
end

return room_scene
