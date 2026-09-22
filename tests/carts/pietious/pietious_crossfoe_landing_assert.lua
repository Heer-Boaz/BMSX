local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		crossfoe_landing = function(t)
			local _director<const>, castle<const>, player<const> = fixture.start_game(t)
			local room
			local test<const> = {}
			local from_room_number<const> = castle.current_room_number
			room = castle:load_room(6)
			castle:commit_room_switch({
				from_room_number = from_room_number,
				to_room_number = 6,
				direction = 'up',
			}, 0, 0, 0)
			for index = 1, #room.enemies do
				local definition<const> = room.enemies[index]
				if definition.definition_id == 'enemy.crossfoe' then
					if test.cross_id == nil then
						test.cross_id = definition.member_id
					else
						registry:get('c').room.scene.members[definition.member_id]:mark_for_disposal()
					end
				end
			end
			local cross<const> = registry:get('c').room.scene.members[test.cross_id]
			test.cross_start_x = cross.x
			player.x = room_tile_size * 14
			player.y = cross.y

			for tick = 1, enemy_cross_wait_before_fly_steps / 2 do
				player.y = cross.y
				t:wait_ticks(1)
				assert(cross.x == test.cross_start_x, 'cross left during takeoff wait')
			end
			player.y = cross.y - player.height - 1
			t:wait_ticks(1)
			assert(cross.x == test.cross_start_x, 'cross left after takeoff condition failed')
			local waiting_ticks = 0
			t:wait_until('cross full takeoff wait', function()
				player.y = cross.y
				if cross.x ~= test.cross_start_x then return true end
				waiting_ticks = waiting_ticks + 1
				return false
			end, 300)
			assert(waiting_ticks > enemy_cross_wait_before_fly_steps, 'cross retained a partial takeoff wait')
			t:wait_until('cross landing', function() return cross.cross_spin_direction == 'down' end, 300)
			t:wait_ticks(1)
			assert(room:has_collision_flags_at_world(
			cross.x + room_tile_size,
			cross.y + room_tile_size3,
			collision_flags_solid_mask
			), 'crossfoe stopped without authored room support')

		end,
	},
}
