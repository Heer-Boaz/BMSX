ids_stage_def = 'nemesis_s.stage'
ids_stage_instance = 'nemesis_s.stage'
ids_stage_fsm = 'nemesis_s.stage.fsm'
ids_stage_star_blink_timeline = 'nemesis_s.stage.timeline.star_blink'
ids_player_def = 'nemesis_s.player'
ids_player_instance = 'nemesis_s.player'
ids_player_fsm = 'nemesis_s.player.fsm'
ids_director_def = 'nemesis_s.director'
ids_director_instance = 'nemesis_s.director'
ids_director_fsm = 'nemesis_s.director.fsm'
machine_screen_width = 256
machine_screen_height = 192
machine_game_width = 256
machine_game_height = 176
player_width = 16
player_height = 10
player_start_x = 80
player_start_y = 60
player_base_movement_speed = 1
player_movement_speed_increase = 1
player_speed_powerups = 0
player_option_follow_delay = 10
player_max_projectiles = 2
player_fire_spawn_offset_x = 16
player_fire_spawn_offset_y = 5
player_hitcheck_x = { 4, 8, 14, 4, 8, 8 }

player_hitcheck_y = { 4, 4, 5, 7, 5, 7 }

loadout_speed_powerups = 1
loadout_option_count = 4
loadout_laser_level = 2
loadout_missile_level = 2
loadout_uplaser_level = 2
projectile_width = 6
projectile_height = 2
projectile_movement_speed = 6
weapons_laser = {
	tile_width = 8,
	tile_height = 2,
	movement_speed = 18,
	max_length_px = 240,
	max_active = 1,
	spawn_offset_x = 16,
	spawn_offset_y = 5,
}

weapons_missile_width = 8
weapons_missile_height_fall = 8
weapons_missile_height_floor = 4
weapons_missile_movement_speed = 4
weapons_missile_max_active = 1
weapons_missile_spawn_offset_x = 4
weapons_missile_spawn_offset_y = 0
weapons_uplaser = {
	tile_width = 8,
	tile_height = 2,
	length_unit_px = 8,
	movement_speed = 4,
	max_active = 1,
	level1_length_units = 2,
	level2_initial_length_units = 2,
	level2_gate_frames = 4,
	level2_growth_units_per_gate = 2,
	level2_growth_units_at_top = 1,
	level2_extra_rise_px = 8,
	spawn_offset_x = 0,
	spawn_offset_y = 8,
}

stage_asset_id = 'nemesis_s_stage'
stage_star_blink_gate_frames = 15
stage_star_particle_z = 8
assets_player_n = 'metallion_n'
assets_player_u = 'metallion_u'
assets_player_d = 'metallion_d'
assets_option1 = 'option1'
assets_option2 = 'option2'
assets_option3 = 'option3'
assets_option4 = 'option4'
assets_projectile = 'kogeltje'
assets_laser = 'laser'
assets_missile1 = 'missile1'
assets_missile2 = 'missile2'
assets_star_blue = 'star_blue'
assets_star_yellow = 'star_yellow'
assets_house_tile_1 = 'house_tile_1'
assets_house_tile_2 = 'house_tile_2'
assets_house_tile_3 = 'house_tile_3'
assets_house_tile_4 = 'house_tile_4'
assets_house_tile_5 = 'house_tile_5'
assets_house_tile_6 = 'house_tile_6'
assets_house_tile_7 = 'house_tile_7'
assets_house_tile_8 = 'house_tile_8'
assets_house_tile_9 = 'house_tile_9'
assets_house_tile_10 = 'house_tile_10'
assets_house_tile_11 = 'house_tile_11'
assets_house_tile_12 = 'house_tile_12'
assets_house_tile_13 = 'house_tile_13'
assets_house_tile_door = 'house_tile_door'
assets_house_tile_window = 'house_tile_window'
assets_house_tile_window2 = 'house_tile_window2'
assets_lantaarn_tile_1 = 'lantaarn_tile_1'
assets_lantaarn_tile_2 = 'lantaarn_tile_2'
assets_lantaarn_tile_3 = 'lantaarn_tile_3'
assets_ground = 'ground'
assets_ground2 = 'ground2'
assets_ground_v = 'ground_v'
assets_ground2_v = 'ground2_v'
assets_ground3 = 'ground3'
assets_ground4 = 'ground4'
assets_ground_start = 'ground_start'
assets_ground_end = 'ground_end'
assets_ground_start_v = 'ground_start_v'
assets_ground_end_v = 'ground_end_v'
assets_snow = 'snow'
assets_schoorsteen1 = 'schoorsteen1'
assets_schoorsteen2 = 'schoorsteen2'
assets_schoorsteen3 = 'schoorsteen3'
assets_snowtree1 = 'snowtree1'
assets_snowtree2 = 'snowtree2'
assets_snowtree3 = 'snowtree3'
assets_snowtree4 = 'snowtree4'
assets_snowtree5 = 'snowtree5'
assets_snowtree6 = 'snowtree6'
assets_snowtree7 = 'snowtree7'
assets_snowtree8 = 'snowtree8'
assets_snowtree9 = 'snowtree9'
assets_snowtree10 = 'snowtree10'
assets_snowtree11 = 'snowtree11'
assets_snowtree12 = 'snowtree12'
assets_snowtree13 = 'snowtree13'
assets_snowtree14 = 'snowtree14'
assets_snowtree15 = 'snowtree15'
assets_snowtree16 = 'snowtree16'
assets_snowtree17 = 'snowtree17'
assets_snowtree18 = 'snowtree18'
assets_snowtree19 = 'snowtree19'
assets_snowtree20 = 'snowtree20'
assets_snowtree21 = 'snowtree21'
stars_yellow = {
	{ x = 4, y = 10 },
	{ x = 92, y = 10 },
	{ x = 184, y = 10 },
	{ x = 196, y = 10 },
	{ x = 60, y = 43 },
	{ x = 236, y = 43 },
	{ x = 76, y = 58 },
	{ x = 220, y = 74 },
	{ x = 36, y = 75 },
	{ x = 140, y = 91 },
	{ x = 4, y = 10 },
	{ x = 172, y = 107 },
	{ x = 4, y = 10 },
	{ x = 99, y = 122 },
	{ x = 131, y = 138 },
	{ x = 155, y = 138 },
	{ x = 179, y = 154 },
}

stars_blue = {
	{ x = 44, y = 3 },
	{ x = 20, y = 35 },
	{ x = 124, y = 35 },
	{ x = 204, y = 35 },
	{ x = 108, y = 51 },
	{ x = 134, y = 67 },
	{ x = 252, y = 67 },
	{ x = 52, y = 99 },
	{ x = 116, y = 99 },
	{ x = 212, y = 99 },
	{ x = 243, y = 115 },
	{ x = 67, y = 132 },
	{ x = 187, y = 132 },
	{ x = 99, y = 122 },
	{ x = 27, y = 127 },
	{ x = 227, y = 127 },
}

telemetry_enabled = false
telemetry_metric_prefix = 'NEMESIS_S_METRIC'
telemetry_event_prefix = 'NEMESIS_S_EVENT'
