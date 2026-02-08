local constants = {}

local dkc_subpixels_per_pixel = 256
local dkc_frame_ms = 1000 / 60

local function px_ms_from_subpx_frame(subpixels_per_frame)
	return (subpixels_per_frame / dkc_subpixels_per_pixel) / dkc_frame_ms
end

constants.ids = {
	player_def = 'dk.player.def',
	player_instance = 'dk.player.instance',
	player_fsm = 'dk.player.fsm',
	director_def = 'dk.director.def',
	director_instance = 'dk.director.instance',
	director_fsm = 'dk.director.fsm',
}

constants.world = {
	width = 3072,
	height = 240,
}

constants.dkc_reference = {
	subpixels_per_pixel = dkc_subpixels_per_pixel,
	frame_ms = dkc_frame_ms,
	-- Measured community references for DKC1 roll speeds (Donkey):
	-- Rolling max 1024, +enemy chain up to 2048.
	roll_speed_no_enemy_subpx = 1024,
	roll_speed_enemy_chain_max_subpx = 2048,
	-- Inferred historical target for run speed used in old DKC docs/discussions.
	run_speed_subpx = 768,
}

constants.player = {
	width = 30,
	height = 34,
	start_x = 72,
	start_y = 166,
	walk_speed = px_ms_from_subpx_frame(640),
	run_speed = px_ms_from_subpx_frame(constants.dkc_reference.run_speed_subpx),
	roll_standing_speed = px_ms_from_subpx_frame(constants.dkc_reference.roll_speed_no_enemy_subpx),
	roll_running_speed = px_ms_from_subpx_frame(constants.dkc_reference.roll_speed_no_enemy_subpx),
	roll_jump_speed = px_ms_from_subpx_frame(1152),
	roll_min_maintained_speed = px_ms_from_subpx_frame(constants.dkc_reference.run_speed_subpx),
	roll_min_entry_speed = px_ms_from_subpx_frame(640),
	roll_run_entry_speed_threshold = px_ms_from_subpx_frame(704),
	ground_accel = 0.00085,
	ground_decel = 0.00115,
	air_accel = 0.00052,
	air_drag = 0.00022,
	gravity = 0.00162,
	jump_velocity = -0.46,
	max_fall_speed = 0.62,
	jump_cut_velocity = -0.22,
	jump_cut_multiplier = 0.48,
	coyote_ms = 66,
	jump_buffer_ms = 83,
	roll_duration_ms = 260,
	roll_decel = 0.00026,
	roll_exit_cooldown_ms = 120,
}

constants.camera = {
	follow_lerp = 0.011,
	forward_look = 72,
	deadzone = 18,
}

constants.palette = {
	sky = { r = 0.53, g = 0.82, b = 0.98, a = 1 },
	far = { r = 0.33, g = 0.59, b = 0.42, a = 1 },
	mid = { r = 0.23, g = 0.44, b = 0.29, a = 1 },
	ground = { r = 0.42, g = 0.27, b = 0.16, a = 1 },
	ground_top = { r = 0.52, g = 0.39, b = 0.23, a = 1 },
	goal = { r = 0.98, g = 0.92, b = 0.24, a = 1 },
	goal_pole = { r = 0.85, g = 0.78, b = 0.2, a = 1 },
	player_body = { r = 0.43, g = 0.22, b = 0.11, a = 1 },
	player_face = { r = 0.88, g = 0.73, b = 0.54, a = 1 },
	player_shadow = { r = 0, g = 0, b = 0, a = 0.34 },
	ui_text = { r = 0.05, g = 0.08, b = 0.12, a = 1 },
	ui_banner = { r = 0.99, g = 0.96, b = 0.84, a = 0.92 },
}

constants.ui = {
	help_line = 'ARROWS = MOVE | Z/X = JUMP | A/S = RUN+ROLL',
	clear_line = 'LEVEL CLEAR',
}

constants.telemetry = {
	enabled = true,
	metric_prefix = 'ESTHER_METRIC',
	event_prefix = 'ESTHER_EVENT',
}

return constants
