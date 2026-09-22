local fixture<const> = require('tests/carts/nemesis_s/fixture')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local player_state_module<const> = require('player/player_state')
require('constants')
local passwords<const> = {
	metalion = {
		'KeyM', 'KeyE', 'KeyT', 'KeyA', 'KeyL', 'KeyI', 'KeyO', 'KeyN', 'Enter',
	},
	lars18th = {
		'KeyL', 'KeyA', 'KeyR', 'KeyS', 'Digit1', 'Digit8', 'KeyT', 'KeyH', 'Enter',
	},
}
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
return { kind = 'integration', tests = { passwords_apply_to_both_paused_players = function(t)
			local director<const> = fixture.start_game(t, 2)
			local player_1<const> = director.players[1]
			local player_2<const> = director.players[2]
			local pause_state<const> = director.state_machines:bind_state_path('/gameplay/pause')
			t:press('F1', 4)
			t:wait_until('paused password input', function() return director.state_machines:matches_state(pause_state) and not world.gameplay_clock_running end, 120)
			local test<const> = { player_frame = player_1.frame }
			for _, code in ipairs(passwords.metalion) do t:press(code, 2) end
			t:wait_until('Metalion enabled', function() return player_1.metalion_cheat_active end, 120)
			assert(not world.gameplay_clock_running and player_1.frame == test.player_frame,
			'Metalion password advanced the suspended gameplay schedule')
			assert(director.metalion_cheat_active
			and player_1.metalion_cheat_active
			and player_2.metalion_cheat_active,
			'Metalion cheat was not applied to both players')
			assert(player_1.sprite.imgid == assets_player_cheat_n,
			'Metalion cheat did not publish the player-one green vessel source')
			assert(player_2.sprite.imgid == assets_player_2_cheat_n,
			'Metalion cheat did not publish the player-two cyan vessel source')

			local bullet<const> = registry:get('nemesis_s.director').gameplay:spawn(ids_enemy_bullet_def, {
				stage = player_1.stage,
				pos = { x = player_1.x, y = player_1.y },
			})
			assert(collide_with(player_1, bullet, collision_enemy_projectile_layer) == nil,
			'Metalion cheat admitted ordinary projectile damage')
			bullet:mark_for_disposal()

			local rook<const> = registry:get('nemesis_s.director').gameplay:spawn(ids_rook_def, {
				stage = player_1.stage,
				rise_distance = rook_rise_distances[1],
				pos = { x = player_1.x, y = player_1.y },
			})
			assert(collide_with(player_1, rook, collision_enemy_layer) == nil,
			'Metalion cheat admitted small-fry contact damage')
			rook:mark_for_disposal()

			local kerk<const> = registry:get('nemesis_s.director').gameplay:spawn(ids_kerk_def, {
				stage = player_1.stage,
				pos = { x = player_1.x, y = player_1.y },
			})
			assert(collide_with(player_1, kerk, collision_enemy_layer) == '/dying',
			'Metalion cheat suppressed substantial stage-object contact')
			kerk:mark_for_disposal()

			for _, code in ipairs(passwords.metalion) do t:press(code, 2) end
			t:wait_until('Metalion disabled', function() return not player_1.metalion_cheat_active end, 120)
			assert(not director.metalion_cheat_active
			and not player_1.metalion_cheat_active
			and not player_2.metalion_cheat_active,
			'entering Metalion twice did not disable the cheat')
			assert(player_1.sprite.imgid == assets_player_n,
			'disabling Metalion did not restore player one')
			assert(player_2.sprite.imgid == assets_player_2_n,
			'disabling Metalion did not restore the purple player two')

			for _, code in ipairs(passwords.lars18th) do t:press(code, 2) end
			local powerup_slot<const> = player_state_module.powerup_slot
			local maximum_levels<const> = player_state_module.powerup_max_levels
			for player_index = 1, #director.player_states do
				local state<const> = director.player_states[player_index]
				local active_player<const> = director.players[player_index]
				assert(state.powerup_levels[powerup_slot.speed] == 0,
				'LARS18TH changed the player speed level')
				for slot = powerup_slot.missile, #maximum_levels do
					assert(state.powerup_levels[slot] == maximum_levels[slot],
					'LARS18TH did not maximize loadout slot ' .. tostring(slot))
				end
				assert(#active_player.options == maximum_levels[powerup_slot.option],
				'LARS18TH did not materialize the full option loadout')
				assert(active_player.force_field_strength == player_force_field_strength,
				'LARS18TH did not materialize the full force field')
			end
		end, }, }
