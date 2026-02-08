local constants = {}

constants.ids = {
	player_def = 'pietious.player.def',
	player_instance = 'pietious.player.instance',
	player_fsm = 'pietious.player.fsm',
	director_def = 'pietious.director.def',
	director_instance = 'pietious.director.instance',
	director_fsm = 'pietious.director.fsm',
}

constants.room = {
	width = 320,
	height = 240,
}

constants.player = {
	width = 16,
	height = 16,
	start_x = 52,
	start_y = 150,
}

constants.physics = {
	walk_dx = 2,
	jump_dx = 2,
	fall_dx_neutral = 2,
	fall_dx_with_inertia = 3,
	fall_dx_against_inertia = 1,
	jump_release_cut_substate = 11,
	jump_to_fall_substate = 13,
	popolon_jump_dy_by_substate = {
		[0] = -7,
		[1] = -6,
		[2] = -6,
		[3] = -6,
		[4] = -5,
		[5] = -5,
		[6] = -5,
		[7] = -4,
		[8] = -4,
		[9] = -3,
		[10] = -2,
		[11] = -1,
	},
	controlled_fall_dy_by_substate = {
		[3] = 1,
		[4] = 2,
		[5] = 3,
		[6] = 4,
		[7] = 4,
		[8] = 5,
		[9] = 5,
		[10] = 5,
		[11] = 6,
	},
	uncontrolled_fall_dy_by_substate = {
		[0] = 1,
		[1] = 2,
		[2] = 3,
		[3] = 4,
		[4] = 4,
		[5] = 5,
		[6] = 5,
		[7] = 5,
		[8] = 6,
	},
}

constants.palette = {
	sky_top = { r = 0.08, g = 0.12, b = 0.2, a = 1 },
	sky_bottom = { r = 0.04, g = 0.06, b = 0.11, a = 1 },
	castle_wall = { r = 0.22, g = 0.24, b = 0.31, a = 1 },
	castle_wall_dark = { r = 0.14, g = 0.15, b = 0.2, a = 1 },
	stone = { r = 0.36, g = 0.37, b = 0.44, a = 1 },
	stone_top = { r = 0.5, g = 0.51, b = 0.58, a = 1 },
	window = { r = 0.79, g = 0.7, b = 0.35, a = 1 },
	player_body = { r = 0.89, g = 0.8, b = 0.58, a = 1 },
	player_tunic = { r = 0.3, g = 0.4, b = 0.84, a = 1 },
	player_air = { r = 0.88, g = 0.66, b = 0.36, a = 1 },
	player_outline = { r = 0.08, g = 0.09, b = 0.13, a = 1 },
	ui_banner = { r = 0.92, g = 0.92, b = 0.87, a = 0.92 },
	ui_text = { r = 0.05, g = 0.06, b = 0.08, a = 1 },
}

constants.ui = {
	help_line = 'ARROWS: MOVE | UP: JUMP | POPOLON CASTLE PHYSICS DEMO',
}

constants.telemetry = {
	enabled = true,
	metric_prefix = 'PIETIOUS_METRIC',
	event_prefix = 'PIETIOUS_EVENT',
}

return constants
