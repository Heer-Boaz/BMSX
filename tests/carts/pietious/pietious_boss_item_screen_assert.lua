local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')

__bmsx_host_test = {
	frames = 0,
	phase = 'setup',
}

function __bmsx_host_test.setup()
	local director<const> = registry:get('d')
	__bmsx_host_test.previous_director = director
	director.request_new_game()
end

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil
		and registry:get('room') ~= nil
		and registry:get('pietolon') ~= nil
		and registry:get('d') ~= nil
		and registry:get('item_screen') ~= nil
end

local find_daemon_def<const> = function(room)
	for index = 1, #room.enemies do
		local def<const> = room.enemies[index]
		if def.kind == 'daemon' then
			return def
		end
	end
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 1000, 'boss item-screen scenario timed out phase=' .. test.phase)

	local castle<const> = registry:get('c')
	local room<const> = registry:get('room')
	local player<const> = registry:get('pietolon')
	local director<const> = registry:get('d')
	local screen<const> = registry:get('item_screen')
	if director == test.previous_director then
		return false
	end
	if test.room_state == nil then
		test.room_state = director.state_machines:bind_state_path('/room')
		test.item_active_state = director.state_machines:bind_state_path('/item_screen/active')
		test.screen_closed_state = screen.state_machines:bind_state_path('/closed')
	end

	if test.phase == 'setup' then
		if world.active_space_id ~= 'main'
		or not director.state_machines:matches_state(test.room_state) then
			return false
		end
		local from_room_number<const> = castle.current_room_number
		room:load_room(100)
		castle:commit_room_switch({
			from_room_number = from_room_number,
			to_room_number = 100,
			direction = 'down',
		}, 1, 2, 5)
		player.state_machines:transition_to('/quiet')
		player.x = 32
		player.y = 96
		local def<const> = find_daemon_def(room)
		assert(def ~= nil, 'room 100 has no daemon definition')
		test.daemon_id = def.id
		test.phase = 'admitted'
		return false
	end

	local daemon<const> = registry:get(test.daemon_id)
	if test.phase == 'admitted' then
		if daemon == nil then
			return false
		end
		director.state_machines:transition_to('/daemon_appearance')
		test.phase = 'fight'
		return false
	end

	if test.phase == 'fight' then
		if world.active_space_id ~= 'main'
		or not director.state_machines:matches_state(test.room_state)
		or not daemon.behaviour.enabled then
			return false
		end
		test.phase = 'opening'
		return host.gamepad_press(1, 'lb', 4)
	end

	if test.phase == 'opening' then
		if world.active_space_id ~= 'item'
		or not director.state_machines:matches_state(test.item_active_state) then
			return false
		end
		assert(screen.secondary_weapon_selection_index == 0,
			'item screen opened on the wrong secondary weapon')
		test.phase = 'wrap_left'
		return host.gamepad_press(1, 'left', 4)
	end

	if test.phase == 'wrap_left' then
		if screen.secondary_weapon_selection_index ~= 1 then
			return false
		end
		assert(player.secondary_weapon == 'spyglass',
			'left navigation did not wrap to the final owned secondary weapon')
		test.phase = 'wrap_right'
		return host.gamepad_press(1, 'right', 4)
	end

	if test.phase == 'wrap_right' then
		if screen.secondary_weapon_selection_index ~= 0 then
			return false
		end
		assert(player.secondary_weapon == 'pepernoot',
			'right navigation did not wrap to the first owned secondary weapon')
		test.phase = 'closing'
		return host.gamepad_press(1, 'lb', 4)
	end

	if test.phase == 'closing' then
		if world.active_space_id ~= 'main'
		or not director.state_machines:matches_state(test.room_state) then
			return false
		end
		assert(screen.state_machines:matches_state(test.screen_closed_state),
			'item-screen presentation remained open after returning to the fight')
		assert(daemon.visible and daemon.behaviour.enabled and daemon.collider.enabled,
			'daemon fight did not resume after closing the item screen')
		return true
	end

	return false
end
