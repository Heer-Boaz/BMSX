local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local find_daemon_def<const> = function(room)
	for index = 1, #room.enemies do
		local def<const> = room.enemies[index]
		if def.definition_id == 'enemy.daemon' then
			return def
		end
	end
end
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		boss_item_screen = function(t)
			local director<const>, castle<const>, player<const> = fixture.start_game(t)
			local screen<const> = registry:get('item_screen')
			local room_state<const> = director.state_machines:bind_state_path('/room')
			local item_active<const> = director.state_machines:bind_state_path('/item_screen/active')
			local closed<const> = screen.state_machines:bind_state_path('/closed')
			local room
			local test<const> = {}
			local from_room_number<const> = castle.current_room_number
			room = castle:load_room(100)
			castle:commit_room_switch({
				from_room_number = from_room_number,
				to_room_number = 100,
				direction = 'down',
			}, 1, 2, 5)
			player.state_machines:transition_to('/quiet')
			player.x = 32
			player.y = 96
			local def<const> = find_daemon_def(room)
			assert(def ~= nil, 'room 100 has no daemon definition')
			test.daemon_id = def.member_id

			t:at_boundary(world:request_mutation_boundary(), 30)
			local daemon<const> = castle.room.scene.members[test.daemon_id]
			director.state_machines:transition_to('/daemon_appearance')
			t:wait_until('daemon fight', function()
				return world.active_space_id == 'main' and director.state_machines:matches_state(room_state) and daemon.behaviour.enabled
			end, 1000)
			t:press('lb', 4, 1)
			t:wait_until('fight inventory', function() return world.active_space_id == 'item' and director.state_machines:matches_state(item_active) end, 120)
			assert(screen.secondary_weapon_selection_index == 0, 'inventory opened on wrong secondary weapon')
			t:press('left', 4, 1)
			t:wait_until('wrap left', function() return screen.secondary_weapon_selection_index == 1 end, 120)
			assert(player.status.secondary_weapon == 'spyglass', 'left did not wrap to final owned weapon')
			t:press('right', 4, 1)
			t:wait_until('wrap right', function() return screen.secondary_weapon_selection_index == 0 end, 120)
			assert(player.status.secondary_weapon == 'pepernoot', 'right did not wrap to first owned weapon')
			t:press('lb', 4, 1)
			t:wait_until('fight resumed', function() return world.active_space_id == 'main' and director.state_machines:matches_state(room_state) end, 120)
			assert(screen.state_machines:matches_state(closed), 'inventory remained open after returning to fight')
			assert(daemon.visible and daemon.behaviour.enabled and daemon.collider.enabled, 'daemon did not resume after inventory closed')

		end,
	},
}
