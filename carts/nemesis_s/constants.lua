ids_stage_def = 'nemesis_s.stage'
ids_stage_instance = 'nemesis_s.stage'
ids_stage_fsm = 'nemesis_s.stage.fsm'
ids_stage_star_blink_timeline = 'nemesis_s.stage.timeline.star_blink'
ids_player_def = 'nemesis_s.player'
ids_player_fsm = 'nemesis_s.player.fsm'
ids_mijter_foe_def = 'nemesis_s.enemy.mijter_foe'
ids_mijter_foe_fsm = 'nemesis_s.enemy.mijter_foe.fsm'
ids_sint_pop_def = 'nemesis_s.enemy.sint_pop'
ids_sint_pop_fsm = 'nemesis_s.enemy.sint_pop.fsm'
ids_schoorsteen_foe_def = 'nemesis_s.enemy.schoorsteen_foe'
ids_schoorsteen_foe_fsm = 'nemesis_s.enemy.schoorsteen_foe.fsm'
ids_schoorsteen_ray_def = 'nemesis_s.enemy.schoorsteen_ray'
ids_schoorsteen_ray_fsm = 'nemesis_s.enemy.schoorsteen_ray.fsm'
ids_rook_generator_def = 'nemesis_s.enemy.rook_generator'
ids_rook_generator_fsm = 'nemesis_s.enemy.rook_generator.fsm'
ids_rook_def = 'nemesis_s.enemy.rook'
ids_rook_fsm = 'nemesis_s.enemy.rook.fsm'
ids_zak_foe_def = 'nemesis_s.enemy.zak_foe'
ids_zak_foe_fsm = 'nemesis_s.enemy.zak_foe.fsm'
ids_sneeuwpop_def = 'nemesis_s.enemy.sneeuwpop'
ids_sneeuwpop_fsm = 'nemesis_s.enemy.sneeuwpop.fsm'
ids_sneeuwpop_ray_def = 'nemesis_s.enemy.sneeuwpop_ray'
ids_sneeuwpop_ray_fsm = 'nemesis_s.enemy.sneeuwpop_ray.fsm'
ids_destroyed_sneeuwpop_def = 'nemesis_s.enemy.destroyed_sneeuwpop'
ids_destroyed_sneeuwpop_fsm = 'nemesis_s.enemy.destroyed_sneeuwpop.fsm'
ids_enemy_bullet_def = 'nemesis_s.enemy.bullet'
ids_enemy_bullet_fsm = 'nemesis_s.enemy.bullet.fsm'
ids_kerk_def = 'nemesis_s.enemy.kerk'
ids_kerk_fsm = 'nemesis_s.enemy.kerk.fsm'
ids_bel_def = 'nemesis_s.enemy.bel'
ids_bel_fsm = 'nemesis_s.enemy.bel.fsm'
ids_noot_def = 'nemesis_s.enemy.noot'
ids_noot_fsm = 'nemesis_s.enemy.noot.fsm'
ids_moon_def = 'nemesis_s.enemy.moon'
ids_moon_fsm = 'nemesis_s.enemy.moon.fsm'
ids_moon_death_ray_def = 'nemesis_s.enemy.moon_death_ray'
ids_moon_death_ray_fsm = 'nemesis_s.enemy.moon_death_ray.fsm'
ids_mini_moon_def = 'nemesis_s.enemy.mini_moon'
ids_mini_moon_fsm = 'nemesis_s.enemy.mini_moon.fsm'
ids_moon_small_ray_def = 'nemesis_s.enemy.moon_small_ray'
ids_moon_small_ray_fsm = 'nemesis_s.enemy.moon_small_ray.fsm'
ids_roodje_def = 'nemesis_s.pickup.roodje'
ids_roodje_fsm = 'nemesis_s.pickup.roodje.fsm'
ids_option_pickup_def = 'nemesis_s.pickup.option'
ids_option_pickup_fsm = 'nemesis_s.pickup.option.fsm'
ids_small_explosion_def = 'nemesis_s.effect.small_explosion'
ids_small_explosion_fsm = 'nemesis_s.effect.small_explosion.fsm'
ids_large_explosion_def = 'nemesis_s.effect.large_explosion'
ids_large_explosion_fsm = 'nemesis_s.effect.large_explosion.fsm'
player_starts = {
	{ id = 'nemesis_s.player.1', x = 80, y = 60 },
	{ id = 'nemesis_s.player.2', x = 120, y = 80 },
}
ids_director_def = 'nemesis_s.director'
ids_director_instance = 'nemesis_s.director'
ids_director_fsm = 'nemesis_s.director.fsm'
presentation_width = 256
presentation_height = 192
playfield_width = 256
playfield_height = 176
game_over_curtain_columns = 32
game_over_curtain_tile_width = 8
game_over_curtain_draw_z = 200
game_over_blackout_duration_ms = 2000
player_width = 16
player_height = 10
-- Nemesis 2 routine A902 scales each signed Q8.8 direction word by E402 + 4.
-- Its half-pixel basis therefore advances 2px plus 0.5px per speed level on
-- each original gameplay update.
player_base_movement_step = 2
player_movement_step_increase = 0.5
player_option_history_count = 16
player_option_history_spacing = 8
player_option_pickup_offset_x = 128
player_option_pickup_speed_x_px_per_second = -25
player_vessel_capacity = 3
player_bullet_movement_speed = 12
player_bullet_spawn_offset_x = 8
-- Name-table projectiles originate eight pixels below the original vessel
-- record. The trimmed vessel image already starts two pixels below that record.
player_bullet_spawn_offset_y = 6
player_bullet_collision_backtrack = 8
-- ABE5 retains the held-fire counter in E437 and admits another complete
-- weapon salvo when that counter reaches fifteen gameplay updates.
player_fire_repeat_updates = 15
player_hitcheck_x = { 4, 8, 14, 4, 8, 8 }

player_hitcheck_y = { 4, 4, 5, 7, 5, 7 }
player_respawn_invulnerability_ms = 2000
player_respawn_blink_ms = 50
player_force_field_strength = 5
player_force_field_hit_standard = 0
player_force_field_hit_overload = 1
player_force_field_animation_frame_ms = 100
player_force_field_offset_y = -2

collision_player_projectile_layer = 1
collision_enemy_layer = 2
collision_player_layer = 4
collision_enemy_projectile_layer = 8
collision_pickup_layer = 16
collision_player_projectile_mask = collision_enemy_layer
collision_enemy_mask = collision_player_projectile_layer | collision_player_layer
collision_player_mask = collision_enemy_layer | collision_enemy_projectile_layer | collision_pickup_layer
collision_enemy_projectile_mask = collision_player_layer
collision_pickup_mask = collision_player_layer

sint_pop_group_up = 0
sint_pop_group_down = 1
sint_pop_group_size = 6
sint_pop_width = 16
sint_pop_move_to_player_speed_x_px_per_second = -75
sint_pop_move_vertical_up_speed_y_px_per_second = 75
sint_pop_move_vertical_down_speed_y_px_per_second = -100
sint_pop_move_away_speed_x_px_per_second = 100
sint_pop_vertical_start_x = 144
sint_pop_retreat_start_x = 64
sint_pop_draw_z = 60

mijter_foe_type_blue = 0
mijter_foe_type_red = 1
-- Nemesis 2 Sodom actor 0x09: 0x9B4C initializes raw X velocity; 0x9B62
-- steers raw Y velocity toward the retained player coordinate every update.
mijter_foe_velocity_x_q8 = -0x0300
mijter_foe_tracking_acceleration_y_q8 = 0x0016
mijter_foe_width = 24
mijter_foe_height = 16
mijter_foe_draw_z = 60

schoorsteen_foe_health = 15
schoorsteen_foe_fire_left = -32
schoorsteen_foe_fire_right = 31
schoorsteen_foe_initial_wait_updates = 48
schoorsteen_foe_firing_wait_updates = 6
schoorsteen_foe_cooldown_updates = 32
schoorsteen_foe_width = 32
schoorsteen_foe_draw_z = 50
schoorsteen_flash_offset_x = 7
schoorsteen_flash_offset_y = -8
schoorsteen_ray_offset_x = 11
schoorsteen_ray_offset_y = 8
schoorsteen_ray_tile_size = 8
schoorsteen_ray_initial_tiles = 1
schoorsteen_ray_growth_tiles = 4
schoorsteen_ray_growth_updates = 10
schoorsteen_ray_draw_z = 55

rook_generator_health = 15
rook_generator_initial_wait_updates = 48
rook_generator_opening_updates = 4
rook_generator_spawn_interval_updates = 8
rook_generator_spawn_count = 5
rook_generator_cycle_updates = 97
rook_generator_width = 24
rook_generator_draw_z = 50
rook_spawn_offset_x = 4
rook_spawn_offset_y = -12
rook_health = 1
rook_animation_frame_updates = 4
rook_rise_distances = { 84, 72, 60, 48, 36 }
rook_rise_velocity_y_q8 = -0x0300
rook_attack_velocity_x_q8 = 0x0280
rook_tracking_acceleration_y_q8 = 0x0016
rook_width = 16
rook_height = 16
rook_draw_z = 60

zak_foe_health = 1
zak_foe_direction_left = -1
zak_foe_direction_right = 1
zak_foe_prepare_ms = 250
zak_foe_jump_ms = 200
zak_foe_recovery_ms = 40
zak_foe_fire_initial_ms = 1000
zak_foe_fire_min_ms = 500
zak_foe_fire_max_ms = 999
zak_foe_horizontal_speed_px_per_second = 50
zak_foe_initial_vertical_speed_px_per_second = -50
zak_foe_vertical_acceleration_px_per_second_squared = 500
zak_foe_width = 16
zak_foe_draw_z = 60
enemy_bullet_size = 4
enemy_bullet_draw_z = 65

kerk_width = 40
kerk_height = 152
kerk_draw_z = 40
bel_health = 100
bel_wait_ms = 3000
bel_middle_ms = 250
bel_side_ms = 500
bel_ring_count_min = 5
bel_ring_count_max = 9
bel_note_spawn_count_min = 10
bel_note_spawn_count_max = 19
bel_note_spawn_offset_x = -16
bel_note_spawn_offset_y = 8
bel_side_offset_x = 11
bel_side_offset_y = -2
bel_draw_z = 50
noot_velocity_scale_px_per_second = 100
noot_width = 8
noot_height = 8
noot_red_pickup_limit = 3
noot_draw_z = 60
moon_health = 100
moon_width = 64
moon_height = 64
moon_spawn_x = playfield_width + 24
moon_spawn_y = 32
moon_enter_target_x = 176
moon_enter_step_x = 8
moon_enter_step_ms = 200
moon_fly_step = 8
moon_mini_spawn_ms = 400
moon_small_ray_move_step_x = 8
moon_small_ray_move_ms = 100
moon_small_ray_flash_ms = 500
moon_small_ray_volley_ms = 500
moon_slow_vertical_step = 8
moon_slow_vertical_step_ms = 60
moon_wait_for_attack_ms = 1000
moon_wait_for_explosion_ms = 3000
moon_wait_for_end_demo_ms = 5000
moon_fly_attack_chance_percent = 70
moon_rotation_up = 1
moon_rotation_up_right = 2
moon_rotation_right = 3
moon_rotation_down_right = 4
moon_rotation_down = 5
moon_rotation_down_left = 6
moon_rotation_left = 7
moon_rotation_up_left = 8
moon_vertical_direction_up = -1
moon_vertical_direction_down = 1
moon_core_collider_id = 'core'
moon_armor_collider_id = 'armor'
moon_death_ray_strip_id = 'death_ray_strip'
moon_death_ray_cap_id = 'death_ray_cap'
moon_flash_left_id = 'flash_left'
moon_flash_right_id = 'flash_right'
moon_death_ray_tile_size = 8
moon_death_ray_offset_x = -16
moon_death_ray_offset_y = 16
moon_death_ray_tile_count = (
	playfield_width - moon_width + moon_death_ray_offset_x
) // moon_death_ray_tile_size
moon_death_ray_expansion_updates = moon_death_ray_tile_count - 1
moon_death_ray_hold_updates = 16
moon_death_ray_cycle_updates = 40
moon_death_ray_move_phase_initial = 0xff
moon_death_ray_move_phase_step = 0x46
moon_death_ray_move_step = 8
moon_death_ray_move_counter_min = 8
moon_death_ray_move_counter_max = 11
moon_death_ray_move_pause_updates = 16
moon_death_ray_move_target_offset_y = moon_height // 2
moon_death_ray_move_top_y = -48
moon_death_ray_move_bottom_y = 96
moon_death_ray_cap_width = 32
moon_death_ray_cap_height = 34
moon_death_ray_draw_z = 2
moon_small_ray_tile_size = 8
moon_small_ray_growth_tiles = 2
moon_small_ray_max_steps = 5
moon_small_ray_step_ms = 20
moon_small_ray_speed = 8
moon_small_ray_draw_z = 70
mini_moon_health = 1
mini_moon_speed_px_per_second = 50
mini_moon_red_chance_percent = 20
mini_moon_red_pickup_limit = 3
mini_moon_width = 14
mini_moon_height = 16
mini_moon_draw_z = 60
moon_draw_z = 50
roodje_width = 16
roodje_draw_z = 65
explosion_frame_ms = 100
small_explosion_draw_z = 60
large_explosion_draw_z = 50

sneeuwpop_health = 30
sneeuwpop_ready_ms = 500
sneeuwpop_cooldown_ms = 1000
sneeuwpop_width = 48
sneeuwpop_draw_z = 50
sneeuwpop_flash_offset_x = -4
sneeuwpop_flash_offset_y = 8
sneeuwpop_ray_offset_x = -4
sneeuwpop_ray_offset_y = 8
sneeuwpop_ray_step_ms = 20
sneeuwpop_ray_tile_size = 8
sneeuwpop_ray_growth_tiles = 3
sneeuwpop_ray_max_steps = 10
sneeuwpop_ray_draw_z = 55

weapons_laser = {
	tile_width = 8,
	spawn_offset_x = 16,
	-- The ROM anchors the beam eight pixels below the vessel record. Its visible
	-- pixels begin two rows below that record; this trimmed image begins there.
	spawn_offset_y = 6,
	expansion_tiles_per_tick = 4,
	travel_speed = 32,
	collision_retract_tiles = 4,
	length_tiles_by_level = { 15, 28 },
}

weapons_missile_spawn_offset_x = 8
-- The missile sprite begins one pixel below its record, while the trimmed
-- vessel begins two pixels below its own record.
weapons_missile_spawn_offset_y = 7
weapons_missile_despawn_y = 168
weapons_missile_motion_by_level = {
	{
		fall_velocity_x_q8 = 0x0100,
		fall_velocity_y_q8 = 0x0400,
		surface_velocity_x_q8 = 0x0400,
	},
	{
		fall_velocity_x_q8 = 0x0180,
		fall_velocity_y_q8 = 0x0600,
		surface_velocity_x_q8 = 0x0600,
	},
}
weapons_uplaser = {
	tile_width = 8,
	movement_speed = 6,
	initial_length_tiles = 2,
	level2_gate_frames = 4,
	level2_growth_tiles = 2,
	level2_edge_growth_tiles = 1,
	level2_left_growth_px = 8,
	-- ADBA passes DE=0800 to B224. As with the ordinary laser, direct pixels
	-- consume the visible vessel origin rather than its two-pixel-higher record.
	spawn_offset_x = 0,
	spawn_offset_y = 6,
}

stage_asset_id = 'nemesis_s_stage'
stage_star_scroll_speed_px_per_second = 31.25
stage_star_blink_frame_ms = 50
stage_star_particle_z = 8
assets_player_n = 'metallion_n'
assets_player_u = 'metallion_u'
assets_player_d = 'metallion_d'
assets_player_2_n = 'metallion_n_p2'
assets_player_2_u = 'metallion_u_p2'
assets_player_2_d = 'metallion_d_p2'
assets_player_cheat_n = 'metallion_n_cheat'
assets_player_cheat_u = 'metallion_u_cheat'
assets_player_cheat_d = 'metallion_d_cheat'
assets_player_2_cheat_n = 'metallion_n_cheat_p2'
assets_player_2_cheat_u = 'metallion_u_cheat_p2'
assets_player_2_cheat_d = 'metallion_d_cheat_p2'
assets_player_n_shield = 'metallion_n_shield'
assets_player_d_shield = 'metallion_d_shield'
assets_player_n_shield_p2 = 'metallion_n_shield_p2'
assets_player_d_shield_p2 = 'metallion_d_shield_p2'
assets_player_cheat_n_shield = 'metallion_n_shield_cheat'
assets_player_cheat_d_shield = 'metallion_d_shield_cheat'
assets_player_2_cheat_n_shield = 'metallion_n_shield_cheat_p2'
assets_player_2_cheat_d_shield = 'metallion_d_shield_cheat_p2'
assets_force_field_1 = 'force_field_1'
assets_force_field_2 = 'force_field_2'
assets_force_field_3 = 'force_field_3'
assets_force_field_4 = 'force_field_4'
assets_option1 = 'option1'
assets_option2 = 'option2'
assets_option3 = 'option3'
assets_option4 = 'option4'
assets_player_2_option_1 = 'option1_p2'
assets_player_2_option_2 = 'option2_p2'
assets_player_2_option_3 = 'option3_p2'
assets_player_2_option_4 = 'option4_p2'
assets_player_death_1 = 'player_death_1'
assets_player_death_2 = 'player_death_2'
assets_player_death_3 = 'player_death_3'
assets_projectile = 'kogeltje'
assets_mijter_foe_blue_neutral = 'mijter_foe_blue_neutral'
assets_mijter_foe_blue_up = 'mijter_foe_blue_up'
assets_mijter_foe_blue_down = 'mijter_foe_blue_down'
assets_mijter_foe_red_neutral = 'mijter_foe_red_neutral'
assets_mijter_foe_red_up = 'mijter_foe_red_up'
assets_mijter_foe_red_down = 'mijter_foe_red_down'
assets_sint_pop = 'sint_pop'
assets_schoorsteen_foe_1 = 'schoorsteen_foe_1'
assets_schoorsteen_foe_2 = 'schoorsteen_foe_2'
assets_schoorsteen_foe_3 = 'schoorsteen_foe_3'
assets_schoorsteen_foe_4 = 'schoorsteen_foe_4'
assets_schoorsteen_foe_5 = 'schoorsteen_foe_5'
assets_schoorsteen_flash_1 = 'schoorsteen_flash_1'
assets_schoorsteen_flash_2 = 'schoorsteen_flash_2'
assets_schoorsteen_ray = 'schoorsteen_ray'
assets_rook_generator_open = 'rook_generator_open'
assets_rook_generator_closed = 'rook_generator_closed'
assets_rook_1 = 'rook_1'
assets_rook_2 = 'rook_2'
assets_rook_3 = 'rook_3'
assets_zak_foe_stand = 'zak_foe_stand'
assets_zak_foe_jump = 'zak_foe_jump'
assets_zak_foe_recover = 'zak_foe_recover'
assets_sneeuwpop = 'sneeuwpop'
assets_sneeuwpop_ray = 'sneeuwpop_ray'
assets_sneeuwpop_destroyed = 'sneeuwpop_destroyed'
assets_enemy_bullet = 'enemy_bullet'
assets_kerk = 'kerk'
assets_bel_middle = 'bel_middle'
assets_bel_side = 'bel_side'
assets_noot = 'noot'
assets_moon_up = 'moon_up'
assets_moon_up_right = 'moon_up_right'
assets_moon_right = 'moon_right'
assets_moon_down_right = 'moon_down_right'
assets_mini_moon = 'mini_moon'
assets_mini_moon_red = 'mini_moon_red'
assets_moon_death_ray = 'moon_death_ray'
assets_moon_death_ray_start = 'moon_death_ray_start'
assets_roodje = 'roodje'
assets_small_explosion_1 = 'small_explosion_1'
assets_small_explosion_2 = 'small_explosion_2'
assets_small_explosion_3 = 'small_explosion_3'
assets_small_explosion_4 = 'small_explosion_4'
assets_large_explosion_1 = 'large_explosion_1'
assets_large_explosion_2 = 'large_explosion_2'
assets_large_explosion_3 = 'large_explosion_3'
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
