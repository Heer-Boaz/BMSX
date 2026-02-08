local constants = {}

constants.ids = {
	player_def = 'dkc.player.def',
	player_instance = 'dkc.player.instance',
	player_fsm = 'dkc.player.fsm',
	director_def = 'dkc.director.def',
	director_instance = 'dkc.director.instance',
	director_fsm = 'dkc.director.fsm',
}

constants.dkc_reference = {
	subpixels_per_pixel = 256,
	frame_ms = 1000 / 60,

	-- DKC1 disassembly anchors (repo: Yoshifanatic1/Donkey-Kong-Country-1-Disassembly, commit c2080f40469c716923f550706509a0d354229841)
	-- Routine_Macros_DKC1.asm
	--   CODE_BFB538 / CODE_BFB573: walk/run target ground speeds
	--   CODE_BFB159 + DATA_BFB255: horizontal speed smoothing profiles
	--   CODE_BFBD4F / CODE_BFBDA9 / CODE_BFBDE7: roll entry + chain roll speed growth
	--   CODE_BFBA88: jump launch value used for player jump state transitions
	--   CODE_BFAF38: per-frame vertical acceleration while airborne
	--   CODE_BFB12B: fall clamp path
	walk_target_subpx = 0x0200,
	run_target_subpx = 0x0300,
	roll_entry_min_subpx = 0x0100,
	roll_entry_bonus_subpx = 0x0100,
	roll_entry_cap_subpx = 0x0400,
	roll_chain_step_subpx = 0x0100,
	roll_chain_cap_subpx = 0x0800,
	jump_initial_subpx = 0x0700,
	jump_gravity_hold_subpx = -0x0048,
	jump_gravity_release_subpx = -0x0070,
	max_fall_subpx = -0x0800,
}

constants.physics = {
	roll_floor_subpx = constants.dkc_reference.walk_target_subpx,
	roll_timer_frames = 22,
	roll_chain_window_frames = 14,

	-- DATA_BFB255 profile ids.
	-- 0=/8, 1=/16, 2=/32, 3=/64, 4=/128, 5=/256, 6=/4, 7=/2, 8=(/32 + /64).
	profile_ground_walk = 3,
	profile_ground_run = 8,
	profile_ground_release = 2,
	profile_ground_turn = 1,
	profile_air = 4,
	profile_roll_release = 1,
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
	movement_epsilon_subpx = 96,
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
	follow_lerp = 0.16,
	forward_look_px = 44,
	deadzone_px = 18,
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
	goal_pole = { r = 0.8, g = 0.73, b = 0.18, a = 1 },
	exit_cave = { r = 0.14, g = 0.09, b = 0.05, a = 1 },
	exit_cave_inner = { r = 0.03, g = 0.02, b = 0.01, a = 1 },
	exit_barrel = { r = 0.44, g = 0.27, b = 0.13, a = 1 },
	player_body = { r = 0.47, g = 0.24, b = 0.1, a = 1 },
	player_face = { r = 0.88, g = 0.74, b = 0.56, a = 1 },
	player_shadow = { r = 0, g = 0, b = 0, a = 0.28 },
	ui_bg = { r = 0.97, g = 0.94, b = 0.86, a = 0.88 },
	ui_fg = { r = 0.12, g = 0.11, b = 0.08, a = 1 },
}

constants.ui = {
	help = 'DKC BASELINE | ARROWS MOVE | S RUN/ROLL | X JUMP',
	clear = 'EXIT BARREL REACHED',
}

constants.telemetry = {
	enabled = true,
	metric_prefix = 'ESTHER_METRIC',
	event_prefix = 'ESTHER_EVENT',
}

return constants
