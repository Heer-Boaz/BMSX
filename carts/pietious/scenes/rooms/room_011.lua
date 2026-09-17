-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_011' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'enemy_011_01',
				definition_id = 'enemy.crossfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 88, y = 96, z = 140 },
					damage = 2,
				},
			},
			{
				member_id = 'enemy_011_02',
				definition_id = 'enemy.crossfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 40, y = 128, z = 140 },
					damage = 2,
				},
			},
			{
				member_id = 'enemy_011_03',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 24, y = 56, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'enemy_011_04',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 64, y = 160, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'rock_011_01',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 64, y = 104, z = 140 },
					item_type = 'lamp',
				},
			},
			{
				member_id = 'rock_011_02',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 136, y = 64, z = 140 },
				},
			},
			{
				member_id = 'rock_011_03',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 104, y = 136, z = 140 },
				},
			},
		},
	})
end

return room_scene
