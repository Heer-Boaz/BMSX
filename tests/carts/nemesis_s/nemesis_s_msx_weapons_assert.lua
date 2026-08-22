local clock<const> = require('cartlib/clock')
local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local player_state_module<const> = require('player/player_state')
local world<const> = require('cartlib/world/world')

local selected_apu_source<const>: *word = 0x0800018c
local bullet_audio_source<const> = rom_dir.audio('nemesis2_kogeltje').addr
local laser_audio_source<const> = rom_dir.audio('nemesis2_laser').addr
local uplaser_audio_source<const> = rom_dir.audio('nemesis2_uplaser').addr
local extended_laser_audio_source<const> = rom_dir.audio('nemesis2_extended_laser').addr
local fire_effect_id<const> = 'fire_salvo'

__bmsx_host_test = {
	phase = 'weapons',
}

function __bmsx_host_test.ready()
	return registry:get('nemesis_s.director') ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = registry:get('nemesis_s.director')
	director.state_machines:transition_to('/game_start')
end

function __bmsx_host_test.update()
	if world.active_space_id == 'game_start' then
		local director<const> = registry:get(ids_director_instance)
		if director.status_bar ~= nil then
			director.state_machines:transition_to('/gameplay')
		end
		return false
	end
	local test<const> = __bmsx_host_test
	local player<const> = registry:get('nemesis_s.player.1')
	if player == nil then
		return false
	end
	if test.phase == 'repeat' then
		local repeat_period_ms<const> = 15 * clock.gameplay_delta_milliseconds()
		local repeat_deadline_ms<const> = repeat_period_ms + clock.gameplay_delta_milliseconds()
		local elapsed_ms<const> = world.gameplay_time_ms - test.repeat_start_ms
		if elapsed_ms < repeat_period_ms
		or (test.salvo_count == 1 and elapsed_ms <= repeat_deadline_ms) then
			assert(test.salvo_count == 1,
				'the held-fire effect repeated before the original E437 counter reached fifteen')
			return false
		end
		assert(test.salvo_count == 2,
			'the held-fire effect did not repeat at the original E437 cadence')
		assert(elapsed_ms <= repeat_deadline_ms,
			'the held-fire effect skipped its first repeat boundary')
		player.actioneffects:deactivate(fire_effect_id)
		return true
	end
	local stage<const> = player.stage
	for row_index = 1, stage.tile_rows do
		local row<const> = stage.solid_tape[row_index]
		for column = 1, 40 do
			row[column] = 0
		end
	end

	local max_levels<const> = player_state_module.powerup_max_levels
	assert(max_levels[player_state_module.powerup_slot.missile] == 3,
		'the power-up gauge lost the third-level Napalm missile')
	assert(max_levels[player_state_module.powerup_slot.laser] == 3,
		'the power-up gauge lost the third-level Extended Laser')
	assert(player_state_module.powerup_slot.uplaser == player_state_module.powerup_slot.laser + 1
		and max_levels[player_state_module.powerup_slot.uplaser] == 2,
		'the unlocked up-laser lost its MSX gauge position or two weapon levels')

	player.x = 41
	player.y = 25
	local primary<const> = player.primary_projectiles[1]
	local secondary<const> = player.secondary_projectiles[1]
	player:spawn_bullet(player, primary)
	assert(*selected_apu_source == bullet_audio_source,
		'the retained bullet spawn did not emit its XNA fire cue')
	assert(primary.x == 48 and primary.y == 31,
		'the MSX bullet spawn anchor was not restored')
	assert(primary.collider.local_area.right == 8 and primary.collider.local_area.bottom == 2,
		'the bullet did not publish its original collision record at admission')
	player:update_weapons()
	assert(primary.type ~= 0 and primary.x == 60,
		'the MSX bullet did not advance twelve pixels per gameplay tick')
	player:despawn_slot_projectile(primary, 'test_reset')
	player:spawn_bullet(player, primary)
	assert(player.primary_projectiles[1] == primary,
		'firing allocated a replacement projectile instead of reusing the retained vessel slot')
	local bullet_collision_column<const> = ((primary.x + player_bullet_movement_speed
		- player_bullet_collision_backtrack + stage.total_scroll_px) // stage.tile_size) + 1
	stage.solid_tape[(primary.y // stage.tile_size) + 1][bullet_collision_column] = 1
	player:update_weapons()
	assert(primary.type == 0, 'the bullet skipped the MSX swept tile collision sample')
	stage.solid_tape[(31 // stage.tile_size) + 1][bullet_collision_column] = 0

	player:fire_weapon_salvo()
	player:fire_weapon_salvo()
	assert(primary.type == 1 and secondary.type == 1,
		'the two original general weapon records did not admit two bullets per vessel')
	player:fire_weapon_salvo()
	assert(primary.type == 1 and secondary.type == 1,
		'a third bullet escaped the two retained general weapon records')
	player:update_weapons()
	assert(primary.x == 60 and secondary.x == 60,
		'the second retained bullet slot did not run the bullet datapath')
	player:despawn_slot_projectile(primary, 'test_reset')
	player:despawn_slot_projectile(secondary, 'test_reset')

	player:spawn_laser(player, 1)
	assert(*selected_apu_source == laser_audio_source,
		'the retained laser spawn did not emit its XNA fire cue')
	assert(primary.collider.local_area.right == 0 and primary.collider.local_area.bottom == 2,
		'the laser did not publish its empty expansion record at admission')
	player.x = 49
	player.y = 29
	player:update_weapons()
	assert(primary.length_tiles == 4 and primary.x == 64 and primary.y == 35,
		'the expanding laser did not follow its source vessel')
	player.x = 57
	player.y = 33
	for expected_length = 8, 12, 4 do
		player:update_weapons()
		assert(primary.length_tiles == expected_length,
			'the laser did not expand by four retained tiles per gameplay tick')
	end
	player:update_weapons()
	assert(primary.length_tiles == 15 and primary.x == 72 and primary.y == 39,
		'the level-one laser did not retain the fifteen-tile MSX extent')
	player.x = 1
	player.y = 1
	player:update_weapons()
	assert(primary.x == 104 and primary.y == 39 and primary.length_tiles == 15,
		'the completed laser remained attached instead of entering its independent 32-pixel travel phase')
	player:despawn_slot_projectile(primary, 'test_reset')

	player.x = 41
	player.y = 25
	player:spawn_missile(player, 1)
	local missile<const> = player.missile_projectiles[1]
	assert(missile.collider.local_area.right == 8 and missile.collider.local_area.bottom == 2,
		'the missile did not publish its original collision record at admission')
	player:update_weapons()
	assert(missile.x == 50 and missile.y == 36,
		'the level-one missile did not use the MSX 1px/4px falling vector')
	player:despawn_missile(missile, 'test_reset')
	player:spawn_missile(player, 2)
	player:update_weapons()
	assert(missile.x == 50 and missile.fraction_x == 0x80 and missile.y == 38,
		'the level-two missile did not retain its Q8.8 one-and-a-half-pixel falling motion')
	player:update_weapons()
	assert(missile.x == 52 and missile.fraction_x == 0 and missile.y == 44,
		'the level-two missile did not consume its retained Q8.8 fraction')
	player:despawn_missile(missile, 'test_reset')
	player:spawn_missile(player, 3)
	assert(missile.type == 5,
		'the third missile level did not admit the source ROM Napalm record')
	player:update_weapons()
	assert(missile.x == 50 and missile.fraction_x == 0x80 and missile.y == 38,
		'the Napalm missile diverged from the level-two MSX flight vector')
	local napalm_hit_count = 0
	local napalm_target<const> = {
		receive_player_projectile = function(_self, projectile)
			assert(projectile == missile, 'the Napalm overlap resolved a different retained slot')
			napalm_hit_count = napalm_hit_count + 1
			return true
		end,
	}
	player:resolve_projectile_overlap(
		missile.collider.id_local,
		napalm_target,
		0,
		{ x = 0, y = 0 },
		'begin'
	)
	assert(missile.type == 6
		and missile.collider.local_area.right == weapons_napalm.blast_width
		and missile.collider.local_area.bottom == weapons_napalm.blast_height,
		'the Napalm impact did not convert its retained missile slot into the 24px blast')
	player:resolve_projectile_overlap(
		missile.collider.id_local,
		napalm_target,
		0,
		{ x = 0, y = 0 },
		'stay'
	)
	assert(napalm_hit_count == 2,
		'the retained Napalm blast did not continue damaging an overlapping target')
	player:update_weapons()
	assert(missile.blast_phase == 1 and missile.blast_frame == 2
		and missile.fragment_ticks == weapons_napalm.fragment_lifetime_ticks
		and missile.fragment_offset_x == -8 and missile.fragment_offset_y == -8,
		'the Napalm blast did not admit its first ROM-authored fragment phase')
	local scroll_before_napalm<const> = stage.total_scroll_px
	stage.total_scroll_px = scroll_before_napalm + stage.tile_size
	local blast_x<const> = missile.x
	player:update_weapons()
	assert(missile.x == blast_x - stage.tile_size,
		'the retained Napalm blast did not follow the source stage-scroll step')
	for _ = 3, 20 do
		player:update_weapons()
	end
	assert(missile.type == 6 and missile.blast_phase == 4,
		'the four Napalm fragment phases ended before their source cadence')
	player:update_weapons()
	assert(missile.type == 0,
		'the Napalm blast remained resident after its fourth source phase')
	stage.total_scroll_px = scroll_before_napalm
	player.y = playfield_height - player_height
	player:spawn_missile(player, 1)
	assert(missile.type == 0,
		'a missile originating below its playfield lifetime entered the terrain query')
	player.y = 25

	local floor_row<const> = stage.solid_tape[((32 + 8) // stage.tile_size) + 1]
	local missile_column<const> = ((49 + stage.total_scroll_px) // stage.tile_size) + 1
	floor_row[missile_column + 1] = 1
	player:spawn_missile(player, 1)
	player:update_weapons()
	assert(missile.x == 53 and missile.y == 32,
		'the missile ignored the second tile in its original floor probe')
	player:despawn_missile(missile, 'test_reset')
	floor_row[missile_column] = 1
	floor_row[missile_column + 1] = 0
	player:spawn_missile(player, 1)
	player:update_weapons()
	assert(missile.x == 53 and missile.y == 36,
		'the missile did not traverse an original floor-edge sample')
	player:despawn_missile(missile, 'test_reset')
	floor_row[missile_column + 1] = 1
	local missile_row<const> = stage.solid_tape[(32 // stage.tile_size) + 1]
	missile_row[missile_column + 1] = 1
	player:spawn_missile(player, 1)
	player:update_weapons()
	assert(missile.type == 0,
		'the missile skipped the second tile in its original body probe')
	missile_row[missile_column + 1] = 0
	floor_row[missile_column] = 0
	floor_row[missile_column + 1] = 0

	local uplaser_slot<const> = player_state_module.powerup_slot.uplaser
	player.player_state.current_powerup_slot = uplaser_slot
	assert(player.player_state:activate_selected_powerup() == uplaser_slot,
		'the unlocked up-laser could not be selected from the power-up gauge')
	player.player_state.current_powerup_slot = uplaser_slot
	assert(player.player_state:activate_selected_powerup() == uplaser_slot,
		'the second up-laser level could not be selected from the power-up gauge')
	player:fire_weapon_salvo()
	local uplaser<const> = player.secondary_projectiles[1]
	assert(*selected_apu_source == uplaser_audio_source,
		'the up-laser did not emit its dedicated Nemesis 2 sound command')
	assert(uplaser.x == 40 and uplaser.y == 31,
		'the up-laser did not retain its original vessel anchor')
	assert(uplaser.collider.local_area.right == 16 and uplaser.collider.local_area.bottom == 8,
		'the up-laser did not publish its original collision record at admission')
	for _ = 1, 4 do
		player:update_weapons()
	end
	assert(uplaser.y == 7 and uplaser.x == 32 and uplaser.length_tiles == 4,
		'the level-two up-laser did not apply its four-tick symmetric growth gate')
	player:despawn_slot_projectile(uplaser, 'test_reset')

	player.x = 1
	player.y = 25
	player:spawn_laser(player, 3)
	assert(*selected_apu_source == extended_laser_audio_source,
		'the Extended Laser did not supersede the up-laser sound channel')
	assert(primary.type == 8 and primary.collider.local_area.bottom == 8,
		'the third laser level did not admit the source ROM thick-beam record')
	for expected_length = 5, 25, 5 do
		player:update_weapons()
		assert(primary.length_tiles == expected_length,
			'the Extended Laser did not expand by five retained tiles per gameplay tick')
	end
	player:update_weapons()
	assert(primary.length_tiles == 28 and primary.x == 16
		and primary.collider.local_area.right == 224
		and primary.collider.local_area.bottom == 8,
		'the Extended Laser did not retain its 28x8-tile source extent')
	player.x = 121
	player:update_weapons()
	assert(primary.x == 48 and primary.length_tiles == 26,
		'the completed Extended Laser did not enter its independent travel phase')
	player:despawn_slot_projectile(primary, 'test_reset')

	test.salvo_count = 0
	player.fire_weapon_salvo = function()
		test.salvo_count = test.salvo_count + 1
	end
	player.actioneffects:activate(fire_effect_id)
	player.actioneffects:trigger(fire_effect_id)
	assert(test.salvo_count == 1, 'the initial fire edge did not admit its immediate salvo')
	test.repeat_start_ms = world.gameplay_time_ms
	test.phase = 'repeat'
	return false
end
