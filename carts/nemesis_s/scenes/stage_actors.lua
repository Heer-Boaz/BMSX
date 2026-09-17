-- Actor placement in level coordinates. Column is the authored scroll gate;
-- the stage admits these members as the camera reaches it. Formation IDs bind
-- only members of this instance, never a Registry singleton.
local scene_library<const> = require('cartlib/world/scene_library')
require('constants')

local stage_actors<const> = { id = 'nemesis_s.stage.actors' }

function stage_actors.register()
	scene_library.register(stage_actors.id, {
		objects = {
			{
				member_id = 'sint_pop_01',
				definition_id = ids_sint_pop_def,
				column = 34,
				formation_id = 'formation_34_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 280, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_02',
				definition_id = ids_sint_pop_def,
				column = 34,
				formation_id = 'formation_34_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 296, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_03',
				definition_id = ids_sint_pop_def,
				column = 34,
				formation_id = 'formation_34_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 312, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_04',
				definition_id = ids_sint_pop_def,
				column = 34,
				formation_id = 'formation_34_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 328, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_05',
				definition_id = ids_sint_pop_def,
				column = 34,
				formation_id = 'formation_34_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 344, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_06',
				definition_id = ids_sint_pop_def,
				column = 34,
				formation_id = 'formation_34_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 360, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_07',
				definition_id = ids_sint_pop_def,
				column = 50,
				formation_id = 'formation_50_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 408, y = 128, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_08',
				definition_id = ids_sint_pop_def,
				column = 50,
				formation_id = 'formation_50_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 424, y = 128, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_09',
				definition_id = ids_sint_pop_def,
				column = 50,
				formation_id = 'formation_50_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 440, y = 128, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_10',
				definition_id = ids_sint_pop_def,
				column = 50,
				formation_id = 'formation_50_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 456, y = 128, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_11',
				definition_id = ids_sint_pop_def,
				column = 50,
				formation_id = 'formation_50_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 472, y = 128, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_12',
				definition_id = ids_sint_pop_def,
				column = 50,
				formation_id = 'formation_50_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 488, y = 128, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_01',
				definition_id = ids_mijter_foe_def,
				column = 56,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 456, y = 40, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_13',
				definition_id = ids_sint_pop_def,
				column = 66,
				formation_id = 'formation_66_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 536, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_14',
				definition_id = ids_sint_pop_def,
				column = 66,
				formation_id = 'formation_66_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 552, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_15',
				definition_id = ids_sint_pop_def,
				column = 66,
				formation_id = 'formation_66_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 568, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_16',
				definition_id = ids_sint_pop_def,
				column = 66,
				formation_id = 'formation_66_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 584, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_17',
				definition_id = ids_sint_pop_def,
				column = 66,
				formation_id = 'formation_66_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 600, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_18',
				definition_id = ids_sint_pop_def,
				column = 66,
				formation_id = 'formation_66_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 616, y = 16, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_02',
				definition_id = ids_mijter_foe_def,
				column = 74,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 600, y = 40, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_03',
				definition_id = ids_mijter_foe_def,
				column = 74,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 600, y = 72, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_19',
				definition_id = ids_sint_pop_def,
				column = 82,
				formation_id = 'formation_82_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 664, y = 128, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_20',
				definition_id = ids_sint_pop_def,
				column = 82,
				formation_id = 'formation_82_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 680, y = 128, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_21',
				definition_id = ids_sint_pop_def,
				column = 82,
				formation_id = 'formation_82_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 696, y = 128, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_22',
				definition_id = ids_sint_pop_def,
				column = 82,
				formation_id = 'formation_82_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 712, y = 128, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_23',
				definition_id = ids_sint_pop_def,
				column = 82,
				formation_id = 'formation_82_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 728, y = 128, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_24',
				definition_id = ids_sint_pop_def,
				column = 82,
				formation_id = 'formation_82_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 744, y = 128, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_04',
				definition_id = ids_mijter_foe_def,
				column = 85,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 688, y = 56, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_05',
				definition_id = ids_mijter_foe_def,
				column = 92,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 744, y = 104, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_06',
				definition_id = ids_mijter_foe_def,
				column = 92,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 744, y = 152, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_25',
				definition_id = ids_sint_pop_def,
				column = 98,
				formation_id = 'formation_98_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 792, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_26',
				definition_id = ids_sint_pop_def,
				column = 98,
				formation_id = 'formation_98_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 808, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_27',
				definition_id = ids_sint_pop_def,
				column = 98,
				formation_id = 'formation_98_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 824, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_28',
				definition_id = ids_sint_pop_def,
				column = 98,
				formation_id = 'formation_98_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 840, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_29',
				definition_id = ids_sint_pop_def,
				column = 98,
				formation_id = 'formation_98_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 856, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_30',
				definition_id = ids_sint_pop_def,
				column = 98,
				formation_id = 'formation_98_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 872, y = 16, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_07',
				definition_id = ids_mijter_foe_def,
				column = 106,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 856, y = 48, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_08',
				definition_id = ids_mijter_foe_def,
				column = 106,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 856, y = 96, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_31',
				definition_id = ids_sint_pop_def,
				column = 114,
				formation_id = 'formation_114_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 920, y = 128, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_32',
				definition_id = ids_sint_pop_def,
				column = 114,
				formation_id = 'formation_114_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 936, y = 128, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_33',
				definition_id = ids_sint_pop_def,
				column = 114,
				formation_id = 'formation_114_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 952, y = 128, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_34',
				definition_id = ids_sint_pop_def,
				column = 114,
				formation_id = 'formation_114_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 968, y = 128, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_35',
				definition_id = ids_sint_pop_def,
				column = 114,
				formation_id = 'formation_114_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 984, y = 128, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_36',
				definition_id = ids_sint_pop_def,
				column = 114,
				formation_id = 'formation_114_16',
				options = {
					group_type = sint_pop_group_down,
					pos = { x = 1000, y = 128, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_09',
				definition_id = ids_mijter_foe_def,
				column = 116,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 936, y = 88, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_10',
				definition_id = ids_mijter_foe_def,
				column = 123,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 992, y = 56, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_11',
				definition_id = ids_mijter_foe_def,
				column = 123,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 992, y = 152, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_37',
				definition_id = ids_sint_pop_def,
				column = 130,
				formation_id = 'formation_130_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 1048, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_38',
				definition_id = ids_sint_pop_def,
				column = 130,
				formation_id = 'formation_130_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 1064, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_39',
				definition_id = ids_sint_pop_def,
				column = 130,
				formation_id = 'formation_130_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 1080, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_40',
				definition_id = ids_sint_pop_def,
				column = 130,
				formation_id = 'formation_130_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 1096, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_41',
				definition_id = ids_sint_pop_def,
				column = 130,
				formation_id = 'formation_130_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 1112, y = 16, z = 60 },
				},
			},
			{
				member_id = 'sint_pop_42',
				definition_id = ids_sint_pop_def,
				column = 130,
				formation_id = 'formation_130_2',
				options = {
					group_type = sint_pop_group_up,
					pos = { x = 1128, y = 16, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_12',
				definition_id = ids_mijter_foe_def,
				column = 138,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 1112, y = 24, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_13',
				definition_id = ids_mijter_foe_def,
				column = 138,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 1112, y = 88, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_01',
				definition_id = ids_zak_foe_def,
				column = 147,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 1176, y = 152, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_14',
				definition_id = ids_mijter_foe_def,
				column = 155,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 1248, y = 80, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_15',
				definition_id = ids_mijter_foe_def,
				column = 161,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 1296, y = 32, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_02',
				definition_id = ids_zak_foe_def,
				column = 166,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 1328, y = 112, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_16',
				definition_id = ids_mijter_foe_def,
				column = 168,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 1352, y = 72, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_03',
				definition_id = ids_zak_foe_def,
				column = 179,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 1432, y = 80, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_17',
				definition_id = ids_mijter_foe_def,
				column = 181,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 1456, y = 16, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_18',
				definition_id = ids_mijter_foe_def,
				column = 186,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 1496, y = 56, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_04',
				definition_id = ids_zak_foe_def,
				column = 188,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 1504, y = 152, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_05',
				definition_id = ids_zak_foe_def,
				column = 190,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 1520, y = 32, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_06',
				definition_id = ids_zak_foe_def,
				column = 191,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 1528, y = 152, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_07',
				definition_id = ids_zak_foe_def,
				column = 198,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 1584, y = 112, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_19',
				definition_id = ids_mijter_foe_def,
				column = 199,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 1600, y = 8, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_20',
				definition_id = ids_mijter_foe_def,
				column = 201,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 1616, y = 48, z = 60 },
				},
			},
			{
				member_id = 'rook_generator_01',
				definition_id = ids_rook_generator_def,
				column = 202,
				options = {
					pos = { x = 1608, y = 96, z = 50 },
				},
			},
			{
				member_id = 'zak_foe_08',
				definition_id = ids_zak_foe_def,
				column = 211,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 1688, y = 152, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_21',
				definition_id = ids_mijter_foe_def,
				column = 214,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 1720, y = 24, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_22',
				definition_id = ids_mijter_foe_def,
				column = 214,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 1720, y = 56, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_23',
				definition_id = ids_mijter_foe_def,
				column = 214,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 1720, y = 88, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_09',
				definition_id = ids_zak_foe_def,
				column = 215,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 1720, y = 152, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_24',
				definition_id = ids_mijter_foe_def,
				column = 224,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 1800, y = 32, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_10',
				definition_id = ids_zak_foe_def,
				column = 227,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 1816, y = 152, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_11',
				definition_id = ids_zak_foe_def,
				column = 233,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 1864, y = 152, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_25',
				definition_id = ids_mijter_foe_def,
				column = 237,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 1904, y = 56, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_12',
				definition_id = ids_zak_foe_def,
				column = 237,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 1896, y = 96, z = 60 },
				},
			},
			{
				member_id = 'schoorsteen_foe_01',
				definition_id = ids_schoorsteen_foe_def,
				column = 241,
				options = {
					pos = { x = 1925, y = 88, z = 50 },
				},
			},
			{
				member_id = 'zak_foe_13',
				definition_id = ids_zak_foe_def,
				column = 250,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 2000, y = 152, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_26',
				definition_id = ids_mijter_foe_def,
				column = 251,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 2016, y = 40, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_27',
				definition_id = ids_mijter_foe_def,
				column = 253,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 2032, y = 72, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_28',
				definition_id = ids_mijter_foe_def,
				column = 257,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 2064, y = 0, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_14',
				definition_id = ids_zak_foe_def,
				column = 259,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 2072, y = 112, z = 60 },
				},
			},
			{
				member_id = 'schoorsteen_foe_02',
				definition_id = ids_schoorsteen_foe_def,
				column = 262,
				options = {
					pos = { x = 2093, y = 112, z = 50 },
				},
			},
			{
				member_id = 'zak_foe_15',
				definition_id = ids_zak_foe_def,
				column = 268,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 2144, y = 0, z = 60 },
				},
			},
			{
				member_id = 'rook_generator_02',
				definition_id = ids_rook_generator_def,
				column = 272,
				options = {
					pos = { x = 2168, y = 112, z = 50 },
				},
			},
			{
				member_id = 'mijter_foe_29',
				definition_id = ids_mijter_foe_def,
				column = 274,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 2200, y = 48, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_16',
				definition_id = ids_zak_foe_def,
				column = 275,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 2200, y = 0, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_17',
				definition_id = ids_zak_foe_def,
				column = 275,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 2200, y = 112, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_18',
				definition_id = ids_zak_foe_def,
				column = 278,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 2224, y = 112, z = 60 },
				},
			},
			{
				member_id = 'schoorsteen_foe_03',
				definition_id = ids_schoorsteen_foe_def,
				column = 280,
				options = {
					pos = { x = 2237, y = 104, z = 50 },
				},
			},
			{
				member_id = 'zak_foe_19',
				definition_id = ids_zak_foe_def,
				column = 282,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 2256, y = 0, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_20',
				definition_id = ids_zak_foe_def,
				column = 288,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 2304, y = 0, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_30',
				definition_id = ids_mijter_foe_def,
				column = 288,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 2312, y = 72, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_21',
				definition_id = ids_zak_foe_def,
				column = 288,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 2304, y = 112, z = 60 },
				},
			},
			{
				member_id = 'rook_generator_03',
				definition_id = ids_rook_generator_def,
				column = 290,
				options = {
					pos = { x = 2312, y = 112, z = 50 },
				},
			},
			{
				member_id = 'mijter_foe_31',
				definition_id = ids_mijter_foe_def,
				column = 291,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 2336, y = 40, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_32',
				definition_id = ids_mijter_foe_def,
				column = 298,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 2392, y = 8, z = 60 },
				},
			},
			{
				member_id = 'sneeuwpop_01',
				definition_id = ids_sneeuwpop_def,
				column = 299,
				options = {
					pos = { x = 2392, y = 112, z = 50 },
				},
			},
			{
				member_id = 'mijter_foe_33',
				definition_id = ids_mijter_foe_def,
				column = 303,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 2432, y = 48, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_22',
				definition_id = ids_zak_foe_def,
				column = 304,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 2432, y = 152, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_34',
				definition_id = ids_mijter_foe_def,
				column = 309,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 2480, y = 40, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_35',
				definition_id = ids_mijter_foe_def,
				column = 310,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 2488, y = 0, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_23',
				definition_id = ids_zak_foe_def,
				column = 314,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 2512, y = 152, z = 60 },
				},
			},
			{
				member_id = 'schoorsteen_foe_04',
				definition_id = ids_schoorsteen_foe_def,
				column = 320,
				options = {
					pos = { x = 2557, y = 80, z = 50 },
				},
			},
			{
				member_id = 'rook_generator_04',
				definition_id = ids_rook_generator_def,
				column = 332,
				options = {
					pos = { x = 2648, y = 96, z = 50 },
				},
			},
			{
				member_id = 'schoorsteen_foe_05',
				definition_id = ids_schoorsteen_foe_def,
				column = 342,
				options = {
					pos = { x = 2733, y = 56, z = 50 },
				},
			},
			{
				member_id = 'schoorsteen_foe_06',
				definition_id = ids_schoorsteen_foe_def,
				column = 360,
				options = {
					pos = { x = 2877, y = 144, z = 50 },
				},
			},
			{
				member_id = 'zak_foe_24',
				definition_id = ids_zak_foe_def,
				column = 362,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 2896, y = 48, z = 60 },
				},
			},
			{
				member_id = 'schoorsteen_foe_07',
				definition_id = ids_schoorsteen_foe_def,
				column = 365,
				options = {
					pos = { x = 2917, y = 152, z = 50 },
				},
			},
			{
				member_id = 'rook_generator_05',
				definition_id = ids_rook_generator_def,
				column = 368,
				options = {
					pos = { x = 2936, y = 48, z = 50 },
				},
			},
			{
				member_id = 'schoorsteen_foe_08',
				definition_id = ids_schoorsteen_foe_def,
				column = 372,
				options = {
					pos = { x = 2973, y = 152, z = 50 },
				},
			},
			{
				member_id = 'rook_generator_06',
				definition_id = ids_rook_generator_def,
				column = 374,
				options = {
					pos = { x = 2984, y = 48, z = 50 },
				},
			},
			{
				member_id = 'schoorsteen_foe_09',
				definition_id = ids_schoorsteen_foe_def,
				column = 378,
				options = {
					pos = { x = 3021, y = 152, z = 50 },
				},
			},
			{
				member_id = 'rook_generator_07',
				definition_id = ids_rook_generator_def,
				column = 380,
				options = {
					pos = { x = 3032, y = 48, z = 50 },
				},
			},
			{
				member_id = 'schoorsteen_foe_10',
				definition_id = ids_schoorsteen_foe_def,
				column = 383,
				options = {
					pos = { x = 3061, y = 144, z = 50 },
				},
			},
			{
				member_id = 'zak_foe_25',
				definition_id = ids_zak_foe_def,
				column = 385,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 3080, y = 48, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_36',
				definition_id = ids_mijter_foe_def,
				column = 397,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 3184, y = 40, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_37',
				definition_id = ids_mijter_foe_def,
				column = 397,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 3184, y = 48, z = 60 },
				},
			},
			{
				member_id = 'sneeuwpop_02',
				definition_id = ids_sneeuwpop_def,
				column = 401,
				options = {
					pos = { x = 3208, y = 112, z = 50 },
				},
			},
			{
				member_id = 'zak_foe_26',
				definition_id = ids_zak_foe_def,
				column = 405,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 3240, y = 152, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_38',
				definition_id = ids_mijter_foe_def,
				column = 407,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 3264, y = 120, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_39',
				definition_id = ids_mijter_foe_def,
				column = 409,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 3280, y = 88, z = 60 },
				},
			},
			{
				member_id = 'sneeuwpop_03',
				definition_id = ids_sneeuwpop_def,
				column = 409,
				options = {
					pos = { x = 3272, y = 112, z = 50 },
				},
			},
			{
				member_id = 'mijter_foe_40',
				definition_id = ids_mijter_foe_def,
				column = 410,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 3288, y = 24, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_41',
				definition_id = ids_mijter_foe_def,
				column = 410,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 3288, y = 32, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_27',
				definition_id = ids_zak_foe_def,
				column = 417,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 3336, y = 152, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_42',
				definition_id = ids_mijter_foe_def,
				column = 418,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 3352, y = 32, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_43',
				definition_id = ids_mijter_foe_def,
				column = 419,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 3360, y = 24, z = 60 },
				},
			},
			{
				member_id = 'rook_generator_08',
				definition_id = ids_rook_generator_def,
				column = 424,
				options = {
					pos = { x = 3384, y = 80, z = 50 },
				},
			},
			{
				member_id = 'zak_foe_28',
				definition_id = ids_zak_foe_def,
				column = 428,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 3424, y = 80, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_29',
				definition_id = ids_zak_foe_def,
				column = 433,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 3464, y = 152, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_44',
				definition_id = ids_mijter_foe_def,
				column = 435,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 3488, y = 120, z = 60 },
				},
			},
			{
				member_id = 'sneeuwpop_04',
				definition_id = ids_sneeuwpop_def,
				column = 436,
				options = {
					pos = { x = 3488, y = 112, z = 50 },
				},
			},
			{
				member_id = 'mijter_foe_45',
				definition_id = ids_mijter_foe_def,
				column = 442,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 3544, y = 32, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_46',
				definition_id = ids_mijter_foe_def,
				column = 442,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 3544, y = 40, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_47',
				definition_id = ids_mijter_foe_def,
				column = 444,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 3560, y = 56, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_48',
				definition_id = ids_mijter_foe_def,
				column = 444,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 3560, y = 64, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_30',
				definition_id = ids_zak_foe_def,
				column = 446,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 3568, y = 96, z = 60 },
				},
			},
			{
				member_id = 'schoorsteen_foe_11',
				definition_id = ids_schoorsteen_foe_def,
				column = 451,
				options = {
					pos = { x = 3605, y = 104, z = 50 },
				},
			},
			{
				member_id = 'mijter_foe_49',
				definition_id = ids_mijter_foe_def,
				column = 459,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 3680, y = 48, z = 60 },
				},
			},
			{
				member_id = 'zak_foe_31',
				definition_id = ids_zak_foe_def,
				column = 459,
				options = {
					direction = zak_foe_direction_left,
					pos = { x = 3672, y = 96, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_50',
				definition_id = ids_mijter_foe_def,
				column = 460,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 3688, y = 80, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_51',
				definition_id = ids_mijter_foe_def,
				column = 461,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 3696, y = 72, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_52',
				definition_id = ids_mijter_foe_def,
				column = 462,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 3704, y = 24, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_53',
				definition_id = ids_mijter_foe_def,
				column = 462,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 3704, y = 32, z = 60 },
				},
			},
			{
				member_id = 'schoorsteen_foe_12',
				definition_id = ids_schoorsteen_foe_def,
				column = 465,
				options = {
					pos = { x = 3717, y = 152, z = 50 },
				},
			},
			{
				member_id = 'schoorsteen_foe_13',
				definition_id = ids_schoorsteen_foe_def,
				column = 469,
				options = {
					pos = { x = 3749, y = 152, z = 50 },
				},
			},
			{
				member_id = 'schoorsteen_foe_14',
				definition_id = ids_schoorsteen_foe_def,
				column = 473,
				options = {
					pos = { x = 3781, y = 152, z = 50 },
				},
			},
			{
				member_id = 'schoorsteen_foe_15',
				definition_id = ids_schoorsteen_foe_def,
				column = 477,
				options = {
					pos = { x = 3813, y = 152, z = 50 },
				},
			},
			{
				member_id = 'schoorsteen_foe_16',
				definition_id = ids_schoorsteen_foe_def,
				column = 481,
				options = {
					pos = { x = 3845, y = 152, z = 50 },
				},
			},
			{
				member_id = 'bel_01',
				definition_id = ids_bel_def,
				column = 484,
				options = {
					pos = { x = 3879, y = 96, z = 50 },
				},
			},
			{
				member_id = 'kerk_01',
				definition_id = ids_kerk_def,
				column = 484,
				options = {
					pos = { x = 3872, y = 16, z = 40 },
				},
			},
			{
				member_id = 'mijter_foe_54',
				definition_id = ids_mijter_foe_def,
				column = 492,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 3944, y = 24, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_55',
				definition_id = ids_mijter_foe_def,
				column = 492,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 3944, y = 32, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_56',
				definition_id = ids_mijter_foe_def,
				column = 492,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 3944, y = 40, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_57',
				definition_id = ids_mijter_foe_def,
				column = 495,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 3968, y = 96, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_58',
				definition_id = ids_mijter_foe_def,
				column = 503,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 4032, y = 48, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_59',
				definition_id = ids_mijter_foe_def,
				column = 504,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 4040, y = 32, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_60',
				definition_id = ids_mijter_foe_def,
				column = 504,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 4040, y = 40, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_61',
				definition_id = ids_mijter_foe_def,
				column = 506,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 4056, y = 96, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_62',
				definition_id = ids_mijter_foe_def,
				column = 510,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 4088, y = 72, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_63',
				definition_id = ids_mijter_foe_def,
				column = 515,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 4128, y = 32, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_64',
				definition_id = ids_mijter_foe_def,
				column = 515,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 4128, y = 48, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_65',
				definition_id = ids_mijter_foe_def,
				column = 515,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 4128, y = 64, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_66',
				definition_id = ids_mijter_foe_def,
				column = 520,
				options = {
					mijter_type = mijter_foe_type_blue,
					pos = { x = 4168, y = 72, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_67',
				definition_id = ids_mijter_foe_def,
				column = 521,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 4176, y = 48, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_68',
				definition_id = ids_mijter_foe_def,
				column = 521,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 4176, y = 64, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_69',
				definition_id = ids_mijter_foe_def,
				column = 521,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 4176, y = 80, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_70',
				definition_id = ids_mijter_foe_def,
				column = 527,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 4224, y = 48, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_71',
				definition_id = ids_mijter_foe_def,
				column = 527,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 4224, y = 64, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_72',
				definition_id = ids_mijter_foe_def,
				column = 527,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 4224, y = 80, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_73',
				definition_id = ids_mijter_foe_def,
				column = 533,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 4272, y = 16, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_74',
				definition_id = ids_mijter_foe_def,
				column = 533,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 4272, y = 32, z = 60 },
				},
			},
			{
				member_id = 'mijter_foe_75',
				definition_id = ids_mijter_foe_def,
				column = 533,
				options = {
					mijter_type = mijter_foe_type_red,
					pos = { x = 4272, y = 48, z = 60 },
				},
			},
			{
				member_id = 'moon_01',
				definition_id = ids_moon_def,
				column = 549,
				options = {
					pos = { x = 4424, y = 32, z = 50 },
				},
			},
		},
	})
end

return stage_actors
