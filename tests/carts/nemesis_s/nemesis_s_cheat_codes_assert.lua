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

__bmsx_host_test = {
	frames = 0,
	phase = 'wait_game_start',
	password_index = 0,
	password_gap = false,
}

function __bmsx_host_test.ready()
	return registry:get(ids_director_instance) ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = registry:get(ids_director_instance)
	director.player_count = 2
	director.state_machines:transition_to('/game_start')
end

local enter_password<const> = function(test)
	if test.password_gap then
		test.password_gap = false
		return false
	end
	local index<const> = test.password_index + 1
	if index > #test.password then
		test.phase = test.next_phase
		return false
	end
	test.password_index = index
	test.password_gap = true
	return host.press(test.password[index], 2)
end

local begin_password<const> = function(test, password, next_phase)
	test.password = password
	test.password_index = 0
	test.password_gap = false
	test.next_phase = next_phase
	test.phase = 'password'
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 240, 'Nemesis S cheat-code scenario timed out phase=' .. test.phase)

	local director<const> = registry:get(ids_director_instance)
	if test.phase == 'wait_game_start' then
		if director.status_bar == nil then
			return false
		end
		director.state_machines:transition_to('/gameplay')
		test.pause_state = director.state_machines:bind_state_path('/gameplay/pause')
		test.phase = 'pause'
		return host.press('F1', 4)
	end

	if test.phase == 'pause' then
		if not director.state_machines:matches_state(test.pause_state)
		or world.gameplay_clock_running then
			return false
		end
		test.player_frame = director.players[1].frame
		begin_password(test, passwords.metalion, 'verify_metalion_enabled')
		return false
	end

	if test.phase == 'password' then
		return enter_password(test)
	end

	local player_1<const> = director.players[1]
	local player_2<const> = director.players[2]
	if test.phase == 'verify_metalion_enabled' and not player_1.metalion_cheat_active then
		return false
	end
	if test.phase == 'verify_metalion_enabled' then
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

		local bullet<const> = world:spawn(ids_enemy_bullet_def, {
			stage = player_1.stage,
			pos = { x = player_1.x, y = player_1.y },
		})
		assert(collide_with(player_1, bullet, collision_enemy_projectile_layer) == nil,
			'Metalion cheat admitted ordinary projectile damage')
		bullet:mark_for_disposal()

		local rook<const> = world:spawn(ids_rook_def, {
			stage = player_1.stage,
			rise_distance = rook_rise_distances[1],
			pos = { x = player_1.x, y = player_1.y },
		})
		assert(collide_with(player_1, rook, collision_enemy_layer) == nil,
			'Metalion cheat admitted small-fry contact damage')
		rook:mark_for_disposal()

		local kerk<const> = world:spawn(ids_kerk_def, {
			stage = player_1.stage,
			pos = { x = player_1.x, y = player_1.y },
		})
		assert(collide_with(player_1, kerk, collision_enemy_layer) == '/dying',
			'Metalion cheat suppressed substantial stage-object contact')
		kerk:mark_for_disposal()
		begin_password(test, passwords.metalion, 'verify_metalion_disabled')
		return false
	end

	if test.phase == 'verify_metalion_disabled' then
		assert(not director.metalion_cheat_active
			and not player_1.metalion_cheat_active
			and not player_2.metalion_cheat_active,
			'entering Metalion twice did not disable the cheat')
		assert(player_1.sprite.imgid == assets_player_n,
			'disabling Metalion did not restore player one')
		assert(player_2.sprite.imgid == assets_player_2_n,
			'disabling Metalion did not restore the purple player two')
		begin_password(test, passwords.lars18th, 'verify_full_loadout')
		return false
	end

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
	return true
end
