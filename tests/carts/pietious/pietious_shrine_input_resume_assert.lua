local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')

__bmsx_host_test = {
	phase = 'setup',
	frames = 0,
}

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil
		and registry:get('room') ~= nil
		and registry:get('pietolon') ~= nil
		and registry:get('d') ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = registry:get('d')
	director.state_machines:transition_to('/room')
	world:set_space('main')
	world:set_gameplay_clock_running(true)
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 400, 'shrine resume scenario timed out phase=' .. test.phase)

	local castle<const> = registry:get('c')
	local room<const> = registry:get('room')
	local player<const> = registry:get('pietolon')
	local director<const> = registry:get('d')
	if test.room_state == nil then
		test.room_state = director.state_machines:bind_state_path('/room')
		test.shrine_state = director.state_machines:bind_state_path('/shrine')
		test.quiet_state = player.state_machines:bind_state_path('/quiet')
	end

	if test.phase == 'setup' then
		if world.active_space_id ~= 'main'
		or not director.state_machines:matches_state(test.room_state) then
			return false
		end
		castle.current_room_number = 4
		room:load_room(4)
		local shrine<const> = room.shrines[1]
		player.state_machines:transition_to('/quiet')
		player.x = shrine.x
		player.y = shrine.y
		player:begin_entering_shrine(shrine)
		test.phase = 'entering'
		return false
	end

	if test.phase == 'entering' then
		if world.active_space_id ~= 'shrine' then
			return false
		end
		assert(director.state_machines:matches_state(test.shrine_state),
			'director did not enter the shrine state')
		test.phase = 'exiting'
		return host.press('ArrowDown', 2)
	end

	if test.phase == 'exiting' then
		if not world.gameplay_clock_running
		or not director.state_machines:matches_state(test.room_state)
		or not player.state_machines:matches_state(test.quiet_state) then
			return false
		end
		test.phase = 'stable'
		test.stable_frames = 0
		return false
	end

	test.stable_frames = test.stable_frames + 1
	assert(world.gameplay_clock_running, 'modal Down input suspended gameplay again after shrine exit')
	assert(director.state_machines:matches_state(test.room_state),
		'modal Down input reopened the shrine')
	assert(player.state_machines:matches_state(test.quiet_state),
		'player re-entered the shrine after modal exit')
	return test.stable_frames == 5
end
