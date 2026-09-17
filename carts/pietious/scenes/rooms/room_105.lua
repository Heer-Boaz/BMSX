-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_105' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'lithograph_105_01',
				definition_id = 'lithograph',
				options = {
					space_id = 'main',
					pos = { x = 32, y = 88, z = 10 },
					text = '',
				},
			},
			{
				member_id = 'enemy_105_01',
				definition_id = 'enemy.zakfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 88, y = 88, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
			{
				member_id = 'enemy_105_02',
				definition_id = 'enemy.zakfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 64, y = 152, z = 140 },
					damage = 2,
					direction = 'left',
				},
			},
		},
	})
end

return room_scene
