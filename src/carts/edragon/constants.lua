local constants = {}

constants.ids = {
	fighter_def = 'edragon.fighter.def',
	fighter_fsm = 'edragon.fighter.fsm',
	player_instance = 'edragon.player.instance',
	enemy_instance = 'edragon.enemy.instance',
	arena_def = 'edragon.arena.def',
	arena_instance = 'edragon.arena.instance',
}

constants.machine = {
	width = 256,
	height = 240,
}

constants.role = {
	player = 'player',
	enemy = 'enemy',
}

constants.physics = {
	floor_y = 196,
	gravity = 0.42,
	walk_speed = 1.5,
	jump_speed = -6,
	max_fall = 8.8,
	pushback_speed = 2.4,
}

constants.state = {
	-- DD2 core movement
	idle = 0x00, -- con_state_idle
	walk = 0x01, -- con_state_walk
	run = 0x02, -- con_state_run
	ladder_climb_up = 0x03, -- con_state_ladder_climb_up
	ladder_climb_idle = 0x04, -- con_state_ladder_climb_idle
	ladder_climb_down = 0x05, -- con_state_ladder_climb_down
	jump_up = 0x06, -- con_state_jump_up
	jump_forward_player = 0x08, -- con_state_jump_foward_player
	jump_forward_enemy = 0x09, -- con_state_jump_foward_enemy
	land_after_jump = 0x12, -- con_state_land_after_jump
	fall_after_action = 0x13, -- con_state_fall_after_action

	-- DD2 hit/KO states
	hit_light = 0x14, -- con_state_14
	hit_mid = 0x15, -- con_state_15
	hit_heavy = 0x16, -- con_state_16
	hit_very_heavy = 0x17, -- con_state_17
	collapsed = 0x18, -- con_state_18
	lie_on_ground = 0x19, -- con_state_lie_on_the_ground
	knockback_a = 0x1A, -- con_state_1A
	knockback_b = 0x1B, -- con_state_1B
	knockback_c = 0x1C, -- con_state_1C
	knockback_d = 0x1D, -- con_state_1D
	knockback_e = 0x1E, -- con_state_thrown_by_hair_throw
	uppercut_air = 0x1F, -- con_state_1F
	high_jump_kick_knockdown = 0x20, -- con_state_20
	sudden_uppercut_knockdown = 0x21, -- con_state_21
	cyclone_kick_knockdown = 0x22, -- con_state_22
	fall_from_gear = 0x23, -- con_state_23
	sudden_uppercut = 0x3B, -- con_state_uppercut_sudden

	-- DD2 attacks
	punch_normal = 0x2D, -- con_state_punch_normal
	ninja_knife = 0x2E, -- con_state_ninja_knife
	uppercut_normal = 0x2F, -- con_state_uppercut_normal
	kick = 0x33, -- con_state_33
	jump_kick = 0x35, -- con_state_35
	cyclone_kick = 0x39, -- con_state_cyclone_kick
	high_jump_kick = 0x3A, -- con_state_high_jump_kick
	cut_up = 0x3D, -- con_state_punch_strong

	-- endings
	death_normal = 0x26, -- con_state_death_normal

	-- backwards-compatible aliases
	stand = 0x00,
	jump = 0x06,
	fall = 0x13,
	attack = 0x2D,
	hurt = 0x14,
	knockdown = 0x19,
	defeat = 0x26,
}

constants.controls = {
	left = 'left[p]',
	right = 'right[p]',
	jump = 'a[p]',
	punch = 'x[p]',
	kick = 'b[p]',
}

constants.player = {
	start_x = 40,
	start_y = 172,
	width = 16,
	height = 24,
	max_health = 24,
}

constants.enemy = {
	start_x = 190,
	start_y = 172,
	width = 16,
	height = 24,
	max_health = 24,
	think_every = 16,
}

constants.attack = {
	duration = 8,
	cooldown = 18,
	range_x = 18,
	hit_window = 4,
	damage = 4,
	hit_freeze = 4,
	hurt_time = 12,
}

constants.state_timings = {
	idle = 1,
	walk = 1,
	land_after_jump = 6,
	fall_after_action = 8,
	hit_light = 10,
	hit_mid = 10,
	hit_heavy = 12,
	hit_very_heavy = 14,
	collapsed = 16,
	lie_on_ground = 30,
	knockback_a = 8,
	knockback_b = 10,
	knockback_c = 10,
	knockback_d = 10,
	knockback_e = 10,
	uppercut_air = 4,
	high_jump_kick_knockdown = 4,
	sudden_uppercut_knockdown = 8,
	cyclone_kick_knockdown = 4,
	fall_from_gear = 20,
	punch_normal = 10,
	ninja_knife = 10,
	uppercut_normal = 12,
	kick = 12,
	jump_kick = 14,
	cyclone_kick = 16,
	high_jump_kick = 16,
	cut_up = 14,
}

constants.attack_profiles = {
	punch_normal = {
		duration = 10,
		hit_window = 3,
		cooldown = 18,
		pushback = constants.physics.pushback_speed * 1.0,
	},
	ninja_knife = {
		duration = 10,
		hit_window = 3,
		cooldown = 16,
		pushback = constants.physics.pushback_speed * 1.05,
	},
	uppercut_normal = {
		duration = 12,
		hit_window = 4,
		cooldown = 22,
		pushback = constants.physics.pushback_speed * 1.2,
	},
	kick = {
		duration = 12,
		hit_window = 4,
		cooldown = 16,
		pushback = constants.physics.pushback_speed * 1.1,
	},
	jump_kick = {
		duration = 12,
		hit_window = 4,
		cooldown = 18,
		pushback = constants.physics.pushback_speed * 1.1,
	},
	cyclone_kick = {
		duration = 14,
		hit_window = 4,
		cooldown = 22,
		pushback = constants.physics.pushback_speed * 1.25,
	},
	high_jump_kick = {
		duration = 14,
		hit_window = 5,
		cooldown = 24,
		pushback = constants.physics.pushback_speed * 1.2,
	},
	uppercut_sudden = {
		duration = 14,
		hit_window = 4,
		cooldown = 24,
		pushback = constants.physics.pushback_speed * 1.1,
	},
	cut_up = {
		duration = 14,
		hit_window = 5,
		cooldown = 24,
		pushback = constants.physics.pushback_speed * 1.15,
	},
}

constants.hit_state_chain = {
	[constants.state.hit_light] = constants.state.hit_mid,
	[constants.state.hit_mid] = constants.state.hit_heavy,
	[constants.state.hit_heavy] = constants.state.hit_very_heavy,
	[constants.state.hit_very_heavy] = constants.state.collapsed,
	[constants.state.collapsed] = constants.state.lie_on_ground,
	[constants.state.knockback_a] = constants.state.knockback_b,
	[constants.state.knockback_b] = constants.state.knockback_c,
	[constants.state.knockback_c] = constants.state.knockback_d,
	[constants.state.knockback_d] = constants.state.knockback_e,
	[constants.state.knockback_e] = constants.state.lie_on_ground,
	[constants.state.uppercut_air] = constants.state.lie_on_ground,
	[constants.state.high_jump_kick_knockdown] = constants.state.lie_on_ground,
	[constants.state.sudden_uppercut_knockdown] = constants.state.lie_on_ground,
	[constants.state.cyclone_kick_knockdown] = constants.state.lie_on_ground,
	[constants.state.fall_from_gear] = constants.state.lie_on_ground,
}

constants.palette = {
	bg = { r = 0.08, g = 0.08, b = 0.12, a = 1 },
	floor = { r = 0.24, g = 0.24, b = 0.30, a = 1 },
	player = { r = 1.00, g = 0.66, b = 0.25, a = 1 },
	enemy = { r = 0.28, g = 0.87, b = 1.00, a = 1 },
	metal = { r = 0.46, g = 0.46, b = 0.48, a = 1 },
	hurt = { r = 1.00, g = 0.18, b = 0.20, a = 1 },
}

constants.z = {
	background = 20,
	fighter = 220,
	hud = 960,
}

return constants
