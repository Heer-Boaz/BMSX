-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_110' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {
			{
				member_id = 'shrine_110_01',
				definition_id = 'room_shrine',
				options = {
					space_id = 'main',
					pos = { x = 216, y = 48, z = 22 },
					text_lines = { 'VERNIETIG ALLE', 'MARSPEINEN', 'AARDAPPELTJES.' },
				},
			},
			{
				member_id = 'enemy_110_01',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 144, y = 72, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'enemy_110_02',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 112, y = 104, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'enemy_110_03',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 144, y = 136, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'enemy_110_04',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 56, y = 72, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'enemy_110_05',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 232, y = 72, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'enemy_110_06',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 232, y = 104, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'enemy_110_07',
				definition_id = 'enemy.mijterfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 200, y = 136, z = 140 },
					damage = 2,
					direction = 'down',
				},
			},
			{
				member_id = 'enemy_110_08',
				definition_id = 'enemy.zakfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 112, y = 48, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
			{
				member_id = 'enemy_110_09',
				definition_id = 'enemy.zakfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 216, y = 48, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
			{
				member_id = 'enemy_110_10',
				definition_id = 'enemy.zakfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 216, y = 80, z = 140 },
					damage = 2,
					direction = 'left',
				},
			},
			{
				member_id = 'enemy_110_11',
				definition_id = 'enemy.zakfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 232, y = 112, z = 140 },
					damage = 2,
					direction = 'left',
				},
			},
			{
				member_id = 'enemy_110_12',
				definition_id = 'enemy.zakfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 112, y = 112, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
			{
				member_id = 'enemy_110_13',
				definition_id = 'enemy.zakfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 8, y = 112, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
			{
				member_id = 'enemy_110_14',
				definition_id = 'enemy.zakfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 128, y = 80, z = 140 },
					damage = 2,
					direction = 'left',
				},
			},
			{
				member_id = 'enemy_110_15',
				definition_id = 'enemy.zakfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 232, y = 144, z = 140 },
					damage = 2,
					direction = 'left',
				},
			},
			{
				member_id = 'enemy_110_16',
				definition_id = 'enemy.zakfoe',
				conditions = {},
				options = {
					space_id = 'main',
					pos = { x = 96, y = 144, z = 140 },
					damage = 2,
					direction = 'right',
				},
			},
			{
				member_id = 'enemy_110_17',
				definition_id = 'enemy.stafffoe',
				conditions = { { key = 'staff3destroyed', equals = false } },
				retain_defeat_in_region = true,
				destroyed_condition = 'staff3destroyed',
				options = {
					space_id = 'main',
					pos = { x = 120, y = 34, z = 140 },
					damage = 2,
				},
			},
		},
	})
end

return room_scene
