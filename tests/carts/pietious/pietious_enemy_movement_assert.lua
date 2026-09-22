local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')
local record_cross_landing<const> = function(test)
	local cross<const> = registry:get('c').room.scene.members[test.cross_id]
	test.landing_count = test.landing_count + 1
	test.landing_x = cross.x
end
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		enemy_movement = function(t)
			local _director<const>, castle<const>, player<const> = fixture.start_game(t)
			local room
			local test<const> = {landing_count = 0}
			local from_room_number<const> = castle.current_room_number
			room = castle:load_room(7)
			castle:commit_room_switch({
				from_room_number = from_room_number,
				to_room_number = 7,
				direction = 'left',
			}, 0, 0, 0)
			for index = 1, #room.enemies do
				local definition<const> = room.enemies[index]
				if definition.definition_id == 'enemy.crossfoe' then
					test.cross_id = definition.member_id
					break
				end
			end
			test.wall_x = room.wall_instances[1].x
			castle.events:on({
				event = 'crossland',
				subscriber = test,
				handler = record_cross_landing,
			})
			registry:get('c').room.scene:spawn('enemy.marspeinenaardappel', {
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

			t:wait_until('Mars admission', function() return registry:get('probe.marspeinenaardappel') ~= nil end, 30)
			local mars<const> = registry:get('probe.marspeinenaardappel')
			local boundary_x<const> = room.world_width - room_tile_size
			t:wait_until('Mars boundary bounce', function() return mars.x ~= boundary_x end, 30)
			assert(mars.x == boundary_x - 2, 'Mars did not reflect from right room boundary')
			mars:mark_for_disposal()
			local cross<const> = castle.room.scene.members[test.cross_id]
			local cross_start_x<const> = cross.x
			for tick = 1, 140 do
				player.x = room.world_width - player.width
				player.y = room.world_top
				t:wait_ticks(1)
			end
			assert(cross.x == cross_start_x, 'cross left without vertical player overlap')
			t:wait_until('cross retreats from wall', function()
				player.x = room.world_width - player.width
				player.y = cross.y
				return test.landing_count > 0
			end, 800)
			assert(test.landing_x < test.wall_x and cross.x < test.wall_x, 'cross passed through room wall')
			do
				local from_room_number<const> = castle.current_room_number
				room = castle:load_room(102)
				castle:commit_room_switch({
					from_room_number = from_room_number,
					to_room_number = 102,
					direction = 'left',
				}, 1, 2, 2)
				for index = 1, #room.enemies do
					local definition<const> = room.enemies[index]
					if definition.definition_id == 'enemy.zakfoe' then
						test.zak_id = definition.member_id
						break
					end
				end

			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			local zak<const> = castle.room.scene.members[test.zak_id]
			local min_x = zak.x
			local max_x = zak.x
			local direction = zak.direction
			local changed_direction = false
			t:wait_until('Zak patrol spans platform', function()
				min_x = math.min(min_x, zak.x)
				max_x = math.max(max_x, zak.x)
				if zak.direction ~= direction then
					assert(zak.sprite_component.flip_h == (zak.direction == 'left'), 'Zak direction lost visual facing')
					direction = zak.direction
					changed_direction = true
				end
				return max_x - min_x >= room_tile_size * 3 and changed_direction
			end, 240)

		end,
	},
}
