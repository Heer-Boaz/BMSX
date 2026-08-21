local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')
local player_state<const> = require('player/player_state')
require('constants')

local selected_apu_source<const>: *word = 0x0800018c
local option_pickup_source<const> = rom_dir.audio('nemesis3_option_take').addr
local player_death_source<const> = rom_dir.audio('player_death').addr
local option_slot<const> = player_state.powerup_slot.option

__bmsx_host_test = {
	frames = 0,
	phase = 'setup',
}

function __bmsx_host_test.ready()
	return registry:get(ids_director_instance) ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = registry:get(ids_director_instance)
	director.state_machines:transition_to('/game_start')
	__bmsx_host_test.pickups = world:active_definition_view(ids_option_pickup_def)
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
	test.frames = test.frames + 1
	assert(test.frames < 180, 'Nemesis S option-recovery scenario timed out phase=' .. test.phase)

	local player<const> = registry:get(player_starts[1].id)
	if player == nil or world.active_space_id ~= 'main' then
		return false
	end

	if test.phase == 'setup' then
		player.player_state.current_powerup_slot = option_slot
		assert(player.player_state:activate_selected_powerup() == option_slot)
		player.player_state.current_powerup_slot = option_slot
		assert(player.player_state:activate_selected_powerup() == option_slot)
		player.options[1].x = 20
		player.options[1].y = 40
		player.options[2].x = 200
		player.options[2].y = 80
		player:spawn_laser(player.options[2], 1)
		test.option_laser = player.primary_projectiles[3]
		test.animation_frame = player.option_anim_index
		test.gameplay_time_ms = world.gameplay_time_ms
		test.phase = 'animation'
		return false
	end

	if test.phase == 'animation' then
		if world.gameplay_time_ms == test.gameplay_time_ms
		or player.option_anim_index == test.animation_frame then
			return false
		end
		player.state_machines:transition_to('/dying')
		assert(player.player_state.powerup_levels[option_slot] == 0,
			'player death did not clear the equipped options')
		assert(#player.options == 0, 'player death retained attached option vessels')
		assert(test.option_laser.type ~= 0 and test.option_laser.collider.enabled,
			'player death removed an independently admitted option projectile')
		local pickups<const> = test.pickups.objects
		assert(#pickups == 2, 'player death did not publish one pickup per option')
		assert(pickups[1].x == 148 and pickups[1].y == 40,
			'first option pickup did not retain the authored XNA displacement')
		assert(pickups[2].x == playfield_width and pickups[2].y == 80,
			'second option pickup did not clamp at the playfield edge')
		test.pickup_x = pickups[1].x
		test.animation_frame = player.option_anim_index
		test.gameplay_time_ms = world.gameplay_time_ms
		test.phase = 'floating'
		return false
	end

	if test.phase == 'floating' then
		if world.gameplay_time_ms == test.gameplay_time_ms
		or player.option_anim_index == test.animation_frame then
			return false
		end
		local pickups<const> = test.pickups.objects
		assert(pickups[1].x < test.pickup_x,
			'detached option did not consume its retained fixed-point velocity')
		player.state_machines:transition_to('/active/respawning')
		assert(player.body_collider.enabled
			and player.body_collider.mask == collision_pickup_layer,
			'respawning player did not retain pickup collision admission')
		pickups[1].x = player.x
		pickups[1].y = player.y
		pickups[2].y = playfield_height
		test.phase = 'collect_first'
		return false
	end

	if test.phase == 'collect_first' then
		if #test.pickups.objects == 2 then
			return false
		end
		assert(player.player_state.powerup_levels[option_slot] == 1,
			'detached option did not restore the concrete option power-up')
		assert(#player.options == 1,
			'option pickup did not restore one retained option vessel')
		assert(*selected_apu_source == player_death_source,
			'option pickup interrupted the higher-priority player death cue')
		test.phase = 'wait_for_death_audio'
		return false
	end

	if test.phase == 'wait_for_death_audio' then
		if *selected_apu_source == player_death_source then
			return false
		end
		local pickup<const> = test.pickups.objects[1]
		pickup.x = player.x
		pickup.y = player.y
		test.phase = 'collect_second'
		return false
	end

	if #test.pickups.objects > 0 then
		return false
	end
	assert(player.player_state.powerup_levels[option_slot] == 2,
		'second detached option did not restore the authored maximum')
	assert(#player.options == 2,
		'second option pickup did not restore the second option vessel')
	assert(*selected_apu_source == option_pickup_source,
		'option pickup did not select the authored XNA retrieval cue')
	player.state_machines:transition_to('/active/flying')
	assert(player.body_collider.mask == collision_player_mask,
		'completed respawn did not restore the player collision mask')
	return true
end
