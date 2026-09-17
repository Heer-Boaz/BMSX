-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_102' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'lithograph_01',
				definition_id = 'lithograph',
				options = {
					id = 'lithograph_102_01',
					space_id = 'main',
					pos = { x = 16, y = 72, z = 10 },
					text = '',
				},
			},
			{
				member_id = 'enemy_01',
				definition_id = 'enemy.zakfoe',
				conditions = {},
				options = {
					id = 'enemy_102_01',
					space_id = 'main',
					pos = { x = 16, y = 120, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
			{
				member_id = 'enemy_02',
				definition_id = 'enemy.zakfoe',
				conditions = {},
				options = {
					id = 'enemy_102_02',
					space_id = 'main',
					pos = { x = 136, y = 120, z = 140 },
					damage = 2,
					direction = 'left',
				},
			},
			{
				member_id = 'enemy_03',
				definition_id = 'enemy.zakfoe',
				conditions = {},
				options = {
					id = 'enemy_102_03',
					space_id = 'main',
					pos = { x = 32, y = 72, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
		},
	})
end

return room_scene
