local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')

__bmsx_host_test = {
	frames = 0,
	phase = 'setup',
}

function __bmsx_host_test.setup()
	__bmsx_host_test.outgoing_director = registry:get('d')
	__bmsx_host_test.outgoing_director.request_new_game()
end

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil
		and registry:get('c').room ~= nil
		and registry:get('pietolon') ~= nil
		and registry:get('d') ~= nil
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	-- State paths and probe actors belong to the admitted game, not the outgoing intro.
	if registry:get('d') == test.outgoing_director then return false end
	test.frames = test.frames + 1
	assert(test.frames < 500, 'halo scenario timed out phase=' .. test.phase)

	local castle<const> = registry:get('c')
	local player<const> = registry:get('pietolon')
	local director<const> = registry:get('d')
	if test.room_state == nil then
		test.room_state = director.state_machines:bind_state_path('/room')
		test.item_active_state = director.state_machines:bind_state_path('/item_screen/active')
	end

	if test.phase == 'setup' then
		if world.active_space_id ~= 'main'
		or not director.state_machines:matches_state(test.room_state) then
			return false
		end
		assert(player.status.inventory_items.halo, 'halo scenario started without the halo')
		test.phase = 'open_item_screen'
		return host.press('ShiftLeft', 2)
	end

	if test.phase == 'open_item_screen' then
		if not director.state_machines:matches_state(test.item_active_state) then
			return false
		end
		test.phase = 'activate_halo'
		return host.press('Enter', 2)
	end

	if test.phase == 'activate_halo' then
		if not director.state_machines:matches_state(test.room_state) then
			return false
		end
		assert(world.active_space_id == 'main', 'halo did not restore the main world space')
		assert(castle.current_room_number == 1, 'halo did not resolve to castle room 1')
		return true
	end

	return false
end
