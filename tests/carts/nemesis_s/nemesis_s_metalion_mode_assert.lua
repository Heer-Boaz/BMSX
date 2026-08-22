local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')

local password<const> = {
	'KeyM', 'KeyE', 'KeyT', 'KeyA', 'KeyL', 'KeyI', 'KeyO', 'KeyN', 'Enter',
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
	director.state_machines:transition_to('/game_start')
end

local enter_password<const> = function(test)
	if test.password_gap then
		test.password_gap = false
		return false
	end
	local index<const> = test.password_index + 1
	if index > #password then
		test.phase = 'verify'
		return false
	end
	test.password_index = index
	test.password_gap = true
	return host.press(password[index], 2)
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 240, 'Nemesis S Metalion-mode scenario timed out phase=' .. test.phase)

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
		test.phase = 'password'
		return false
	end

	if test.phase == 'password' then
		return enter_password(test)
	end

	local player<const> = director.players[1]
	if not player.metalion_mode_active then
		return false
	end
	assert(not world.gameplay_clock_running and player.frame == test.player_frame,
		'Metalion password advanced the suspended gameplay schedule')
	assert(player.sprite.imgid == assets_player_2_n,
		'Metalion mode did not publish the retained green vessel source')

	local bullet<const> = world:spawn(ids_enemy_bullet_def, {
		stage = player.stage,
		pos = { x = player.x, y = player.y },
	})
	assert(collide_with(player, bullet, collision_enemy_projectile_layer) == nil,
		'Metalion mode admitted ordinary projectile damage')
	bullet:mark_for_disposal()

	local rook<const> = world:spawn(ids_rook_def, {
		stage = player.stage,
		rise_distance = rook_rise_distances[1],
		pos = { x = player.x, y = player.y },
	})
	assert(collide_with(player, rook, collision_enemy_layer) == nil,
		'Metalion mode admitted small-fry contact damage')
	rook:mark_for_disposal()

	local kerk<const> = world:spawn(ids_kerk_def, {
		stage = player.stage,
		pos = { x = player.x, y = player.y },
	})
	assert(collide_with(player, kerk, collision_enemy_layer) == '/dying',
		'Metalion mode suppressed substantial stage-object contact')
	kerk:mark_for_disposal()
	return true
end
