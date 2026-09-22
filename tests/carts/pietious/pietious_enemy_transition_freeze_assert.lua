local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		enemy_transition_freeze = function(t)
			local director<const>, castle<const>, player<const> = fixture.start_game(t)
			castle:switch_room('right', 0, 0)
			t:at_boundary(world:request_mutation_boundary(), 30)
			local room = castle.room
			local enemy<const> = room.scene.members[room.enemies[1].member_id]
			assert(enemy ~= nil, 'enemy missing before shrine')
			local test<const> = {enemy_x = enemy.x, enemy_y = enemy.y}
			player:begin_entering_shrine({x = player.x, text_lines = {'TEST'}})
			t:wait_until('shrine entry preserves enemy position', function()
				if world.active_space_id ~= 'main' then return true end
				assert(not world.gameplay_clock_running,
				'gameplay clock advanced during shrine entry')
				assert(enemy.x == test.enemy_x and enemy.y == test.enemy_y,
				'enemy moved during shrine entry')
				local imgid<const> = player.sprite_component.imgid
				if imgid == 'pietolon_stairs_up_1' then
					test.saw_shrine_pose_1 = true
				elseif imgid == 'pietolon_stairs_up_2' then
					test.saw_shrine_pose_2 = true
				end
				return false
			end, 720)
			do
				assert(world.active_space_id == 'shrine', 'shrine overlay did not become active')
				assert(not world.gameplay_clock_running,
				'gameplay clock resumed while the frame-clock shrine controller was active')
				assert(test.saw_shrine_pose_1 and test.saw_shrine_pose_2,
				'frame-clock shrine animation did not advance both player poses')
				local sprite<const> = player.sprite_component
				assert(sprite.region_height == 0 and not sprite.visible,
				'player did not disappear through the shrine scanline mask')

			end
			t:press('ArrowDown', 2)
			t:wait_until('shrine exit preserves enemy position', function()
				if world.active_space_id == 'shrine' then return false end
				if world.gameplay_clock_running then return true end
				assert(enemy.x == test.enemy_x and enemy.y == test.enemy_y, 'enemy moved during shrine exit')
				return false
			end, 720)
			local sprite<const> = player.sprite_component
			assert(sprite.region_width == nil and sprite.visible,
			'player did not finish the shrine emergence mask')
			director.events:emit('world_transition')
			castle:enter_world('world_1')
			assert(enemy.world == nil, 'room replacement did not retire the previous-room enemy')
			room = castle.room
			director.events:emit('world_leave_transition_start')
			local switch<const> = castle:leave_world_to_castle(false)
			room = castle.room
			local destination_def<const> = room.enemies[1]
			local destination<const> = registry:get('c').room.scene.members[destination_def.member_id]
			assert(destination ~= nil, 'destination enemy missing')
			test.destination_id = destination.id
			test.destination_x = destination.x
			test.destination_y = destination.y
			player:emit_room_switched(switch.from_room_number, switch.to_room_number, switch.direction)

			t:wait_until('world-leave banner', function()
				assert(destination.world ~= nil, 'destination enemy disposed during banner')
				assert(destination.x == test.destination_x and destination.y == test.destination_y,
				'destination enemy moved before transition space became active')
				return world.active_space_id == 'transition'
			end, 720)
			for tick = 1, 5 do
				t:wait_ticks(1)
				assert(destination.x == test.destination_x and destination.y == test.destination_y,
				'destination enemy moved during world-leave transition')
			end

		end,
	},
}
