local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		player_damage = function(t)
			local _director<const>, _castle<const>, player<const> = fixture.start_game(t)
			local test<const> = {saw_hit_recovery = false}
			player.state_machines:transition_to('/quiet')
			player:clear_input_state()
			player:zero_motion()
			player:cancel_sword()
			player.status.health = player.status.max_health
			player.x = player.status.spawn_x
			player.y = player.status.spawn_y
			test.quiet_state = player.state_machines:bind_state_path('/quiet')
			test.hit_fall_state = player.state_machines:bind_state_path('/hit_fall')
			test.hit_recovery_state = player.state_machines:bind_state_path('/hit_recovery')
			registry:get('c').room.scene:spawn('enemy.crossfoe', {
				id = 'probe.damage',
				space_id = 'main',
				castle = registry:get('c'),
				room = registry:get('c').room,
				player = player,
				pos = { x = 0, y = player.status.spawn_y, z = 110 },
				damage = damage_enemy_contact_damage,
			})

			t:at_boundary(world:request_mutation_boundary(), 30)
			local probe<const> = registry:get('probe.damage')
			assert(probe ~= nil, 'damage probe was not admitted')
			probe.events:emit('overlap.begin', {
				other_id = player.id,
				other_kind = 'player',
				other_layer = collision_player_layer,
				other_collider_local_id = 'body',
				phase = 'begin',
			})
			local hit_health<const> = player.status.max_health - probe.damage
			assert(player.status.health == hit_health, 'enemy contact did not damage the player')
			assert(not player:is_hittable(),
			'enemy contact did not start hit invulnerability')
			assert(player.state_machines:matches_state(test.hit_fall_state), 'enemy contact did not enter hit-fall')

			probe.events:emit('overlap.begin', {
				other_id = player.id,
				other_kind = 'player',
				other_layer = collision_player_layer,
				other_collider_local_id = 'body',
				phase = 'begin',
			})
			assert(player.status.health == hit_health, 'invulnerability admitted a second contact hit')
			test.hit_health = hit_health

			t:wait_until('hit recovery', function()
				assert(player.status.health == test.hit_health, 'health changed during hit invulnerability')
				if player.state_machines:matches_state(test.hit_recovery_state) then test.saw_hit_recovery = true end
				return player:is_hittable() and player.state_machines:matches_state(test.quiet_state)
			end, 300)
			assert(test.saw_hit_recovery, 'hit-fall skipped hit recovery')
			probe.events:emit('overlap.begin', {
				other_id = player.id,
				other_kind = 'player',
				other_layer = collision_player_layer,
				other_collider_local_id = 'body',
				phase = 'begin',
			})
			assert(player.status.health == test.hit_health - probe.damage,
			'player did not become hittable after invulnerability expired')
			assert(player.state_machines:matches_state(test.hit_fall_state), 'second accepted hit did not enter hit-fall')
			assert(not player:is_hittable(),
			'second accepted hit did not restart invulnerability')
		end,
	},
}
