local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		shrine_input_resume = function(t)
			local director<const>, castle<const>, player<const> = fixture.start_game(t)
			local room
			local room_state<const> = director.state_machines:bind_state_path('/room')
			local shrine_state<const> = director.state_machines:bind_state_path('/shrine')
			local quiet_state<const> = player.state_machines:bind_state_path('/quiet')
			local from<const> = castle.current_room_number
			room = castle:load_room(4)
			castle:commit_room_switch({ from_room_number = from, to_room_number = 4, direction = 'right' }, 0, 5, 12)
			local shrine<const> = room.shrine_instances[1]
			player.state_machines:transition_to('/quiet')
			player.x = shrine.x
			player.y = shrine.y
			player:begin_entering_shrine(shrine)

			t:wait_until('shrine entered', function() return world.active_space_id == 'shrine' end, 120)
			assert(director.state_machines:matches_state(shrine_state), 'director did not enter shrine state')
			t:press('ArrowDown', 2)
			t:wait_until('room input resumed', function()
				return world.gameplay_clock_running and director.state_machines:matches_state(room_state)
				and player.state_machines:matches_state(quiet_state)
			end, 120)
			for tick = 1, 5 do
				t:wait_ticks(1)
				assert(world.gameplay_clock_running, 'modal Down input suspended gameplay again')
				assert(director.state_machines:matches_state(room_state), 'modal Down input reopened shrine')
				assert(player.state_machines:matches_state(quiet_state), 'player re-entered shrine')
			end

		end,
	},
}
