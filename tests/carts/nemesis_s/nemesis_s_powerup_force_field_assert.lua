local registry<const> = require('cartlib/registry')
local player_state_module<const> = require('player/player_state')
local world<const> = require('cartlib/world/world')
require('constants')

local shield_slot<const> = player_state_module.powerup_slot.shield

local overlap_event<const> = {
	collider_local_id = 0,
	other_id = false,
	other_layer = 0,
}

local collide_with<const> = function(player, other, layer)
	overlap_event.other_id = other.id
	overlap_event.other_layer = layer
	return player:on_body_overlap(nil, overlap_event)
end

__bmsx_host_test = {
	frames = 0,
	phase = 'wait_game_start',
	gameplay_steps_since_skip = 0,
	stable_host_frames = 0,
	observed_skip = false,
	last_gameplay_time_ms = 0,
}

function __bmsx_host_test.ready()
	return registry:get(ids_director_instance) ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = registry:get(ids_director_instance)
	director.player_count = 2
	director.state_machines:transition_to('/game_start')
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 100, 'Nemesis S force-field scenario timed out')

	if test.phase == 'wait_game_start' then
		local director<const> = registry:get(ids_director_instance)
		if director.status_bar == nil then
			return false
		end
		director.state_machines:transition_to('/gameplay')
		for player_index = 1, 2 do
			local state<const> = director.player_states[player_index]
			for _ = 1, shield_slot do
				state:advance_powerup_selection()
			end
		end
		test.phase = 'wait_for_skip_cycle'
		test.last_gameplay_time_ms = world.gameplay_time_ms
		return false
	end
	if test.phase == 'wait_for_skip_cycle' then
		local gameplay_time_ms<const> = world.gameplay_time_ms
		if gameplay_time_ms == test.last_gameplay_time_ms then
			test.stable_host_frames = test.stable_host_frames + 1
			if test.stable_host_frames == 3 then
				test.observed_skip = true
				test.gameplay_steps_since_skip = 0
			end
		else
			test.stable_host_frames = 0
			if test.observed_skip then
				test.gameplay_steps_since_skip = test.gameplay_steps_since_skip + 1
			end
		end
		test.last_gameplay_time_ms = gameplay_time_ms
		if test.gameplay_steps_since_skip == 5 then
			test.phase = 'activate'
			return host.press('KeyM', 2)
		end
		return false
	end

	local player<const> = registry:get('nemesis_s.player.1')
	if player == nil or player.force_field_strength == 0 then
		return false
	end
	if test.phase == 'activate' then
		test.phase = 'activate_player_2'
		return host.press('AltLeft', 2)
	end
	local player_2<const> = registry:get('nemesis_s.player.2')
	if player_2.force_field_strength == 0 then
		return false
	end
	local state<const> = player.player_state
	local visual<const> = player.force_field_visual
	local visual_2<const> = player_2.force_field_visual
	assert(state.current_powerup_slot == player_state_module.no_powerup_slot
		and state.powerup_levels[shield_slot] == 1,
		'power-up input did not consume the selected shield slot')
	assert(player.force_field_strength == player_force_field_strength
		and visual.enabled and visual.animation == 'strong',
		'shield activation did not publish the retained strong force-field visual')
	assert(visual.offset_y == player_force_field_offset_y and visual.offset_z == -1,
		'force field did not retain the XNA player-relative draw placement')
	assert(visual.frame_index == visual_2.frame_index
		and visual.elapsed_ms == visual_2.elapsed_ms,
		'force fields acquired on different ticks did not share the XNA animation phase')
	player:update_position()
	assert(player.sprite.imgid == assets_player_n_shield,
		'strong force field did not select the XNA neutral vessel sprite')

	local bullet<const> = world:spawn(ids_enemy_bullet_def, {
		stage = player.stage,
		pos = { x = player.x, y = player.y },
	})
	assert(not bullet.destroys_shield,
		'ordinary enemy bullet acquired destructive force-field damage')
	assert(collide_with(player, bullet, collision_enemy_projectile_layer) == nil
		and player.force_field_strength == player_force_field_strength - 1,
		'ordinary projectile was not absorbed for one force-field strength')
	bullet:mark_for_disposal()

	local rook<const> = world:spawn(ids_rook_def, {
		stage = player.stage,
		rise_distance = rook_rise_distances[1],
		pos = { x = player.x, y = player.y },
	})
	assert(collide_with(player, rook, collision_enemy_layer) == nil
		and player.force_field_strength == player_force_field_strength - 2,
		'small-fry collision bypassed the equipped force field')
	rook:mark_for_disposal()

	player:damage_force_field(false)
	player:damage_force_field(false)
	assert(player.force_field_strength == 1 and visual.animation == 'weak'
		and visual.imgid == visual.frames[visual.frame_index],
		'last force-field strength did not switch to the weak animation')
	player:update_position()
	assert(player.sprite.imgid == assets_player_n,
		'weak force field retained the strong vessel sprite')

	local kerk<const> = world:spawn(ids_kerk_def, {
		stage = player.stage,
		pos = { x = player.x, y = player.y },
	})
	assert(collide_with(player, kerk, collision_enemy_layer) == '/dying',
		'large enemy collision was incorrectly absorbed by the force field')
	kerk:mark_for_disposal()

	local ray<const> = world:spawn(ids_sneeuwpop_ray_def, {
		originator = { ray_disposed = function() end },
		pos = { x = player.x, y = player.y },
	})
	assert(ray.destroys_shield,
		'Sneeuwpop ray lost its one-blow force-field damage contract')
	assert(collide_with(player, ray, collision_enemy_projectile_layer) == nil
		and player.force_field_strength == 0
		and state.powerup_levels[shield_slot] == 0
		and not visual.enabled,
		'destructive ray did not consume and retire the force field')
	ray:mark_for_disposal()

	state.current_powerup_slot = shield_slot
	assert(state:activate_selected_powerup() ~= nil,
		'depleted shield power-up could not be acquired again')
	assert(player.force_field_visual == visual and visual.enabled,
		'shield reacquisition replaced its retained visual component')
	state.current_powerup_slot = shield_slot
	assert(state:activate_selected_powerup() == nil
		and state.current_powerup_slot == shield_slot,
		'full shield slot was activated more than once')
	return true
end
