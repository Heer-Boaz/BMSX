-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_002' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'enemy_002_01',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 112, y = 56, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'enemy_002_02',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 160, y = 56, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'enemy_002_03',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 128, y = 168, z = 140 },
					damage = 2,
					direction = 'up',
				},
			},
			{
				member_id = 'rock_002_01',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 104, y = 136, z = 140 },
				},
			},
			{
				member_id = 'rock_002_02',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 144, y = 168, z = 140 },
					item_type = 'schoentjes',
				},
			},
		},
	})
end

return room_scene
