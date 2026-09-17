-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_104' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'enemy_01',
				definition_id = 'enemy.muziekfoe',
				conditions = {},
				options = {
					id = 'enemy_104_01',
					space_id = 'main',
					pos = { x = 192, y = 96, z = 140 },
					damage = 2,
					direction = 'left',
				},
			},
			{
				member_id = 'enemy_02',
				definition_id = 'enemy.stafffoe',
				conditions = { { key = 'staff1destroyed', equals = false } },
				retain_defeat_in_region = true,
				destroyed_condition = 'staff1destroyed',
				options = {
					id = 'enemy_104_02',
					space_id = 'main',
					pos = { x = 56, y = 42, z = 140 },
					damage = 2,
				},
			},
		},
	})
end

return room_scene
