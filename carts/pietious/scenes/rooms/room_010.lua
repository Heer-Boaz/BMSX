-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_010' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'enemy_010_01',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 8, y = 88, z = 140 },
					damage = 2,
					speed_x_num = 2,
					speed_y_num = 2,
				},
			},
			{
				member_id = 'enemy_010_02',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 80, y = 112, z = 140 },
					damage = 2,
					speed_x_num = 2,
					speed_y_num = -2,
				},
			},
			{
				member_id = 'enemy_010_03',
				definition_id = 'enemy.crossfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 88, y = 32, z = 140 },
					damage = 2,
				},
			},
			{
				member_id = 'rock_010_01',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 192, y = 72, z = 140 },
				},
			},
			{
				member_id = 'rock_010_02',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 32, y = 40, z = 140 },
				},
			},
			{
				member_id = 'rock_010_03',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 112, y = 168, z = 140 },
					item_type = 'ammofromrock',
				},
			},
		},
	})
end

return room_scene
