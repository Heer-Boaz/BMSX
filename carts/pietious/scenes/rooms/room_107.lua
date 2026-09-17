-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_107' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'enemy_01',
				definition_id = 'enemy.crossfoe',
				conditions = {},
				options = {
					id = 'enemy_107_01',
					space_id = 'main',
					pos = { x = 40, y = 48, z = 140 },
					damage = 2,
				},
			},
			{
				member_id = 'enemy_02',
				definition_id = 'enemy.crossfoe',
				conditions = {},
				options = {
					id = 'enemy_107_02',
					space_id = 'main',
					pos = { x = 80, y = 80, z = 140 },
					damage = 2,
				},
			},
			{
				member_id = 'enemy_03',
				definition_id = 'enemy.crossfoe',
				conditions = {},
				options = {
					id = 'enemy_107_03',
					space_id = 'main',
					pos = { x = 232, y = 80, z = 140 },
					damage = 2,
				},
			},
			{
				member_id = 'enemy_04',
				definition_id = 'enemy.crossfoe',
				conditions = {},
				options = {
					id = 'enemy_107_04',
					space_id = 'main',
					pos = { x = 8, y = 112, z = 140 },
					damage = 2,
				},
			},
			{
				member_id = 'enemy_05',
				definition_id = 'enemy.stafffoe',
				conditions = { { key = 'staff2destroyed', equals = false } },
				retain_defeat_in_region = true,
				destroyed_condition = 'staff2destroyed',
				options = {
					id = 'enemy_107_05',
					space_id = 'main',
					pos = { x = 120, y = 154, z = 140 },
					damage = 2,
				},
			},
			{
				member_id = 'draaideur_01',
				definition_id = 'draaideur',
				options = {
					id = 'draaideur_107_01',
					space_id = 'main',
					pos = { x = 120, y = 48, z = 22 },
					kind = 1,
				},
			},
		},
	})
end

return room_scene
