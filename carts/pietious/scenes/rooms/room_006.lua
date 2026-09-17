-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_006' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'enemy_01',
				definition_id = 'enemy.vlokspawner',
				conditions = { { key = 'cloud_1_destroyed', equals = false } },
				options = {
					id = 'enemy_006_01',
					space_id = 'main',
					pos = { x = 0, y = 32, z = 140 },
					damage = 2,
				},
			},
			{
				member_id = 'enemy_02',
				definition_id = 'enemy.crossfoe',
				conditions = {},
				options = {
					id = 'enemy_006_02',
					space_id = 'main',
					pos = { x = 24, y = 104, z = 140 },
					damage = 2,
				},
			},
			{
				member_id = 'enemy_03',
				definition_id = 'enemy.crossfoe',
				conditions = {},
				options = {
					id = 'enemy_006_03',
					space_id = 'main',
					pos = { x = 216, y = 104, z = 140 },
					damage = 2,
				},
			},
		},
	})
end

return room_scene
