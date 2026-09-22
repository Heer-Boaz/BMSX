local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')
local bat_hang_ticks<const> = 0x50
local bat_takeoff_ticks<const> = 0x0a
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		mijter_bat = function(t)
			local _director<const>, castle<const> = fixture.start_game(t)
			local room
			local test<const> = {}
			local from_room_number<const> = castle.current_room_number
			room = castle:load_room(110)
			castle:commit_room_switch({
				from_room_number = from_room_number,
				to_room_number = 110,
				direction = 'left',
			}, 0, 0, 0)
			test.mijter_id = room.enemies[1].member_id

			t:at_boundary(world:request_mutation_boundary(), 30)
			local mijter<const> = castle.room.scene.members[test.mijter_id]
			local motion<const> = mijter.motion
			local start_x<const>, start_y<const> = mijter.x, mijter.y
			local hanging_frames = 0
			t:wait_until('Bat takeoff', function()
				if motion.velocity_x ~= 0 or motion.velocity_y ~= 0 then return true end
				assert(mijter.x == start_x and mijter.y == start_y, 'mijter moved while hanging')
				hanging_frames = hanging_frames + 1
				return false
			end, 2500)
			assert(motion.velocity_x == 0 and motion.velocity_y == 256, 'mijter lost one-pixel downward takeoff')
			assert(hanging_frames >= (bat_hang_ticks * 2) - 1 and hanging_frames <= (bat_hang_ticks * 2) + 1,
			'mijter ceiling wait no longer matches the 25 Hz Bat timer')
			local previous_x = mijter.x
			local previous_y = mijter.y
			for move = 1, bat_takeoff_ticks do
				t:wait_until('Bat takeoff step', function() return mijter.x ~= previous_x or mijter.y ~= previous_y end, 10)
				assert(mijter.x == previous_x and mijter.y == previous_y + 1, 'mijter takeoff lost +1px motion')
				previous_x = mijter.x
				previous_y = mijter.y
			end
			local saw_fractional_motion = false
			t:wait_until('Bat finds ceiling', function()
				if motion.fraction_x ~= 0 or motion.fraction_y ~= 0 then saw_fractional_motion = true end
				return motion.velocity_x == 0 and motion.velocity_y == 0
			end, 2500)
			assert(saw_fractional_motion, 'mijter flight never exercised Bat Q8.8 direction table')
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
		end,
	},
}
