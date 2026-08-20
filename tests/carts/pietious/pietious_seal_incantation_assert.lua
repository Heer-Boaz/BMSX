local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')

local wrong_sequence<const> = {
	'KeyE', 'KeyY', 'KeyC', 'KeyN', 'KeyD', 'KeyB', 'KeyA', 'KeyE', 'KeyS',
}
local seal_sequence<const> = {
	'KeyE', 'KeyY', 'KeyN', 'KeyD', 'KeyB', 'KeyA', 'KeyE', 'KeyS',
}

__bmsx_host_test = {
	frames = 0,
	phase = 'setup',
	sequence_index = 0,
	sequence_gap = false,
	settle_frames = 0,
}

function __bmsx_host_test.setup()
	new_game()
end

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil
		and registry:get('room') ~= nil
		and registry:get('pietolon') ~= nil
		and registry:get('d') ~= nil
end

local press_next<const> = function(test, sequence, next_phase)
	if test.sequence_gap then
		test.sequence_gap = false
		return false
	end
	local index<const> = test.sequence_index + 1
	if index > #sequence then
		test.sequence_index = 0
		test.phase = next_phase
		return false
	end
	test.sequence_index = index
	test.sequence_gap = true
	return host.press(sequence[index], 2)
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 500, 'seal incantation scenario timed out phase=' .. test.phase)

	local castle<const> = registry:get('c')
	local room<const> = registry:get('room')
	local player<const> = registry:get('pietolon')
	local director<const> = registry:get('d')
	if test.room_state == nil then
		test.room_state = director.state_machines:bind_state_path('/room')
		test.seal_state = director.state_machines:bind_state_path('/seal_dissolution')
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
		test.phase = 'wait_for_seal'
		return false
	end

	if test.phase == 'wait_for_seal' then
		local seal<const> = castle.seal_instance
		if seal == nil then
			return false
		end
		assert(seal.command == room.seal.text,
			'seal instance did not retain the room-authored incantation')
		test.phase = 'wrong_sequence'
		return false
	end

	if test.phase == 'wrong_sequence' then
		return press_next(test, wrong_sequence, 'wrong_sequence_settle')
	end

	if test.phase == 'wrong_sequence_settle' then
		test.settle_frames = test.settle_frames + 1
		if test.settle_frames < 4 then
			return false
		end
		assert(director.state_machines:matches_state(test.room_state),
			'an incorrect incantation activated the seal')
		test.phase = 'seal_sequence'
		return false
	end

	if test.phase == 'seal_sequence' then
		return press_next(test, seal_sequence, 'activation')
	end

	if director.state_machines:matches_state(test.seal_state) then
		assert(not world.gameplay_clock_running,
			'seal incantation reached dissolution without suspending gameplay')
		return true
	end
	return false
end
