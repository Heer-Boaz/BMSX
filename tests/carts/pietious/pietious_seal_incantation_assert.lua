local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local wrong_sequence<const> = {
	'KeyE', 'KeyY', 'KeyC', 'KeyN', 'KeyD', 'KeyB', 'KeyA', 'KeyE', 'KeyS',
}
local seal_sequence<const> = {
	'KeyE', 'KeyY', 'KeyN', 'KeyD', 'KeyB', 'KeyA', 'KeyE', 'KeyS',
}
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		seal_incantation = function(t)
			local director<const>, castle<const>, player<const> = fixture.start_game(t)
			local room
			local room_state<const> = director.state_machines:bind_state_path('/room')
			local seal_state<const> = director.state_machines:bind_state_path('/seal_dissolution')
			local from_room_number<const> = castle.current_room_number
			room = castle:load_room(100)
			castle:commit_room_switch({
				from_room_number = from_room_number,
				to_room_number = 100,
				direction = 'down',
			}, 1, 2, 5)
			player.state_machines:transition_to('/quiet')

			t:wait_until('seal admission', function() return castle.room.seal_instance ~= nil end, 120)
			assert(castle.room.seal_instance.command == room.seal.options.command, 'seal lost authored incantation')
			for index = 1, #wrong_sequence do t:press(wrong_sequence[index], 2) end
			t:wait_ticks(4)
			assert(director.state_machines:matches_state(room_state), 'incorrect incantation activated seal')
			for index = 1, #seal_sequence do t:press(seal_sequence[index], 2) end
			t:wait_until('seal dissolution', function() return director.state_machines:matches_state(seal_state) end, 120)
			assert(not world.gameplay_clock_running, 'dissolution did not suspend gameplay')

		end,
	},
}
