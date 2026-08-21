local clock<const> = require('cartlib/clock')
local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local player_state_module<const> = require('player/player_state')
local world<const> = require('cartlib/world/world')

local selected_apu_source<const>: *word = 0x0800018c
local bullet_audio_source<const> = rom_dir.audio('nemesis2_kogeltje').addr
local laser_audio_source<const> = rom_dir.audio('nemesis2_laser').addr
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
	director.state_machines:transition_to('/gameplay')
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	local player<const> = registry:get('nemesis_s.player.1')
	if player == nil then
		return false
	end
	if test.phase == 'repeat' then
		local repeat_period_ms<const> = 15 * clock.update_milliseconds()
		local repeat_deadline_ms<const> = repeat_period_ms + clock.update_milliseconds()
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
	assert(max_levels[player_state_module.powerup_slot.missile] == 2,
		'the standard missile lost its two MSX speed levels')
	assert(max_levels[player_state_module.powerup_slot.laser] == 2,
		'the standard laser lost its two MSX length levels')

	player.x = 41
	player.y = 25
	local primary<const> = player.primary_projectiles[1]
	local secondary<const> = player.secondary_projectiles[1]
	player:spawn_bullet(1, primary)
	assert(*selected_apu_source == bullet_audio_source,
		'the retained bullet spawn did not emit its XNA fire cue')
	assert(primary.x == 48 and primary.y == 33,
		'the MSX bullet spawn anchor was not restored')
	assert(primary.collider.local_area.right == 8 and primary.collider.local_area.bottom == 2,
		'the bullet did not publish its original collision record at admission')
	player:update_weapons()
	assert(primary.type ~= 0 and primary.x == 60,
		'the MSX bullet did not advance twelve pixels per gameplay tick')
	player:despawn_slot_projectile(primary, 'test_reset')
	player:spawn_bullet(1, primary)
	assert(player.primary_projectiles[1] == primary,
		'firing allocated a replacement projectile instead of reusing the retained vessel slot')
	local bullet_collision_column<const> = ((primary.x + player_bullet_movement_speed
		- player_bullet_collision_backtrack + stage.total_scroll_px) // stage.tile_size) + 1
	stage.solid_tape[(primary.y // stage.tile_size) + 1][bullet_collision_column] = 1
	player:update_weapons()
	assert(primary.type == 0, 'the bullet skipped the MSX swept tile collision sample')
	stage.solid_tape[(33 // stage.tile_size) + 1][bullet_collision_column] = 0

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

	player:spawn_laser(1, 1)
	assert(*selected_apu_source == laser_audio_source,
		'the retained laser spawn did not emit its XNA fire cue')
	assert(primary.collider.local_area.right == 0 and primary.collider.local_area.bottom == 2,
		'the laser did not publish its empty expansion record at admission')
	for expected_length = 4, 12, 4 do
		player:update_weapons()
		assert(primary.length_tiles == expected_length,
			'the laser did not expand by four retained tiles per gameplay tick')
	end
	player:update_weapons()
	assert(primary.length_tiles == 15 and primary.x == 56 and primary.y == 33,
		'the level-one laser did not retain the fifteen-tile MSX extent')
	player:update_weapons()
	assert(primary.x == 88 and primary.length_tiles == 15,
		'the completed laser did not enter its 32-pixel travel phase')
	player:despawn_slot_projectile(primary, 'test_reset')

	player:spawn_missile(1, 1)
	local missile<const> = player.missile_projectiles[1]
	assert(missile.collider.local_area.right == 8 and missile.collider.local_area.bottom == 2,
		'the missile did not publish its original collision record at admission')
	player:update_weapons()
	assert(missile.x == 50 and missile.y == 37,
		'the level-one missile did not use the MSX 1px/4px falling vector')
	player:despawn_missile(missile, 'test_reset')
	player:spawn_missile(1, 2)
	player:update_weapons()
	assert(missile.x == 50 and missile.fraction_x == 0x80 and missile.y == 39,
		'the level-two missile did not retain its Q8.8 one-and-a-half-pixel falling motion')
	player:update_weapons()
	assert(missile.x == 52 and missile.fraction_x == 0 and missile.y == 45,
		'the level-two missile did not consume its retained Q8.8 fraction')
	player:despawn_missile(missile, 'test_reset')

	local floor_row<const> = stage.solid_tape[((33 + 8) // stage.tile_size) + 1]
	local missile_column<const> = ((49 + stage.total_scroll_px) // stage.tile_size) + 1
	floor_row[missile_column + 1] = 1
	player:spawn_missile(1, 1)
	player:update_weapons()
	assert(missile.x == 50 and missile.y == 37,
		'the missile did not fall when its original left floor sample was clear')
	player:despawn_missile(missile, 'test_reset')
	floor_row[missile_column] = 1
	floor_row[missile_column + 1] = 0
	player:spawn_missile(1, 1)
	player:update_weapons()
	assert(missile.x == 53 and missile.y == 37,
		'the missile did not traverse an original floor-edge sample')
	player:despawn_missile(missile, 'test_reset')
	floor_row[missile_column] = 0
	local missile_row<const> = stage.solid_tape[(33 // stage.tile_size) + 1]
	missile_row[missile_column] = 1
	player:spawn_missile(1, 1)
	player:update_weapons()
	assert(missile.type == 0,
		'the missile skipped its original post-movement body tile sample')
	missile_row[missile_column] = 0

	player:spawn_uplaser(1, 2)
	local uplaser<const> = player.secondary_projectiles[1]
	assert(uplaser.collider.local_area.right == 16 and uplaser.collider.local_area.bottom == 8,
		'the up-laser did not publish its original collision record at admission')
	for _ = 1, 4 do
		player:update_weapons()
	end
	assert(uplaser.y == 9 and uplaser.x == 32 and uplaser.length_tiles == 4,
		'the level-two up-laser did not apply its four-tick symmetric growth gate')

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
