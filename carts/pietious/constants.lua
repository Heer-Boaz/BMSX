flow_room_transition_frames = 8
flow_banner_prewait_frames = 32
flow_world_banner_frames = 62
flow_castle_banner_frames = 62
flow_title_start_blink_phase_frames = 2
flow_title_start_blink_cycles = 7
flow_title_start_blink_tail_frames = 1
flow_title_start_wait_frames = 32
flow_room_switch_wait_frames = 6
flow_item_screen_wait_frames = 6
-- MoG state 9's TBE26/TBE36 path retains the seated pose for 0x0258 VBlanks,
-- then alternates the two stuck poses every eight VBlanks. Pietious advances
-- one authored frame per two VBlanks.
flow_pause_seated_frames = 0x012c
flow_pause_stuck_frame_hold = 4
-- The MSX game-over wipe clears one 8 px column per VBlank. Pietious advances
-- gameplay once per two VBlanks, so each curtain frame clears two columns and
-- retains the original 640 ms duration.
flow_death_curtain_frames = 16
flow_death_curtain_columns_per_frame = 2
flow_death_screen_frames = 50
flow_narrative_scroll_pixels_num = 2
flow_narrative_scroll_pixels_den = 5
-- MoG state F advances these counters in the admitted interrupt bottom half:
-- T9F61/T9F68 retain 0x3c updates of backdrop flashing, and TBE1C retains
-- three 25-update dissolve ranges. Pietious already admits that same bottom
-- half cadence once per two VBlanks, so these are the raw MSX counters.
flow_seal_flash_frames = 0x3c
flow_seal_sprite_dissolve_frames = 25
flow_seal_room_dissolve_frames = 50
flow_seal_dissolution_frames = flow_seal_flash_frames
	+ flow_seal_sprite_dissolve_frames
	+ flow_seal_room_dissolve_frames
flow_seal_room_dissolve_steps = 7
flow_seal_sprite_dissolve_steps = 6
-- T7FD0 initializes the smoke countdown to 0x41. T7FDB emits enemy 0x63
-- after the first decrement and every eight admitted bottom halves thereafter.
-- Enemy 0x63 advances each of its four poses after ten such updates.
flow_daemon_cloud_count = 8
flow_daemon_cloud_first_spawn_frame = 1
flow_daemon_cloud_spawn_interval_frames = 8
flow_daemon_cloud_lifetime_frames = 40
flow_daemon_cloud_last_spawn_frame = flow_daemon_cloud_first_spawn_frame
	+ (flow_daemon_cloud_count - 1) * flow_daemon_cloud_spawn_interval_frames
flow_daemon_appearance_frames = flow_daemon_cloud_last_spawn_frame + flow_daemon_cloud_lifetime_frames + 1
room_width = 256
room_height = 192
screen_width = 256
screen_height = 192
room_hud_height = 32
room_tile_size = 8
draw_z_environment_wall = 140
draw_z_enemy = 140
draw_z_room_backdrop = -1
draw_z_hud = 1000
draw_z_director_effect = 1100
room_tile_columns = 32
room_tile_rows = 20
room_tile_origin_x = 0
room_tile_origin_y = 32
room_tile_origin_y = room_hud_height
room_tile_half = room_tile_size / 2
room_tile_unit = room_tile_size / 4
room_tile_size2 = room_tile_size * 2
room_tile_size3 = room_tile_size * 3
room_tile_size4 = room_tile_size * 4
room_tile_size9 = room_tile_size * 9
room_tile_size20 = room_tile_size * 20
player_width = 16
player_height = 16
player_start_x = room_tile_size20
player_start_y = room_tile_origin_y + room_tile_size9
player_walk_animation_phase_mask = 0x3
sword_duration_frames = 4
sword_ground_body_offset_right = 0
sword_ground_body_offset_left = 0
sword_ground_offset_right = 17
sword_ground_offset_left = -10
sword_ground_offset_y = 9
sword_jump_body_offset_right = 0
sword_jump_body_offset_left = 0
sword_jump_offset_right = 17
sword_jump_offset_left = -10
sword_jump_offset_y = 10
sword_stairs_body_offset_right = 0
sword_stairs_body_offset_left = 0
sword_stairs_offset_right = 17
sword_stairs_offset_left = -10
sword_stairs_offset_y = 9
damage_max_health = 48
damage_hit_invulnerability_frames = 32
damage_hit_blink_switch_frames = 5
damage_knockback_dx = 4
damage_knockup_px = 2
damage_enemy_contact_damage = 2
damage_hit_recovery_frames = 8
damage_death_pose_frames = 8
-- Original Bat state at 0x7d5f-0x7e14: 0x50 hanging updates,
-- 0x0a takeoff updates, random 0x60..0x7f flight and 0x10..0x1f heading
-- intervals, with sprite-origin bounds X=0x08..0xe8 and Y=0x28..0xb0.
enemy_mijter_hang_steps = 80
enemy_mijter_takeoff_steps = 10
enemy_mijter_flight_min_steps = 96
enemy_mijter_flight_max_steps = 127
enemy_mijter_direction_min_steps = 16
enemy_mijter_direction_max_steps = 31
enemy_mijter_min_x = room_tile_size
enemy_mijter_max_x = room_width - room_tile_size3
enemy_mijter_min_y = room_hud_height + room_tile_size
enemy_mijter_max_y = room_height - room_tile_size2
enemy_boek_wait_open_steps = 100
enemy_boek_wait_close_steps = 100
enemy_boek_spawn_paper_steps = 20
enemy_paper_speed_x = 3
enemy_muziek_horizontal_speed_num = 1
enemy_muziek_horizontal_speed_den = 4
enemy_muziek_spawn_noot_steps = 50
enemy_staff_wait_before_spawn_state_steps = 100
enemy_staff_wait_before_spawn_steps = 10
enemy_staff_spawn_burst_count = 3
enemy_staff_bullet_speed_den = 8
enemy_cloud_horizontal_speed_num = 1
enemy_cloud_horizontal_speed_den = 2
enemy_cloud_wave_phase_step_millirad = 25
enemy_cloud_wave_speed_den = 3
enemy_cloud_anim_switch_steps = 5
enemy_cloud_spawn_vlok_steps = 50
enemy_vlokspawner_spawn_steps = 50
enemy_zak_prepare_jump_steps = 13
enemy_zak_jump_steps = 10
enemy_zak_recovery_steps = 2
enemy_zak_horizontal_speed_px = 1
enemy_zak_vertical_speed_start = -1
enemy_zak_vertical_speed_step = 0.20
boss_world1_max_health = 60
boss_world1_contact_damage = 12
boss_world1_walk_step_ticks = 5
boss_world1_spawn_duration_ticks = 75
-- Pietious advances gameplay once per two VBlanks. Adding two 20 ms units per
-- gameplay tick and firing at fifteen units preserves the XNA boss' 300 ms
-- burst cadence without fractional runtime time or a drifting rounded period.
boss_world1_time_units_per_tick = 2
boss_world1_spawn_interval_units = 15
boss_world1_wait_after_spawn_ticks = 3
boss_world1_wait_before_pounce_ticks = 3
boss_world1_wait_after_pounce_ticks = 13
boss_world1_reentry_ticks = 50
boss_world1_zak_interval_units = 45
boss_world1_pounce_step_px = 16
boss_world1_max_potatoes = 3
boss_world1_max_zaks = 2
boss_world1_zak_drop_health_chance_pct = 10
boss_world1_zak_drop_ammo_chance_pct = 50
boss_world1_spawn_projectiles_per_burst = 12
boss_world1_death_odd_stage_frames = 3
boss_world1_death_even_stage_frames = 2
boss_world1_death_hidden_frames = 25
-- Timeline delta remains one 20 ms frame word per gameplay update. A 100 ms
-- authored frame therefore lasts five Pietious updates, or 200 ms on screen.
boss_world1_pose_frame_ms = 100
boss_world1_start_left_x = -96
boss_world1_start_right_x = 272
boss_world1_player_side_split_x = 160
boss_world1_entry_left_x = 16
boss_world1_entry_right_x = 160
boss_world1_pounce_left_x = 176
boss_world1_pounce_right_x = 0
boss_world1_lane_y = {
	room_hud_height + 24,
	room_hud_height + 64,
	room_hud_height + 104,
}
boss_world1_zak_lane_y = {
	room_hud_height + 40,
	room_hud_height + 80,
	room_hud_height + 120,
}
boss_world1_key_x = 15 * room_tile_size
boss_world1_key_y = room_hud_height + (15 * room_tile_size)
enemy_cross_wait_before_fly_steps = 50
enemy_cross_turn_steps = 5
enemy_cross_horizontal_speed_px = 2
enemy_mijter_drop_health_chance_pct = 50
enemy_mijter_drop_ammo_chance_pct = 50
enemy_zak_drop_health_chance_pct = 25
enemy_zak_drop_ammo_chance_pct = 20
enemy_cross_drop_health_chance_pct = 35
enemy_cross_drop_ammo_chance_pct = 25
enemy_boek_drop_health_chance_pct = 10
enemy_boek_drop_ammo_chance_pct = 20
enemy_muziek_drop_health_chance_pct = 10
enemy_muziek_drop_ammo_chance_pct = 20
enemy_marspein_drop_health_chance_pct = 10
enemy_marspein_drop_ammo_chance_pct = 20
-- MoG killed-item type 0x5b initializes its pose counter at 0x6a05 to three
-- bottom-half updates. Pietious advances the same gameplay cadence directly;
-- the timeline therefore retains the source counter as authored frames.
enemy_explosion_pose_frames = 3
enemy_loot_life_regen = 12
enemy_loot_ammo_regen = 10
rock_width = 16
rock_height = 16
rock_max_health = 3
rock_break_steps = 20
pickup_item_life_regen = 12
pickup_item_ammo_regen = 10
world_item_drop_offset_y = {
	ammo = 0,
	ammofromrock = 0,
	life = 0,
	lifefromrock = 0,
	keyworld1 = 0,
	map_world1 = 0,
	halo = 0,
	pepernoot = room_tile_size,
	spyglass = room_tile_size,
	lamp = 0,
	schoentjes = 0,
	greenvase = 0,
}

world_item_inventory = {
	keyworld1 = true,
	map_world1 = true,
	halo = true,
	pepernoot = true,
	spyglass = true,
	lamp = true,
	schoentjes = true,
	greenvase = true,
}

world_item_sprite = {
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
}

collision_world_layer = 1
collision_player_layer = 4
collision_enemy_layer = 8
collision_projectile_layer = 16
collision_pickup_layer = 32
collision_player_mask = 57
collision_enemy_mask = 21
collision_projectile_mask = 12
collision_pickup_mask = 4
collision_flags_none = 0
collision_flags_wall = 1
collision_flags_water = 2
collision_flags_ladder_wall = 4
collision_flags_door_wall = 8
collision_flags_player = 16
collision_flags_weapon = 32
collision_flags_enemy = 64
collision_flags_lava = 128
collision_flags_elevator = collision_flags_wall | collision_flags_ladder_wall
collision_flags_solid_mask = collision_flags_wall | collision_flags_ladder_wall | collision_flags_door_wall
water_none = 0
water_surface = 1
water_body = 2
water_surface_color_r = 0.18
water_surface_color_g = 0.48
water_surface_color_b = 0.82
water_surface_color_a = 0.75
water_body_color_r = 0.08
water_body_color_g = 0.24
water_body_color_b = 0.56
water_body_color_a = 0.72
stairs_speed_px = 1
stairs_down_start_push_px = 2
stairs_anim_step_px = 8
stairs_foot_probe_offset_x = 4
stairs_foot_probe_offset_y = 14
stairs_below_probe_extra_y = 16
stairs_step_off_probe_extra_y = 5
stairs_step_off_right_probe_offset_x = 16
stairs_step_off_left_probe_offset_x = -1
stairs_step_off_right_x = 8
stairs_step_off_left_x = -9
physics_walk_speed_den = 2
physics_walk_speed_px = 2
physics_walk_speed_schoentjes_num = 5
physics_walk_speed_water_num = 1
physics_jump_dx = 2
physics_fall_dx_neutral = 2
physics_fall_dx_with_inertia = 3
physics_fall_dx_against_inertia = 1
physics_jump_ceiling_cut_substate = 10
physics_jump_release_cut_substate = 11
physics_jump_to_fall_substate = 13
physics_aphrodite_water_jump_release_cut_substate = 10
physics_aphrodite_water_fall_start_substate = 12
physics_aphrodite_water_vertical_tick_period = 4
physics_aphrodite_water_vertical_scale_den = 4
physics_aphrodite_water_vertical_substate_cap = 24
physics_aphrodite_water_vertical_dy_by_substate = {
	[0] = -6,
	[1] = -6,
	[2] = -6,
	[3] = -5,
	[4] = -5,
	[5] = -4,
	[6] = -4,
	[7] = -3,
	[8] = -2,
	[9] = -1,
	[10] = 0,
	[11] = 0,
	[12] = 0,
	[13] = 0,
	[14] = 1,
	[15] = 2,
	[16] = 3,
	[17] = 4,
	[18] = 4,
	[19] = 5,
	[20] = 5,
	[21] = 6,
	[22] = 6,
	[23] = 6,
}

physics_popolon_jump_dy_by_substate = {
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
}

physics_controlled_fall_dy_by_substate = {
	[3] = 1,
	[4] = 2,
	[5] = 3,
	[6] = 4,
	[7] = 4,
	[8] = 5,
	[9] = 5,
	[10] = 5,
	[11] = 6,
}

physics_uncontrolled_fall_dy_by_substate = {
	[0] = 1,
	[1] = 2,
	[2] = 3,
	[3] = 4,
	[4] = 4,
	[5] = 5,
	[6] = 5,
	[7] = 5,
	[8] = 6,
}

secondary_weapon_pepernoot_speed_px = 8
secondary_weapon_pepernoot_weapon_level_cost = 2
secondary_weapon_pepernoot_max_active = 3
secondary_weapon_pepernoot_spawn_offset_x = 8
secondary_weapon_pepernoot_spawn_offset_y = 8
lithograph_hit_left_px = 6
lithograph_hit_top_px = 8
lithograph_hit_right_px = 10
lithograph_hit_bottom_px = 16
world_entrance_trigger_x_offset = room_tile_size
world_entrance_trigger_half_width = 4
world_entrance_trigger_y_offset = room_tile_size
-- MoG's world-door state at 0xe68d advances through opening states 1..3 after
-- six bottom-half updates each. State 1 retains the closed graphic, state 2
-- selects the half-open graphic and state 3 selects the open graphic; entry is
-- not admitted until the third six-update phase completes.
world_entrance_open_phase_frames = 6
-- MoG moves the player by 0x40 of its 8.8 position word per VBlank. A world
-- passage lasts 0x80 VBlanks, a shrine passage 0x40, and the ladder pose bit
-- changes every eight VBlanks. Pietious advances once per two VBlanks.
player_world_transition_frames = 64
player_shrine_transition_frames = 32
player_transition_animation_hold_frames = 4
-- MoG trap type 4 initializes its push counter to 0x1e VBlanks and advances
-- each of the four rotating-door poses after six VBlanks. Pietious admits one
-- gameplay update per two VBlanks, so the authored gameplay counts are halved.
draaideur_push_steps = 15
draaideur_pose_steps = 3
draaideur_pass_steps = 12
draaideur_pass_dx = 2
draaideur_walk_pose_steps = 2
shrine_hit_left_px = room_tile_size
shrine_hit_top_px = room_tile_size
shrine_hit_right_px = room_tile_size2
shrine_hit_bottom_px = room_tile_size2
shrine_text_x = room_tile_size * 6
shrine_text_y = room_hud_height + (room_tile_size * 5)
seal_hit_left_px = 0
seal_hit_top_px = 0
seal_hit_right_px = room_tile_size
seal_hit_bottom_px = room_tile_size
palette_sky_top_r = 0.08
palette_sky_top_g = 0.12
palette_sky_top_b = 0.2
palette_sky_top_a = 1
palette_sky_bottom_r = 0.04
palette_sky_bottom_g = 0.06
palette_sky_bottom_b = 0.11
palette_sky_bottom_a = 1
palette_castle_wall_r = 0.22
palette_castle_wall_g = 0.24
palette_castle_wall_b = 0.31
palette_castle_wall_a = 1
palette_castle_wall_dark_r = 0.14
palette_castle_wall_dark_g = 0.15
palette_castle_wall_dark_b = 0.2
palette_castle_wall_dark_a = 1
palette_stone_r = 0.36
palette_stone_g = 0.37
palette_stone_b = 0.44
palette_stone_a = 1
palette_stone_top_r = 0.5
palette_stone_top_g = 0.51
palette_stone_top_b = 0.58
palette_stone_top_a = 1
palette_window_r = 0.79
palette_window_g = 0.7
palette_window_b = 0.35
palette_window_a = 1
palette_player_body_r = 0.89
palette_player_body_g = 0.8
palette_player_body_b = 0.58
palette_player_body_a = 1
palette_player_tunic_r = 0.3
palette_player_tunic_g = 0.4
palette_player_tunic_b = 0.84
palette_player_tunic_a = 1
palette_player_air_r = 0.88
palette_player_air_g = 0.66
palette_player_air_b = 0.36
palette_player_air_a = 1
palette_player_outline_r = 0.08
palette_player_outline_g = 0.09
palette_player_outline_b = 0.13
palette_player_outline_a = 1
hud_health_level = 48
hud_weapon_level = 48
hud_health_anim_step_frames = 2
hud_weapon_anim_step_frames = 2
hud_health_bar_x = 24
hud_health_bar_y = 10
hud_weapon_bar_x = 24
hud_weapon_bar_y = 18
hud_equipped_item_x = 28
hud_equipped_item_y = 1
