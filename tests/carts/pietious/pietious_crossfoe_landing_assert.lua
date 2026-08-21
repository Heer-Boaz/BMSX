local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')

__bmsx_host_test = {
	frames = 0,
	phase = 'setup',
}

function __bmsx_host_test.setup()
	new_game()
end

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil
		and registry:get('room') ~= nil
		and registry:get('pietolon') ~= nil
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 300, 'crossfoe landing scenario timed out phase=' .. test.phase)
	if world.active_space_id ~= 'main' then
		return false
	end

	local castle<const> = registry:get('c')
	local room<const> = registry:get('room')
	local player<const> = registry:get('pietolon')
	if test.phase == 'setup' then
		local from_room_number<const> = castle.current_room_number
		room:load_room(6)
		castle:commit_room_switch({
			from_room_number = from_room_number,
			to_room_number = 6,
			direction = 'up',
		}, 0, 0, 0)
		for index = 1, #room.enemies do
			local definition<const> = room.enemies[index]
			if definition.kind == 'crossfoe' then
				if test.cross_id == nil then
					test.cross_id = definition.id
				else
					registry:get(definition.id):mark_for_disposal()
				end
			end
		end
		local cross<const> = registry:get(test.cross_id)
		test.cross_start_x = cross.x
		player.x = room_tile_size * 14
		player.y = cross.y
		test.phase = 'partial_wait'
		test.phase_frames = 0
		return false
	end

	local cross<const> = registry:get(test.cross_id)
	if test.phase == 'partial_wait' then
		player.y = cross.y
		test.phase_frames = test.phase_frames + 1
		assert(cross.x == test.cross_start_x, 'cross left during its takeoff wait')
		if test.phase_frames < enemy_cross_wait_before_fly_steps / 2 then
			return false
		end
		player.y = cross.y - player.height - 1
		test.phase = 'reset_wait'
		return false
	end

	if test.phase == 'reset_wait' then
		assert(cross.x == test.cross_start_x, 'cross left after its takeoff condition failed')
		player.y = cross.y
		test.phase = 'full_wait'
		test.phase_frames = 0
		return false
	end

	if test.phase == 'full_wait' then
		player.y = cross.y
		test.phase_frames = test.phase_frames + 1
		if cross.x == test.cross_start_x then
			return false
		end
		assert(test.phase_frames > enemy_cross_wait_before_fly_steps,
			'cross retained a partial takeoff wait after its condition failed')
		test.phase = 'flight'
	end

	if test.phase == 'flight' then
		if cross.cross_spin_direction ~= 'down' then
			return false
		end
		test.phase = 'verify'
		return false
	end

	assert(room:has_collision_flags_at_world(
		cross.x + room_tile_size,
		cross.y + room_tile_size3,
		collision_flags_solid_mask
	), 'crossfoe stopped without authored room support')
	return true
end
