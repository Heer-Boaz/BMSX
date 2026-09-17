-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_012' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'enemy_012_01',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 88, y = 80, z = 140 },
					damage = 2,
					speed_x_num = 2,
					speed_y_num = 0,
				},
			},
			{
				member_id = 'enemy_012_02',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 104, y = 88, z = 140 },
					damage = 2,
					speed_x_num = -2,
					speed_y_num = 0,
				},
			},
			{
				member_id = 'enemy_012_03',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 72, y = 112, z = 140 },
					damage = 2,
					speed_x_num = -2,
					speed_y_num = 0,
				},
			},
			{
				member_id = 'enemy_012_04',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 88, y = 120, z = 140 },
					damage = 2,
					speed_x_num = 2,
					speed_y_num = 0,
				},
			},
			{
				member_id = 'enemy_012_05',
				definition_id = 'enemy.boekfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 72, y = 40, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
			{
				member_id = 'rock_012_01',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 168, y = 48, z = 140 },
					item_type = 'keyworld1',
				},
			},
		},
	})
end

return room_scene
