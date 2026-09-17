-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_109' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'enemy_01',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					id = 'enemy_109_01',
					space_id = 'main',
					pos = { x = 48, y = 80, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'enemy_02',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					id = 'enemy_109_02',
					space_id = 'main',
					pos = { x = 208, y = 80, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'enemy_03',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					id = 'enemy_109_03',
					space_id = 'main',
					pos = { x = 176, y = 136, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
		},
	})
end

return room_scene
