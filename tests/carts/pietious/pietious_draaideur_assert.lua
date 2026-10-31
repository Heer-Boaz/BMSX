local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')
local selected_apu_source<const>: *word = 0x0800018c
local rotatedoor_source_address<const> = rom_dir.audio('rotatedoor').addr
local has_tag<const> = function(self, tag)
	return self.walking_right and tag == 'v.wr'
end
local start_slow_doorpass<const> = function(self)
	self.doorpass_count = self.doorpass_count + 1
end
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		draaideur = function(t)
			local _director<const>, _castle<const>, player<const> = fixture.start_game(t)
			player.state_machines:set_enabled(false)
			player.walking_right = false
			player.doorpass_count = 0
			player.has_tag = has_tag
			player.start_slow_doorpass = start_slow_doorpass
			local door_x<const> = 128
			player:set_global_position(door_x - player.width + 1, 64)
			registry:get('c').room.scene:spawn('draaideur', {
				id = 'probe.draaideur',
				space_id = 'main',
				castle = registry:get('c'),
				player = player,
				position = { x = door_x, y = player.oy },
				order = 22,
			})

			t:at_boundary(world:request_mutation_boundary(), 30)
			local door<const> = registry:get('probe.draaideur')
			local active<const> = door.state_machines:bind_state_path('/active')
			local opening<const> = door.state_machines:bind_state_path('/opening_rightward')
			assert(door.state_machines:matches_state(active), 'door did not enter active state')
			assert(door.collision_enabled and door.sprite_component.imgid == 'draaideur_1_closed', 'door did not start closed')
			player.walking_right = true
			local gameplay_time_ms = world.gameplay_time_ms
			local poses<const> = { 'draaideur_1_closed', 'draaideur_1_open_1', 'draaideur_1_open_2', 'draaideur_1_open_3' }
			for step = 1, draaideur_push_steps + draaideur_pose_steps * 4 do
				t:wait_until('door gameplay update', function() return world.gameplay_time_ms ~= gameplay_time_ms end, 10)
				gameplay_time_ms = world.gameplay_time_ms
				if step < draaideur_push_steps then
					assert(door.state_machines:matches_state(active), 'door opened before 0x1e-update push boundary')
					assert(door.collision_enabled, 'door released collision while closed')
				elseif step == draaideur_push_steps then
					assert(door.state_machines:matches_state(opening), 'door did not open at 0x1e-update boundary')
					assert(not door.collision_enabled, 'opening door retained collision')
					assert(player.doorpass_count == 1, 'door did not admit exactly one passage')
					assert(*selected_apu_source == rotatedoor_source_address, 'door admission did not select authored sound')
					assert(door.sprite_component.imgid == poses[1], 'door rotated before first six-update phase')
				elseif step < draaideur_push_steps + draaideur_pose_steps * 4 then
					local pose<const> = (step - draaideur_push_steps) // draaideur_pose_steps + 1
					assert(door.sprite_component.imgid == poses[pose], 'door did not retain its six-update pose')
				end
			end
			assert(door.state_machines:matches_state(active), 'door did not return to active state')
			assert(door.collision_enabled and door.sprite_component.imgid == poses[1], 'door did not close after four poses')

		end,
	},
}
