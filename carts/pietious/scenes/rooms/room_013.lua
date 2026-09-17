-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_013' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'rock_013_01',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 208, y = 112, z = 140 },
				},
			},
			{
				member_id = 'rock_013_02',
				definition_id = 'rock',
				options = {
					space_id = 'main',
					pos = { x = 56, y = 56, z = 140 },
					item_type = 'ammofromrock',
				},
			},
			{
				member_id = 'enemy_013_01',
				definition_id = 'enemy.cloud',
				conditions = { { key = 'cloud_1_destroyed', equals = false } },
				retain_defeat_in_region = true,
				destroyed_condition = 'cloud_1_destroyed',
				options = {
					space_id = 'main',
					pos = { x = 128, y = 112, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
			{
				member_id = 'item_013_01',
				definition_id = 'world_item',
				conditions = { { key = 'cloud_1_destroyed', equals = true }, { key = 'greenvase', equals = false } },
				reveal_event = 'appearance',
				options = {
					space_id = 'main',
					pos = { x = 184, y = 56, z = 130 },
					item_type = 'greenvase',
				},
			},
		},
	})
end

return room_scene
