local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')

__bmsx_host_test = {
	frames = 0,
	phase = 'spawn',
	saw_hit_recovery = false,
}

function __bmsx_host_test.setup()
	new_game()
end

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil and registry:get('room') ~= nil and registry:get('pietolon') ~= nil
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 300, 'player damage scenario timed out phase=' .. test.phase)
	if world.active_space_id ~= 'main' then
		return false
	end

	local player<const> = registry:get('pietolon')
	if test.phase == 'spawn' then
		player.state_machines:transition_to('/quiet')
		player:clear_input_state()
		player:zero_motion()
		player:cancel_sword()
		player:reset_hit_invulnerability_sequence()
		player.health = player.max_health
		player.x = player_start_x
		player.y = player_start_y
		test.quiet_state = player.state_machines:bind_state_path('/quiet')
		test.hit_fall_state = player.state_machines:bind_state_path('/hit_fall')
		test.hit_recovery_state = player.state_machines:bind_state_path('/hit_recovery')
		world:spawn('enemy.crossfoe', {
			id = 'probe.damage',
			space_id = 'main',
			castle = registry:get('c'),
			room = registry:get('room'),
			player = player,
			pos = { x = 0, y = player_start_y, z = 110 },
			damage = damage_enemy_contact_damage,
		})
		test.phase = 'first_contact'
		return false
	end

	local probe<const> = registry:get('probe.damage')
	assert(probe ~= nil, 'damage probe was not admitted')
	if test.phase == 'first_contact' then
		probe.events:emit('overlap.begin', {
			other_id = player.id,
			other_kind = 'player',
			other_layer = collision_player_layer,
			other_collider_local_id = 'body',
			phase = 'begin',
		})
		local hit_health<const> = player.max_health - probe.damage
		assert(player.health == hit_health, 'enemy contact did not damage the player')
		assert(player.hit_invulnerability_timer == damage_hit_invulnerability_frames,
			'enemy contact did not start hit invulnerability')
		assert(player.state_machines:matches_state(test.hit_fall_state), 'enemy contact did not enter hit-fall')

		probe.events:emit('overlap.begin', {
			other_id = player.id,
			other_kind = 'player',
			other_layer = collision_player_layer,
			other_collider_local_id = 'body',
			phase = 'begin',
		})
		assert(player.health == hit_health, 'invulnerability admitted a second contact hit')
		test.hit_health = hit_health
		test.phase = 'recover'
		return false
	end

	if test.phase == 'recover' then
		assert(player.health == test.hit_health, 'player health changed during hit invulnerability')
		if player.state_machines:matches_state(test.hit_recovery_state) then
			test.saw_hit_recovery = true
		end
		if player.hit_invulnerability_timer > 0 or not player.state_machines:matches_state(test.quiet_state) then
			return false
		end
		assert(test.saw_hit_recovery, 'hit-fall skipped hit recovery')
		probe.events:emit('overlap.begin', {
			other_id = player.id,
			other_kind = 'player',
			other_layer = collision_player_layer,
			other_collider_local_id = 'body',
			phase = 'begin',
		})
		assert(player.health == test.hit_health - probe.damage,
			'player did not become hittable after invulnerability expired')
		assert(player.state_machines:matches_state(test.hit_fall_state), 'second accepted hit did not enter hit-fall')
		assert(player.hit_invulnerability_timer == damage_hit_invulnerability_frames,
			'second accepted hit did not restart invulnerability')
		return true
	end

	return false
end
