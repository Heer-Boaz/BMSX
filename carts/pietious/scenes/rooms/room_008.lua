-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_008' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'enemy_008_01',
				definition_id = 'enemy.boekfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 8, y = 128, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
			{
				member_id = 'enemy_008_02',
				definition_id = 'enemy.crossfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 40, y = 160, z = 140 },
					damage = 2,
				},
			},
			{
				member_id = 'enemy_008_03',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 24, y = 72, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'enemy_008_04',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 64, y = 40, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
			{
				member_id = 'enemy_008_05',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 120, y = 128, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'world_entrance_008_01',
				definition_id = 'world_entrance',
				options = {
					space_id = 'main',
					pos = { x = 144, y = 64, z = 22 },
					target = 'world_1',
				},
			},
		},
	})
end

return room_scene
