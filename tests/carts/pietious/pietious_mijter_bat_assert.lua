local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')

-- Timers encoded by the original Bat routine at 0x7d5f and 0x7d75.
local bat_hang_ticks<const> = 0x50
local bat_takeoff_ticks<const> = 0x0a

__bmsx_host_test = {
	frames = 0,
	phase = 'load_room',
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
	assert(test.frames < 2500, 'mijter Bat cycle did not return to a ceiling')
	if world.active_space_id ~= 'main' then
		return false
	end

	local castle<const> = registry:get('c')
	local room<const> = registry:get('room')
	if test.phase == 'load_room' then
		local from_room_number<const> = castle.current_room_number
		room:load_room(110)
		castle:commit_room_switch({
			from_room_number = from_room_number,
			to_room_number = 110,
			direction = 'left',
		}, 0, 0, 0)
		test.mijter_id = room.enemies[1].id
		test.phase = 'hanging'
		return false
	end

	local mijter<const> = registry:get(test.mijter_id)
	if mijter == nil then
		return false
	end
	local motion<const> = mijter.motion
	if test.start_x == nil then
		test.start_x = mijter.x
		test.start_y = mijter.y
		test.previous_x = mijter.x
		test.previous_y = mijter.y
		test.hanging_frames = 0
	end

	if test.phase == 'hanging' then
		if motion.velocity_x == 0 and motion.velocity_y == 0 then
			test.hanging_frames = test.hanging_frames + 1
			assert(mijter.x == test.start_x and mijter.y == test.start_y,
				'mijter moved while hanging from the ceiling')
			return false
		end
		assert(motion.velocity_x == 0 and motion.velocity_y == 256,
			'mijter did not begin the original one-pixel downward takeoff')
		assert(test.hanging_frames >= (bat_hang_ticks * 2) - 1
			and test.hanging_frames <= (bat_hang_ticks * 2) + 1,
			'mijter ceiling wait no longer matches the 25 Hz Bat timer')
		test.phase = 'takeoff'
		test.takeoff_moves = 0
		return false
	end

	local dx<const> = mijter.x - test.previous_x
	local dy<const> = mijter.y - test.previous_y
	test.previous_x = mijter.x
	test.previous_y = mijter.y
	if test.phase == 'takeoff' and (dx ~= 0 or dy ~= 0) then
		test.takeoff_moves = test.takeoff_moves + 1
		assert(dx == 0 and dy == 1, 'mijter takeoff did not retain +1px vertical motion')
		if test.takeoff_moves == bat_takeoff_ticks then
			test.phase = 'flight'
		end
	end

	if test.phase == 'flight' then
		if motion.fraction_x ~= 0 or motion.fraction_y ~= 0 then
			test.saw_fractional_motion = true
		end
		if motion.velocity_x == 0 and motion.velocity_y == 0 then
			assert(test.saw_fractional_motion,
				'mijter flight never exercised the Bat Q8.8 direction table')
			assert(room:has_collision_flags_at_world(
				mijter.x,
				mijter.y - 1,
				collision_flags_solid_mask
			), 'mijter stopped without a ceiling')
			assert(room:has_collision_flags_at_world(
				mijter.x + room_tile_size,
				mijter.y - 1,
				collision_flags_solid_mask
			), 'mijter stopped without a two-tile ceiling')
			return true
		end
	end
	return false
end
