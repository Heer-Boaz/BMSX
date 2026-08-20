local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')

__bmsx_host_test = {
	frames = 0,
	phase = 'load_cross_room',
	landing_count = 0,
}

local record_cross_landing<const> = function(test)
	local cross<const> = registry:get(test.cross_id)
	test.landing_count = test.landing_count + 1
	test.landing_x = cross.x
end

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
	assert(test.frames < 800, 'enemy movement scenario timed out phase=' .. test.phase)
	if world.active_space_id ~= 'main' then
		return false
	end

	local castle<const> = registry:get('c')
	local room<const> = registry:get('room')
	local player<const> = registry:get('pietolon')
	if test.phase == 'load_cross_room' then
		local from_room_number<const> = castle.current_room_number
		room:load_room(7)
		castle:commit_room_switch({
			from_room_number = from_room_number,
			to_room_number = 7,
			direction = 'left',
		}, 0, 0, 0)
		for index = 1, #room.enemies do
			local definition<const> = room.enemies[index]
			if definition.kind == 'crossfoe' then
				test.cross_id = definition.id
				break
			end
		end
		test.wall_x = room.wall_instances[1].x
		castle.events:on({
			event = 'crossland',
			subscriber = test,
			handler = record_cross_landing,
		})
		world:spawn('enemy.marspeinenaardappel', {
			id = 'probe.marspeinenaardappel',
			space_id = 'main',
			castle = castle,
			room = room,
			player = player,
			speed_x_num = 2,
			speed_y_num = 0,
			pos = {
				x = room.world_width - room_tile_size,
				y = room.world_top + (13 * room_tile_size),
				z = 110,
			},
		})
		test.phase = 'mars_bounce'
		test.phase_frames = 0
		return false
	end

	if test.phase == 'mars_bounce' then
		local mars<const> = registry:get('probe.marspeinenaardappel')
		if mars == nil then
			return false
		end
		local boundary_x<const> = room.world_width - room_tile_size
		if mars.x == boundary_x then
			return false
		end
		assert(mars.x == boundary_x - 2,
			'marspeinenaardappel did not reflect from the right room boundary')
		mars:mark_for_disposal()
		test.phase = 'cross_outside_lane'
		return false
	end

	if test.phase == 'cross_outside_lane' then
		local cross<const> = registry:get(test.cross_id)
		player.x = room.world_width - player.width
		player.y = room.world_top
		if test.cross_start_x == nil then
			test.cross_start_x = cross.x
		end
		test.phase_frames = test.phase_frames + 1
		if test.phase_frames < 140 then
			return false
		end
		assert(cross.x == test.cross_start_x, 'cross left without vertical player overlap')
		test.phase = 'cross_flight'
		return false
	end

	if test.phase == 'cross_flight' then
		local cross<const> = registry:get(test.cross_id)
		player.x = room.world_width - player.width
		player.y = cross.y
		if test.landing_count == 0 then
			return false
		end
		assert(test.landing_x < test.wall_x, 'cross did not retreat from the room wall')
		assert(cross.x < test.wall_x, 'cross passed through the room wall')

		local from_room_number<const> = castle.current_room_number
		room:load_room(102)
		castle:commit_room_switch({
			from_room_number = from_room_number,
			to_room_number = 102,
			direction = 'left',
		}, 1, 2, 2)
		for index = 1, #room.enemies do
			local definition<const> = room.enemies[index]
			if definition.kind == 'zakfoe' then
				test.zak_id = definition.id
				break
			end
		end
		test.phase = 'zak_platform'
		test.phase_frames = 0
		return false
	end

	local zak<const> = registry:get(test.zak_id)
	if test.zak_min_x == nil then
		test.zak_min_x = zak.x
		test.zak_max_x = zak.x
	elseif zak.x < test.zak_min_x then
		test.zak_min_x = zak.x
	elseif zak.x > test.zak_max_x then
		test.zak_max_x = zak.x
	end
	test.phase_frames = test.phase_frames + 1
	if test.zak_max_x - test.zak_min_x >= room_tile_size * 3 then
		return true
	end
	assert(test.phase_frames < 240, 'zak reversed within one or two platform tiles')
	return false
end
