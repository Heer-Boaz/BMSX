local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')

__bmsx_host_test = { frames = 0 }
function __bmsx_host_test.setup()
	return host.press('Enter', 2)
end
function __bmsx_host_test.ready()
	return registry:get('c') ~= nil and registry:get('room') ~= nil and registry:get('d') ~= nil and registry:get('pietolon') ~= nil
end
function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 720, 'timeout phase=' .. tostring(test.phase) .. ' space=' .. tostring(world.active_space_id))
	local castle<const> = registry:get('c')
	local room<const> = registry:get('room')
	local director<const> = registry:get('d')
	local player<const> = registry:get('pietolon')
	if test.phase == nil then
		if world.active_space_id ~= 'main' then return false end
		castle:switch_room('right', 0, 0)
		test.enemy_id = room.enemies[1].id
		test.phase = 1
		return false
	end
	if test.phase == 1 then
		if world.active_space_id ~= 'main' then return false end
		local enemy<const> = registry:get(test.enemy_id)
		assert(enemy ~= nil, 'enemy missing before shrine')
		director.events:emit('shrine_transition_enter')
		assert(enemy.space_id == 'transition', 'shrine event did not freeze enemy; space=' .. tostring(enemy.space_id))
		director.events:emit('room')
		assert(enemy.space_id == 'main', 'room did not restore enemy')
		director.events:emit('world_transition')
		assert(registry:get(test.enemy_id) == nil, 'world transition did not retire the previous-room enemy')
		castle:enter_world('world_1')
		director.events:emit('world_leave_transition_start')
		local switch<const> = castle:leave_world_to_castle(false)
		local destination_def<const> = room.enemies[1]
		local destination<const> = registry:get(destination_def.id)
		assert(destination ~= nil, 'destination enemy missing')
		test.destination_id = destination.id
		test.destination_x = destination.x
		test.destination_y = destination.y
		player:emit_room_switched(switch.from_room_number, switch.to_room_number, switch.direction)
		test.phase = 2
		return false
	end
	local destination<const> = registry:get(test.destination_id)
	assert(destination ~= nil, 'destination enemy disposed during banner')
	if test.phase == 2 then
		assert(destination.x == test.destination_x and destination.y == test.destination_y,
			'destination enemy moved before transition space became active')
		if world.active_space_id == 'transition' then
			test.phase = 3
			test.frozen_frames = 0
		end
		return false
	end
	assert(destination.x == test.destination_x and destination.y == test.destination_y,
		'destination enemy moved during world-leave transition')
	test.frozen_frames = test.frozen_frames + 1
	return test.frozen_frames == 5
end
