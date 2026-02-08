local constants = {}

constants.ids = {
	player_def = 'pietious.player.def',
	player_instance = 'pietious.player.instance',
	player_fsm = 'pietious.player.fsm',
	director_def = 'pietious.director.def',
	director_instance = 'pietious.director.instance',
	director_fsm = 'pietious.director.fsm',
	ui_def = 'pietious.ui.def',
	ui_instance = 'pietious.ui.instance',
	ui_fsm = 'pietious.ui.fsm',
	castle_service_def = 'pietious.castle_service.def',
	castle_service_instance = 'pietious.castle_service.instance',
}

constants.room = {
	width = 256,
	height = 192,
	hud_height = 32,
	tile_size = 8,
	tile_columns = 32,
	tile_rows = 20,
	tile_origin_x = 0,
	tile_origin_y = 32,
}
constants.room.tile_origin_y = constants.room.hud_height

constants.player = {
	width = 16,
	height = 16,
	start_x = 0,
	start_y = 104,
	walk_anim_cycle_px = 8,
}

constants.sword = {
	start_frames = 1,
	recover_frames = 4,
}

constants.damage = {
	max_health = 48,
	enemy_contact_damage = 4,
	hit_invulnerability_frames = 32,
	hit_blink_switch_frames = 5,
	knockback_dx = 4,
	knockup_px = 2,
	hit_recovery_frames = 8,
	death_frames = 40,
}

constants.stairs = {
	speed_px = 1,
	anim_step_px = 4,
	foot_probe_offset_x = 4,
	foot_probe_offset_y = 14,
	below_probe_extra_y = 16,
	step_off_probe_extra_y = 5,
	step_off_right_probe_offset_x = 16,
	step_off_left_probe_offset_x = -1,
	step_off_right_x = 8,
	step_off_left_x = -9,
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
}

constants.hud = {
	health_level = 48,
	weapon_level = 24,
	health_bar_x = 24,
	health_bar_y = 10,
	weapon_bar_x = 24,
	weapon_bar_y = 18,
}

constants.telemetry = {
	enabled = true,
	metric_prefix = 'PIETIOUS_METRIC',
	event_prefix = 'PIETIOUS_EVENT',
}

return constants
