-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_009' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'enemy_009_01',
				definition_id = 'enemy.boekfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 24, y = 56, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
			{
				member_id = 'enemy_009_02',
				definition_id = 'enemy.boekfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 184, y = 104, z = 140 },
					damage = 2,
					direction = 'left',
				},
			},
			{
				member_id = 'rock_009_01',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 160, y = 112, z = 140 },
					item_type = 'spyglass',
				},
			},
		},
	})
end

return room_scene
