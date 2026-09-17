-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_103' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'shrine_103_01',
				definition_id = 'room_shrine',
				options = {
					space_id = 'main',
					pos = { x = 72, y = 64, z = 22 },
					text_lines = { 'VERNEDER DE DRIE', 'STAFFEN VAN', 'SINTERKLAAS OM BIJ', 'DE ZAK TE KOMEN.' },
				},
			},
			{
				member_id = 'enemy_103_01',
				definition_id = 'enemy.crossfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 120, y = 56, z = 140 },
					damage = 2,
				},
			},
			{
				member_id = 'enemy_103_02',
				definition_id = 'enemy.crossfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 232, y = 112, z = 140 },
					damage = 2,
				},
			},
			{
				member_id = 'enemy_103_03',
				definition_id = 'enemy.crossfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 16, y = 112, z = 140 },
					damage = 2,
				},
			},
		},
	})
end

return room_scene
