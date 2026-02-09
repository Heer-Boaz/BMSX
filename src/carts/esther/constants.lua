local constants = {}

constants.ids = {
	player_def = 'dkc.player.def',
	player_instance = 'dkc.player.instance',
	player_fsm = 'dkc.player.fsm',
	director_def = 'dkc.director.def',
	director_instance = 'dkc.director.instance',
	director_fsm = 'dkc.director.fsm',
}

constants.dkc = {
	subpixels_per_px = 0x0100,
	frame_ms = 1000 / 60,

	-- DKC1 disassembly anchors
	-- CODE_BFB538/CODE_BFB573 walk+run target speeds
	-- CODE_BFB159 + DATA_BFB255 smoothing profile table
	-- CODE_BFBD4F/CODE_BFBDA9/CODE_BFBDE7 roll entry/chaining
	-- CODE_BFB94F ground jump launch
	-- CODE_BFAF38 airborne gravity
	-- CODE_BFB12B max fall clamp
	walk_target_subpx = 0x0200,
	run_target_subpx = 0x0300,
	roll_entry_min_subpx = 0x0100,
	roll_entry_bonus_subpx = 0x0100,
	roll_entry_cap_subpx = 0x0400,
	roll_chain_step_subpx = 0x0100,
	roll_chain_cap_subpx = 0x0800,
	roll_dash_window_frames = 0x0010,
	jump_initial_subpx = 0x0700,
	gravity_hold_subpx = -0x0048, -- #$FFB8
	gravity_release_subpx = -0x0070, -- #$FF90
	max_fall_subpx = -0x0800, -- #$F800
	jump_buffer_frames = 0x000C,
}

constants.profile = {
	ground_walk = 3,
	ground_run = 8,
	ground_release = 2,
	ground_turn = 1,
	air = 4,
	roll_release = 1,
}

constants.roll = {
	timer_frames = 22,
	chain_window_frames = 14,
	floor_subpx = constants.dkc.walk_target_subpx,
}

constants.barrel = {
	width = 18,
	height = 18,
	pickup_probe_px = 10,
	carry_offset_forward_px = 4,
	carry_offset_up_px = 18,
	throw_spawn_forward_px = 8,
	throw_spawn_up_px = 8,
	throw_ground_speed_subpx = 0x0600,
	throw_ground_up_subpx = 0x0180,
	throw_air_speed_subpx = 0x0580,
	throw_air_up_subpx = 0x0100,
	gravity_subpx = -0x0060,
	max_fall_subpx = -0x0800,
	ground_roll_subpx = 0x0500,
	regrab_lock_frames = 12,
	trace_frames = 28,
}

constants.world = {
	width = 4096,
	height = 240,
}

constants.player = {
	width = 26,
	height = 34,
	start_x = 96,
	start_y = 158,
}

constants.animation = {
	move_epsilon_subpx = 96,
	run_threshold_subpx = 704,
	idle = {
		frame_ms = 120,
		frames = {
			'esther_dk_idle_01',
			'esther_dk_idle_02',
			'esther_dk_idle_03',
			'esther_dk_idle_02',
		},
	},
	walk = {
		distance_step_subpx = 224,
		frames = {
			'esther_dk_walk_01',
			'esther_dk_walk_02',
			'esther_dk_walk_03',
			'esther_dk_walk_04',
		},
	},
	run = {
		distance_step_subpx = 192,
		frames = {
			'esther_dk_run_01',
			'esther_dk_run_02',
			'esther_dk_run_03',
			'esther_dk_run_04',
		},
	},
	roll = {
		distance_step_subpx = 240,
		frames = {
			'esther_dk_roll_01',
			'esther_dk_roll_02',
			'esther_dk_roll_03',
			'esther_dk_roll_04',
			'esther_dk_roll_05',
			'esther_dk_roll_06',
		},
	},
	air = {
		rise_frame = 'esther_dk_jump',
		fall_frame = 'esther_dk_jump',
	},
}

constants.camera = {
	forward_look_px = 44,
	deadzone_px = 18,
	follow_step_px = 7,
	snap_px = 2,
}

constants.palette = {
	sky_1 = { r = 0.58, g = 0.8, b = 0.52, a = 1 },
	sky_2 = { r = 0.82, g = 0.9, b = 0.72, a = 1 },
	canopy_far = { r = 0.18, g = 0.38, b = 0.18, a = 1 },
	canopy_mid = { r = 0.16, g = 0.31, b = 0.15, a = 1 },
	trunk = { r = 0.34, g = 0.2, b = 0.12, a = 1 },
	ground = { r = 0.46, g = 0.29, b = 0.14, a = 1 },
	ground_top = { r = 0.58, g = 0.43, b = 0.2, a = 1 },
	goal = { r = 0.94, g = 0.85, b = 0.2, a = 1 },
	exit_cave = { r = 0.14, g = 0.09, b = 0.05, a = 1 },
	exit_cave_inner = { r = 0.03, g = 0.02, b = 0.01, a = 1 },
	exit_barrel = { r = 0.44, g = 0.27, b = 0.13, a = 1 },
	barrel_body = { r = 0.52, g = 0.32, b = 0.17, a = 1 },
	barrel_band = { r = 0.23, g = 0.14, b = 0.08, a = 1 },
	barrel_inner = { r = 0.67, g = 0.45, b = 0.24, a = 1 },
	barrel_shadow = { r = 0, g = 0, b = 0, a = 0.24 },
	player_shadow = { r = 0, g = 0, b = 0, a = 0.28 },
	ui_bg = { r = 0.97, g = 0.94, b = 0.86, a = 0.88 },
	ui_fg = { r = 0.12, g = 0.11, b = 0.08, a = 1 },
}

constants.ui = {
	help = 'DKC BASELINE | ARROWS MOVE | Y(S) RUN/ROLL/HOLD CARRY | Y RELEASE THROW | B(X) JUMP',
	clear = 'EXIT BARREL REACHED',
}

constants.telemetry = {
	enabled = true,
	metric_prefix = 'ESTHER_METRIC',
	event_prefix = 'ESTHER_EVENT',
	camera_prefix = 'ESTHER_CAMERA',
}

return constants
