local world<const> = require('cartlib/world/world')
local progression<const> = require('cartlib/progression')

__bmsx_host_test = __bmsx_host_test or {
	frames = 0,
}

function __bmsx_host_test.setup()
	return host.new_game()
end

function __bmsx_host_test.ready()
	return world:get('c') ~= nil and world:get('room') ~= nil and world:get('pietolon') ~= nil
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	if world.active_space_id ~= 'main' then
		assert(test.frames < 120, 'pietious gameplay did not reach main space')
		return false
	end

	local castle<const> = world:get('c')
	local room<const> = world:get('room')
	castle:enter_world('world_1')
	castle:switch_room('left', 0, 0)
	castle:switch_room('left', 0, 0)
	castle:switch_room('down', 0, 0)
	assert(room.room_number == 106, 'enemy respawn scenario did not enter room 106')

	local enemy_def<const> = room.enemies[1]
	assert(enemy_def.retain_defeat_in_region, 'room 106 enemy must retain defeat within world 1')
	local enemy<const> = world:get(enemy_def.id)
	assert(enemy ~= nil, 'room 106 enemy did not spawn')
	enemy.events:emit('damage.resolved', {
		status = 'applied',
		target_id = enemy_def.id,
		target_kind = enemy_def.kind,
		destroyed = true,
		room_number = room.room_number,
	})
	assert(progression.get(castle, enemy_def.id), 'enemy defeat was not retained in world 1')

	castle:switch_room('up', 0, 0)
	castle:switch_room('down', 0, 0)
	assert(room.room_number == 106, 'enemy respawn scenario did not return to room 106')
	assert(world:get(enemy_def.id) == nil, 'enemy respawned during the same world visit')

	castle:leave_world_to_castle()
	assert(not progression.get(castle, enemy_def.id), 'enemy defeat survived the world-to-castle boundary')
	castle:enter_world('world_1')
	castle:switch_room('left', 0, 0)
	castle:switch_room('left', 0, 0)
	castle:switch_room('down', 0, 0)
	assert(world:get(enemy_def.id) ~= nil, 'enemy did not respawn on the next world visit')

	castle.events:emit('room.condition_set', {
		room_number = 104,
		condition = 'staff1destroyed',
	})
	castle.events:emit('room.condition_set', {
		room_number = 107,
		condition = 'staff2destroyed',
	})
	castle.events:emit('room.condition_set', {
		room_number = 110,
		condition = 'staff3destroyed',
	})
	assert(progression.get(castle, 'r109.stairs'), 'staff progression did not open the world stairs')
	castle:leave_world_to_castle()
	assert(progression.get(castle, 'staff1destroyed'), 'permanent staff progression was reset at the region boundary')
	castle:enter_world('world_1')
	castle:switch_room('left', 0, 0)
	castle:switch_room('up', 0, 0)
	castle:switch_room('up', 0, 0)
	assert(room.room_number == 104, 'staff progression scenario did not enter room 104')
	local staff_def
	for i = 1, #room.enemies do
		local candidate<const> = room.enemies[i]
		if candidate.trigger == 'staff1destroyed' then
			staff_def = candidate
			break
		end
	end
	assert(staff_def ~= nil, 'room 104 staff definition is missing')
	assert(world:get(staff_def.id) == nil, 'progression-completed staff respawned')
	return true
end
