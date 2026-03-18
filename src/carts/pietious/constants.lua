local constants = {}

constants.flow = {
	room_transition_frames = 8,
	-- C++ drives GameCycle() from main.cpp/render.cpp at REDRAWING_PERIOD = 40 ms.
	-- The Lua cart runs at 20 ms ticks, so these banner waits need the 2x scale.
	banner_prewait_frames = 32,
	world_banner_frames = 62,
	castle_banner_frames = 62,
	-- Title-screen blink now runs at the faster MSX-paced timing instead of the
	-- previously doubled Lua pacing.
	title_start_blink_phase_frames = 2,
	title_start_blink_cycles = 7,
	title_start_blink_tail_frames = 1,
	-- MSX state_4 stores delay = 0x20 before gameplay actually enters the room.
	title_start_wait_frames = 32,
	room_switch_wait_frames = 6,
	item_screen_wait_frames = 6,
	seal_room_dissolve_steps = 7,
	seal_sprite_dissolve_steps = 6,
	daemon_cloud_max = 8,
	daemon_cloud_spawn_x_min = 13,
	daemon_cloud_spawn_x_max = 20,
	daemon_cloud_spawn_y_min = 6,
	daemon_cloud_spawn_y_max = 12,
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
constants.room.tile_half = constants.room.tile_size / 2
constants.room.tile_unit = constants.room.tile_size / 4
constants.room.tile_size2 = constants.room.tile_size * 2
constants.room.tile_size3 = constants.room.tile_size * 3
constants.room.tile_size4 = constants.room.tile_size * 4
constants.room.tile_size9 = constants.room.tile_size * 9
constants.room.tile_size20 = constants.room.tile_size * 20

constants.player = {
	width = 16,
	height = 16,
	start_x = constants.room.tile_size20,
	start_y = constants.room.tile_origin_y + constants.room.tile_size9,
	walk_anim_cycle_px = 8,
}

constants.sword = {
	duration_frames = 4,
	ground_body_offset_right = 0,
	ground_body_offset_left = 0,
	ground_offset_right = 17,
	ground_offset_left = -10,
	ground_offset_y = 9,
	jump_body_offset_right = 0,
	jump_body_offset_left = 0,
	jump_offset_right = 17,
	jump_offset_left = -10,
	jump_offset_y = 10,
	stairs_body_offset_right = 0,
	stairs_body_offset_left = 0,
	stairs_offset_right = 17,
	stairs_offset_left = -10,
	stairs_offset_y = 9,
}

constants.damage = {
	max_health = 48,
	hit_invulnerability_frames = 32,
	hit_blink_switch_frames = 5,
	knockback_dx = 4,
	knockup_px = 2,
	hit_recovery_frames = 8,
	death_frames = 40,
}

constants.enemy = {
	mijter_wait_takeoff_min_steps = 100,
	mijter_wait_takeoff_max_steps = 200,
	mijter_turn_min_steps = 20,
	mijter_turn_max_steps = 40,
	mijter_room_entry_lock_steps = 2,
	mijter_speed_px = 2,
	boek_wait_open_steps = 100,
	boek_wait_close_steps = 100,
	boek_spawn_paper_steps = 20,
	paper_speed_x = 3,
	muziek_horizontal_speed_num = 1,
	muziek_horizontal_speed_den = 4,
	muziek_spawn_noot_steps = 50,
	staff_wait_before_spawn_state_steps = 100,
	staff_wait_before_spawn_steps = 10,
	staff_spawn_burst_count = 3,
	staff_bullet_speed_num = 16,
	staff_bullet_speed_den = 8,
	cloud_horizontal_speed_num = 1,
	cloud_horizontal_speed_den = 2,
	cloud_wave_phase_step_millirad = 25,
	cloud_wave_phase_denominator = 1000,
	cloud_wave_speed_num = 2,
	cloud_wave_speed_den = 3,
	cloud_anim_switch_steps = 5,
	cloud_spawn_vlok_steps = 50,
	vlokspawner_spawn_steps = 50,
	zak_prepare_jump_steps = 13,
	zak_jump_steps = 10,
	zak_recovery_steps = 2,
	zak_horizontal_speed_px = 1,
	zak_vertical_speed_start = -1,
	zak_vertical_speed_step = 0.40,
	cross_wait_before_fly_steps = 50,
	cross_turn_steps = 5,
	cross_horizontal_speed_px = 2,
	mijter_drop_health_chance_pct = 50,
	mijter_drop_ammo_chance_pct = 50,
	zak_drop_health_chance_pct = 25,
	zak_drop_ammo_chance_pct = 20,
	cross_drop_health_chance_pct = 35,
	cross_drop_ammo_chance_pct = 25,
	boek_drop_health_chance_pct = 10,
	boek_drop_ammo_chance_pct = 20,
	muziek_drop_health_chance_pct = 10,
	muziek_drop_ammo_chance_pct = 20,
	marspein_drop_health_chance_pct = 10,
	marspein_drop_ammo_chance_pct = 20,
	explosion_frame_steps = 3 * 20,
	loot_life_regen = 12,
	loot_ammo_regen = 10,
}

constants.rock = {
	width = 16,
	height = 16,
	max_health = 3,
	break_steps = 20,
}

constants.pickup_item = {
	life_regen = 12,
	ammo_regen = 10,
}

constants.world_item = {
	sprite = {
		ammo = 'ammo',
		ammofromrock = 'ammo',
		life = 'item_health',
		lifefromrock = 'item_health',
		keyworld1 = 'world_key',
		map_world1 = 'map',
		halo = 'halo',
		pepernoot = 'pepernoot_16',
		spyglass = 'spyglass',
		lamp = 'item_lamp',
		schoentjes = 'schoentjes',
		greenvase = 'item_greenvase',
	},
}

constants.collision = {
	world_layer = 1,
	player_layer = 4,
	enemy_layer = 8,
	projectile_layer = 16,
	pickup_layer = 32,
	player_mask = 57,
	enemy_mask = 21,
	projectile_mask = 12,
	pickup_mask = 4,
}

constants.collision_flags = {
	none = 0,
	wall = 1,
	water = 2,
	ladder_wall = 4,
	door_wall = 8,
	player = 16,
	weapon = 32,
	enemy = 64,
	lava = 128,
}
constants.collision_flags.elevator = constants.collision_flags.wall | constants.collision_flags.ladder_wall
constants.collision_flags.solid_mask = constants.collision_flags.wall | constants.collision_flags.ladder_wall | constants.collision_flags.door_wall

constants.stairs = {
	speed_px = 1,
	down_start_push_px = 2,
	anim_step_px = 8,
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
	walk_dx_schoentjes_num = 5,
	walk_dx_schoentjes_den = 2,
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

constants.secondary_weapon = {
	pepernoot_speed_px = 8,
	pepernoot_weapon_level_cost = 2,
	pepernoot_max_active = 3,
	pepernoot_spawn_offset_x = 8,
	pepernoot_spawn_offset_y = 8,
}

constants.lithograph = {
	hit_left_px = 6,
	hit_top_px = 8,
	hit_right_px = 10,
	hit_bottom_px = 16,
}

constants.world_entrance = {
	trigger_x_offset = constants.room.tile_size,
	trigger_half_width = 4,
	trigger_y_offset = constants.room.tile_size,
	open_step_frames = 4,
	enter_world_midpoint_step = 32,
	enter_world_total_steps = 64,
}

constants.shrine = {
	hit_left_px = constants.room.tile_size,
	hit_top_px = constants.room.tile_size,
	hit_right_px = constants.room.tile_size2,
	hit_bottom_px = constants.room.tile_size2,
	text_x = constants.room.tile_size * 6,
	text_y = constants.room.hud_height + (constants.room.tile_size * 5),
}

constants.seal = {
	hit_left_px = 0,
	hit_top_px = 0,
	hit_right_px = constants.room.tile_size,
	hit_bottom_px = constants.room.tile_size,
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
	weapon_level = 48,
	health_anim_step_frames = 2,
	weapon_anim_step_frames = 2,
	health_bar_x = 24,
	health_bar_y = 10,
	weapon_bar_x = 24,
	weapon_bar_y = 18,
	equipped_item_x = 28,
	equipped_item_y = 1,
}

return constants
