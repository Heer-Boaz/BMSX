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

	-- DKC1 disassembly anchors (Yoshifanatic1/Donkey-Kong-Country-1-Disassembly)
	-- CODE_BFB538/CODE_BFB573 walk+run target speeds (DK on foot, no animal buddy)
	-- CODE_BFB159 + DATA_BFB255 smoothing profile table
	-- CODE_BFBD4F/CODE_BFBDA9/CODE_BFBDE7 roll entry/chaining
	-- CODE_BFB94F ground jump launch
	-- CODE_BFBA88 rope/bounce jump ($0700 direct Y speed)
	-- CODE_BFAF38 airborne gravity ($16F9 when bit $0002, else $FF90)
	-- CODE_BFB12B max fall clamp ($F800)
	-- CODE_BFB8E5/CODE_BFB8F7 jump buffer (12-frame window from $16A5)
	walk_target_subpx = 0x0200,           -- CODE_BFB598: DK on foot walk #$0200
	run_target_subpx = 0x0300,            -- CODE_BFB55D: DK on foot run #$0300
	roll_entry_min_subpx = 0x0100,        -- CODE_BFBD4F: base roll speed #$0100
	roll_entry_dpad_subpx = 0x0300,       -- CODE_BFBD4F: D-pad held → #$0300
	roll_entry_cap_subpx = 0x0400,        -- CODE_BFBD4F: quick direction change → #$0400
	roll_chain_step_subpx = 0x0100,       -- CODE_BFBDE7: +#$0100 per chain press
	roll_chain_cap_subpx = 0x0800,        -- CODE_BFBDE7: capped at #$0800
	roll_dash_window_frames = 0x0010,     -- CODE_BFBD4F: 16-frame window for direction boost
	jump_initial_subpx = 0x0700,          -- CODE_BFBA88: rope jump #$0700
	jump_ground_subpx = 0x0600,           -- CODE_BFB94F: ground jump (approximate)
	gravity_hold_subpx = -0x0048,         -- CODE_BFB94F/$16F9: DK #$FFB8 (−72 signed)
	gravity_hold_diddy_subpx = -0x005A,   -- CODE_BFB94F/$16F9: Diddy #$FFA6 (−90 signed)
	gravity_release_subpx = -0x0070,      -- CODE_BFAF4C: #$FF90 (−112 signed)
	max_fall_subpx = -0x0800,             -- CODE_BFB12B: #$F800 (−2048 signed)
	jump_buffer_frames = 0x000C,          -- CODE_BFB8F7: 12-frame window
	diddy_speed_mult_shift = 3,           -- CODE_BFB51E/CODE_BFBD90: ×1.125 (speed + speed>>3)
}

constants.profile = {
	-- CODE_BFB159 + DATA_BFB255 profile indices.
	-- DATA_BFB255 divisor table (cascading LSR chain at CODE_BFB273..CODE_BFB27A):
	--   0=÷8, 1=÷16, 2=÷32, 3=÷64, 4=÷128, 5=÷256, 6=÷4, 7=÷2, 8=÷32+÷64
	-- CODE_BFB159 selects profile based on state + grounded + running flag:
	--   state $04/$09 + grounded + running($0004) → 8  (CODE_BFB167)
	--   state $04/$09 + grounded + walking         → 3  (CODE_BFB180)
	--   everything else (airborne, roll, etc.)      → 0 (Fast/Sharp)
	ground_walk = 3,   -- ÷64: Heavy inertia (Authentic)
	ground_run = 8,    -- ÷21: Medium inertia (Authentic)
	default = 0,       -- ÷8:  Air control (Authentic)
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
