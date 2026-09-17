-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_003' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'enemy_003_01',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 144, y = 136, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'enemy_003_02',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 216, y = 64, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'rock_003_01',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 224, y = 40, z = 140 },
					item_type = 'pepernoot',
				},
			},
			{
				member_id = 'rock_003_02',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 104, y = 168, z = 140 },
				},
			},
			{
				member_id = 'rock_003_03',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 80, y = 40, z = 140 },
				},
			},
		},
	})
end

return room_scene
