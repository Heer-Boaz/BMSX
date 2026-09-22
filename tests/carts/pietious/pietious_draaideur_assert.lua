local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')
local selected_apu_source<const>: *word = 0x0800018c
local rotatedoor_source_address<const> = rom_dir.audio('rotatedoor').addr
local player<const> = {
	x = 0,
	y = 64,
	width = 16,
	height = 16,
	walking_right = false,
	doorpass_count = 0,
}
function player:has_tag(tag)
	return self.walking_right and tag == 'v.wr'
end
function player:start_slow_doorpass()
	self.doorpass_count = self.doorpass_count + 1
end
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		draaideur = function(t)
			fixture.start_game(t)
			local door_x<const> = 128
			player.x = door_x - player.width + 1
			registry:get('c').room.scene:spawn('draaideur', {
				id = 'probe.draaideur',
				space_id = 'main',
				castle = registry:get('c'),
				player = player,
				pos = { x = door_x, y = player.y, z = 22 },
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
