local world<const> = require('cartlib/world/world')
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		item_input = function(t)
			local director<const> = fixture.start_game(t)
			local room<const> = director.state_machines:bind_state_path('/room')
			local inventory<const> = director.state_machines:bind_state_path('/item_screen/active')

			t:press('F1', 4)
			t:wait_until('F1 opens inventory', function()
				return world.active_space_id == 'item' and director.state_machines:matches_state(inventory)
			end, 120)
			t:press('F1', 4)
			t:wait_until('F1 closes inventory', function()
				return world.active_space_id == 'main' and director.state_machines:matches_state(room)
			end, 120)

			t:press('ShiftLeft', 4)
			t:wait_until('left shift opens inventory', function()
				return world.active_space_id == 'item' and director.state_machines:matches_state(inventory)
			end, 120)
			t:press('ShiftRight', 4)
			t:wait_until('right shift closes inventory', function()
				return world.active_space_id == 'main' and director.state_machines:matches_state(room)
			end, 120)

			t:press('lb', 4, 1)
			t:wait_until('left shoulder opens inventory', function()
				return world.active_space_id == 'item' and director.state_machines:matches_state(inventory)
			end, 120)
			t:press('rb', 4, 1)
			t:wait_until('right shoulder closes inventory', function()
				return world.active_space_id == 'main' and director.state_machines:matches_state(room)
			end, 120)
		end,
	},
}
