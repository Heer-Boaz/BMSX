-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_004' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'enemy_004_01',
				definition_id = 'enemy.boekfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 216, y = 120, z = 140 },
					damage = 2,
					direction = 'left',
				},
			},
			{
				member_id = 'enemy_004_02',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 48, y = 48, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
			{
				member_id = 'enemy_004_03',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 152, y = 96, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'rock_004_01',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 48, y = 136, z = 140 },
					item_type = 'ammofromrock',
				},
			},
			{
				member_id = 'rock_004_02',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 136, y = 72, z = 140 },
				},
			},
			{
				member_id = 'shrine_004_01',
				definition_id = 'room_shrine',
				options = {
					space_id = 'main',
					pos = { x = 136, y = 72, z = 22 },
					text_lines = { 'ZONDER VERGROOTGLAS', 'KAN JE DE HEILIGE', 'ZAK NIET VINDEN...', 'DOORZOEK HET KASTEEL!' },
				},
			},
		},
	})
end

return room_scene
