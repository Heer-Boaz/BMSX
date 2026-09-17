-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_005' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'enemy_01',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = {},
				options = {
					id = 'enemy_005_01',
					space_id = 'main',
					pos = { x = 80, y = 40, z = 140 },
					damage = 2,
					speed_x_num = 0,
					speed_y_num = 2,
				},
			},
			{
				member_id = 'enemy_02',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = {},
				options = {
					id = 'enemy_005_02',
					space_id = 'main',
					pos = { x = 112, y = 40, z = 140 },
					damage = 2,
					speed_x_num = 2,
					speed_y_num = 2,
				},
			},
			{
				member_id = 'enemy_03',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = {},
				options = {
					id = 'enemy_005_03',
					space_id = 'main',
					pos = { x = 24, y = 72, z = 140 },
					damage = 2,
					speed_x_num = 2,
					speed_y_num = 2,
				},
			},
			{
				member_id = 'enemy_04',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = {},
				options = {
					id = 'enemy_005_04',
					space_id = 'main',
					pos = { x = 80, y = 72, z = 140 },
					damage = 2,
					speed_x_num = -2,
					speed_y_num = 2,
				},
			},
			{
				member_id = 'enemy_05',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = {},
				options = {
					id = 'enemy_005_05',
					space_id = 'main',
					pos = { x = 120, y = 112, z = 140 },
					damage = 2,
					speed_x_num = -2,
					speed_y_num = -2,
				},
			},
			{
				member_id = 'enemy_06',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = {},
				options = {
					id = 'enemy_005_06',
					space_id = 'main',
					pos = { x = 24, y = 152, z = 140 },
					damage = 2,
					speed_x_num = 2,
					speed_y_num = -2,
				},
			},
		},
	})
end

return room_scene
