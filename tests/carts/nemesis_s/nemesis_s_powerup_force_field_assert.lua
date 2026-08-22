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
		test.phase = 'activate_player_1'
		return host.press('KeyM', 2)
	end

	local player<const> = registry:get('nemesis_s.player.1')
	if player == nil or player.force_field_strength == 0 then
		return false
	end
	if test.phase == 'activate_player_1' then
		test.player_1_activation_time_ms = world.gameplay_time_ms
		test.phase = 'activate_player_2'
		return false
	end
	if test.phase == 'activate_player_2' then
		if world.gameplay_time_ms == test.player_1_activation_time_ms then
			return false
		end
		test.phase = 'wait_player_2'
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

	local kerk<const> = world:spawn(ids_kerk_def, {
		stage = player.stage,
		pos = { x = player.x, y = player.y },
	})
	assert(collide_with(player, kerk, collision_enemy_layer) == nil
		and player.force_field_strength == player_force_field_strength - 1,
		'large enemy collision bypassed the equipped force field')
	kerk:mark_for_disposal()

	local bullet<const> = world:spawn(ids_enemy_bullet_def, {
		stage = player.stage,
		pos = { x = player.x, y = player.y },
	})
	assert(bullet.force_field_hit == player_force_field_hit_standard,
		'ordinary enemy bullet lost its standard force-field impact')
	assert(collide_with(player, bullet, collision_enemy_projectile_layer) == nil
		and player.force_field_strength == player_force_field_strength - 2,
		'ordinary projectile was not absorbed for one force-field strength')
	bullet:mark_for_disposal()

	local rook<const> = world:spawn(ids_rook_def, {
		stage = player.stage,
		rise_distance = rook_rise_distances[1],
		pos = { x = player.x, y = player.y },
	})
	assert(collide_with(player, rook, collision_enemy_layer) == nil
		and player.force_field_strength == player_force_field_strength - 3,
		'small-fry collision bypassed the equipped force field')
	rook:mark_for_disposal()

	player:apply_force_field_hit(player_force_field_hit_standard)
	assert(player.force_field_strength == 1 and visual.animation == 'weak'
		and visual.imgid == visual.frames[visual.frame_index],
		'last force-field strength did not switch to the weak animation')
	player:update_position()
	assert(player.sprite.imgid == assets_player_n,
		'weak force field retained the strong vessel sprite')

	local ray<const> = world:spawn(ids_sneeuwpop_ray_def, {
		originator = { ray_disposed = function() end },
		pos = { x = player.x, y = player.y },
	})
	assert(ray.force_field_hit == player_force_field_hit_overload,
		'Sneeuwpop ray lost its overload force-field impact')
	player:activate_force_field()
	assert(collide_with(player, ray, collision_enemy_projectile_layer) == nil
		and player.force_field_strength == 1
		and state.powerup_levels[shield_slot] == 1
		and visual.enabled and visual.animation == 'weak',
		'destructive ray did not leave a strong force field at critical strength')
	assert(collide_with(player, ray, collision_enemy_projectile_layer) == nil
		and player.force_field_strength == 0
		and state.powerup_levels[shield_slot] == 0
		and not visual.enabled,
		'second destructive ray hit did not retire the critical force field')
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
