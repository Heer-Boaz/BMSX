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
		test.enemy_x = enemy.x
		test.enemy_y = enemy.y
		player:begin_entering_shrine({ x = player.x, text_lines = { 'TEST' } })
		test.phase = 'shrine_enter'
		return false
	end
	if test.phase == 'shrine_enter' then
		local enemy<const> = registry:get(test.enemy_id)
		if world.active_space_id == 'main' then
			assert(not world.gameplay_clock_running,
				'gameplay clock advanced during shrine entry')
			assert(enemy.x == test.enemy_x and enemy.y == test.enemy_y,
				'enemy moved during shrine entry')
			return false
		end
		assert(world.active_space_id == 'shrine', 'shrine overlay did not become active')
		assert(not world.gameplay_clock_running,
			'gameplay clock resumed while the frame-clock shrine controller was active')
		test.phase = 'shrine_exit'
		return host.press('ArrowDown', 2)
	end
	if test.phase == 'shrine_exit' then
		if world.active_space_id == 'shrine' then
			return false
		end
		local enemy<const> = registry:get(test.enemy_id)
		if not world.gameplay_clock_running then
			assert(enemy.x == test.enemy_x and enemy.y == test.enemy_y,
				'enemy moved during shrine exit')
			return false
		end
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
