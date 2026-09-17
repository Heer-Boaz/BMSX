-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_007' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'shrine_007_01',
				definition_id = 'room_shrine',
				options = {
					space_id = 'main',
					pos = { x = 112, y = 80, z = 22 },
					text_lines = { 'VIND DE PEPERNOTEN', 'IN DIT KASTEEL...', 'EEN PIET KAN NIET', 'ZONDER ZIJN OF HAAR', 'PEPERNOTEN!' },
				},
			},
			{
				member_id = 'rock_007_01',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 200, y = 80, z = 140 },
				},
			},
			{
				member_id = 'rock_007_02',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 216, y = 80, z = 140 },
					item_type = 'halo',
				},
			},
			{
				member_id = 'enemy_007_01',
				definition_id = 'enemy.breakablewall',
				conditions = { { key = 'castlewalldestroyed', equals = false } },
				destroyed_condition = 'castlewalldestroyed',
				blocks_room_collision = true,
				options = {
					space_id = 'main',
					pos = { x = 80, y = 72, z = 140 },
					damage = 0,
					health = 20,
					max_health = 20,
					width_tiles = 8,
					height_tiles = 3,
					tiletype = 'castle_front_blue_1',
				},
			},
			{
				member_id = 'enemy_007_02',
				definition_id = 'enemy.crossfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 40, y = 72, z = 140 },
					damage = 2,
				},
			},
			{
				member_id = 'enemy_007_03',
				definition_id = 'enemy.crossfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 40, y = 104, z = 140 },
					damage = 2,
				},
			},
			{
				member_id = 'enemy_007_04',
				definition_id = 'enemy.crossfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 208, y = 104, z = 140 },
					damage = 2,
				},
			},
		},
	})
end

return room_scene
