local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		halo = function(t)
			local director<const>, castle<const>, player<const> = fixture.start_game(t)
			local room_state<const> = director.state_machines:bind_state_path('/room')
			local item_active<const> = director.state_machines:bind_state_path('/item_screen/active')
			assert(player.status.inventory_items.halo, 'fixture does not own the halo')
			t:press('ShiftLeft', 2)
			t:wait_until('inventory opened', function() return director.state_machines:matches_state(item_active) end, 120)
			t:press('Enter', 2)
			t:wait_until('halo returns to room', function() return director.state_machines:matches_state(room_state) end, 240)
			assert(world.active_space_id == 'main', 'halo did not restore the main world space')
			assert(castle.current_room_number == 1, 'halo did not resolve to castle room 1')

		end,
	},
}
