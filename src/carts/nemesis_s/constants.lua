local constants = {}

constants.ids = {
	player_def = 'nemesis_s.player.def',
	player_instance = 'nemesis_s.player.instance',
	player_fsm = 'nemesis_s.player.fsm',
	director_def = 'nemesis_s.director.def',
	director_instance = 'nemesis_s.director.instance',
	director_fsm = 'nemesis_s.director.fsm',
}

constants.machine = {
	frame_interval_ms = 20,
	screen_width = 256,
	screen_height = 192,
	game_width = 256,
	game_height = 176,
}

constants.player = {
	width = 16,
	height = 10,
	start_x = 80,
	start_y = 60,
	base_movement_speed = 1,
	movement_speed_increase = 0.5,
	speed_powerups = 0,
	max_projectiles = 2,
	fire_spawn_offset_x = 16,
	fire_spawn_offset_y = 5,
	hitcheck_x = { 4, 8, 14, 4, 8, 8 },
	hitcheck_y = { 4, 4, 5, 7, 5, 7 },
}

constants.projectile = {
	width = 6,
	height = 2,
	movement_speed = 6,
}

constants.stage = {
	asset_id = 'nemesis_s_stage',
	tile_size = 8,
	tile_columns = 32,
	draw_z = 16,
	star_blink_interval_ms = 50,
	scroll_mode_pause = 1,
	scroll_mode_forced = 2,
	scroll_mode_gated = 3,
	scroll_mode_default = 3,
	scroll_rotator_initial = 1,
}

constants.assets = {
	player_n = 'metallion_n',
	player_u = 'metallion_u',
	player_d = 'metallion_d',
	projectile = 'kogeltje',
	star_blue = 'star_blue',
	star_yellow = 'star_yellow',
	ground = 'ground',
	ground2 = 'ground2',
	ground_v = 'ground_v',
	ground2_v = 'ground2_v',
	ground3 = 'ground3',
	ground4 = 'ground4',
	ground_start = 'ground_start',
	ground_end = 'ground_end',
	ground_start_v = 'ground_start_v',
	ground_end_v = 'ground_end_v',
	snow = 'snow',
}

constants.stars = {
	yellow = {
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
	},
	blue = {
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
	},
}

constants.telemetry = {
	enabled = true,
	metric_prefix = 'NEMESIS_S_METRIC',
	event_prefix = 'NEMESIS_S_EVENT',
}

return constants
