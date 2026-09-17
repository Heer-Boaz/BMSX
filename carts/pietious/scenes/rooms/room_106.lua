-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_106' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'enemy_01',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = { { key = 'r106.wall', equals = false } },
				retain_defeat_in_region = true,
				options = {
					id = 'enemy_106_01',
					space_id = 'main',
					pos = { x = 16, y = 72, z = 140 },
					damage = 2,
					speed_x_num = 2,
					speed_y_num = 2,
				},
			},
			{
				member_id = 'enemy_02',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = { { key = 'r106.wall', equals = false } },
				retain_defeat_in_region = true,
				options = {
					id = 'enemy_106_02',
					space_id = 'main',
					pos = { x = 80, y = 152, z = 140 },
					damage = 2,
					speed_x_num = -2,
					speed_y_num = 2,
				},
			},
			{
				member_id = 'enemy_03',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = { { key = 'r106.wall', equals = false } },
				retain_defeat_in_region = true,
				options = {
					id = 'enemy_106_03',
					space_id = 'main',
					pos = { x = 160, y = 128, z = 140 },
					damage = 2,
					speed_x_num = 2,
					speed_y_num = -2,
				},
			},
			{
				member_id = 'enemy_04',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = { { key = 'r106.wall', equals = false } },
				retain_defeat_in_region = true,
				options = {
					id = 'enemy_106_04',
					space_id = 'main',
					pos = { x = 48, y = 112, z = 140 },
					damage = 2,
					speed_x_num = -2,
					speed_y_num = -2,
				},
			},
			{
				member_id = 'enemy_05',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = { { key = 'r106.wall', equals = false } },
				retain_defeat_in_region = true,
				options = {
					id = 'enemy_106_05',
					space_id = 'main',
					pos = { x = 104, y = 136, z = 140 },
					damage = 2,
					speed_x_num = -2,
					speed_y_num = 2,
				},
			},
			{
				member_id = 'enemy_06',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = { { key = 'r106.wall', equals = false } },
				retain_defeat_in_region = true,
				options = {
					id = 'enemy_106_06',
					space_id = 'main',
					pos = { x = 144, y = 96, z = 140 },
					damage = 2,
					speed_x_num = -2,
					speed_y_num = -2,
				},
			},
			{
				member_id = 'enemy_07',
				definition_id = 'enemy.marspeinenaardappel',
				conditions = { { key = 'r106.wall', equals = false } },
				retain_defeat_in_region = true,
				options = {
					id = 'enemy_106_07',
					space_id = 'main',
					pos = { x = 200, y = 88, z = 140 },
					damage = 2,
					speed_x_num = 2,
					speed_y_num = -2,
				},
			},
			{
				member_id = 'enemy_08',
				definition_id = 'enemy.disappearingwall',
				conditions = { { key = 'r106.wall', equals = false } },
				blocks_room_collision = true,
				options = {
					id = 'enemy_106_08',
					space_id = 'main',
					pos = { x = 80, y = 40, z = 140 },
					damage = 0,
					width_tiles = 5,
					height_tiles = 3,
					tiletype = 'frontworld_l',
				},
			},
			{
				member_id = 'lithograph_01',
				definition_id = 'lithograph',
				options = {
					id = 'lithograph_106_01',
					space_id = 'main',
					pos = { x = 80, y = 48, z = 10 },
					text = 'EYNDBAES',
				},
			},
		},
	})
end

return room_scene
