-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_108' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'lithograph_01',
				definition_id = 'lithograph',
				options = {
					id = 'lithograph_108_01',
					space_id = 'main',
					pos = { x = 200, y = 168, z = 10 },
					text = '',
				},
			},
			{
				member_id = 'enemy_01',
				definition_id = 'enemy.muziekfoe',
				conditions = {},
				options = {
					id = 'enemy_108_01',
					space_id = 'main',
					pos = { x = 16, y = 32, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
			{
				member_id = 'enemy_02',
				definition_id = 'enemy.muziekfoe',
				conditions = {},
				options = {
					id = 'enemy_108_02',
					space_id = 'main',
					pos = { x = 64, y = 152, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
			{
				member_id = 'enemy_03',
				definition_id = 'enemy.muziekfoe',
				conditions = {},
				options = {
					id = 'enemy_108_03',
					space_id = 'main',
					pos = { x = 200, y = 152, z = 140 },
					damage = 2,
					direction = 'left',
				},
			},
			{
				member_id = 'enemy_04',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					id = 'enemy_108_04',
					space_id = 'main',
					pos = { x = 112, y = 80, z = 140 },
					damage = 2,
					direction = 'up',
				},
			},
			{
				member_id = 'enemy_05',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					id = 'enemy_108_05',
					space_id = 'main',
					pos = { x = 136, y = 96, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
		},
	})
end

return room_scene
