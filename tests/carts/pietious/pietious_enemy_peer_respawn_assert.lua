local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')

__bmsx_host_test = {
	frames = 0,
}

function __bmsx_host_test.setup()
	return host.press('Enter', 2)
end

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil and registry:get('room') ~= nil
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 180, 'enemy peer-respawn scenario timed out')
	if world.active_space_id ~= 'main' then
		return false
	end

	local castle<const> = registry:get('c')
	local room<const> = registry:get('room')
	if test.phase == nil then
		castle:switch_room('right', 0, 0)
		assert(room.room_number == 2, 'enemy peer-respawn scenario did not enter room 2')
		local first_def<const> = room.enemies[1]
		local second_def<const> = room.enemies[2]
		assert(not first_def.retain_defeat_in_region, 'first room 2 enemy unexpectedly retains region defeat')
		assert(not second_def.retain_defeat_in_region, 'second room 2 enemy unexpectedly retains region defeat')
		test.first_id = first_def.id
		test.second_id = second_def.id
		test.phase = 1
		return false
	end

	if test.phase == 1 then
		local first<const> = registry:get(test.first_id)
		assert(first ~= nil, 'first room 2 enemy did not spawn')
		first.events:emit('damage.resolved', {
			status = 'applied',
			target_id = first.id,
			target_kind = first.enemy_kind,
			destroyed = true,
			room_number = room.room_number,
		})
		first:mark_for_disposal()
		test.phase = 2
		return false
	end

	if test.phase == 2 then
		assert(registry:get(test.first_id) == nil, 'first enemy survived its disposal barrier')
		local second<const> = registry:get(test.second_id)
		assert(second ~= nil, 'second room 2 enemy did not spawn')
		second.events:emit('damage.resolved', {
			status = 'applied',
			target_id = second.id,
			target_kind = second.enemy_kind,
			destroyed = true,
			room_number = room.room_number,
		})
		second:mark_for_disposal()
		test.phase = 3
		return false
	end

	assert(registry:get(test.first_id) == nil, 'destroying a peer respawned the first enemy')
	assert(registry:get(test.second_id) == nil, 'second enemy survived its disposal barrier')
	return true
end
