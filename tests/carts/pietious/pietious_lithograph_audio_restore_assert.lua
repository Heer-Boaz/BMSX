local world<const> = require('cartlib/world/world')
local registry<const> = require('cartlib/registry')

__bmsx_host_test = {
	phase = 'open',
	frames = 0,
}

local record_lithograph_exit<const> = function(test, _event_type, _emitter, payload)
	test.exit_payload = payload
end

function __bmsx_host_test.setup()
	return host.press('Enter', 2)
end

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil and registry:get('pietolon') ~= nil and registry:get('d') ~= nil
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	local director<const> = registry:get('d')
	local state_machines<const> = director.state_machines
	assert(
		test.frames < 300,
		'lithograph audio restore scenario timed out phase=' .. test.phase
			.. ' space=' .. world.active_space_id
			.. ' exit=' .. tostring(test.exit_payload ~= nil)
	)

	if test.phase == 'open' then
		if world.active_space_id ~= 'main' then
			return false
		end
		if test.room_state == nil then
			test.room_state = state_machines:bind_state_path('/room')
		end
		if not state_machines:matches_state(test.room_state) then
			return false
		end
		test.viewing_state = state_machines:bind_state_path('/lithograph/viewing')
		director.events:on({
			event = 'lithograph_exit_done',
			subscriber = test,
			handler = record_lithograph_exit,
		})
		registry:get('pietolon').events:emit('lithograph.request', {
			text_line = 'TEST',
		})
		test.phase = 'close'
		return false
	end

	if test.phase == 'close' then
		if not state_machines:matches_state(test.viewing_state) then
			return false
		end
		state_machines:transition_to('/lithograph/closing')
		test.phase = 'wait_room'
		return false
	end

	if world.active_space_id ~= 'main' then
		return false
	end
	local payload<const> = test.exit_payload
	assert(payload ~= nil, 'lithograph exit did not publish room music state')
	assert(payload.world_number == registry:get('room').world_number, 'lithograph exit published the wrong world')
	assert(not payload.suppress_room_music, 'lithograph exit suppressed room music')
	return true
end
