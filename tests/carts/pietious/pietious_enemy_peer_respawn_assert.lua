local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		enemy_peer_respawn = function(t)
			local _director<const>, castle<const> = fixture.start_game(t)
			local room
			local test<const> = {}
			castle:switch_room('right', 0, 0)
			room = castle.room
			assert(room.room_number == 2, 'enemy peer-respawn scenario did not enter room 2')
			local first_def<const> = room.enemies[1]
			local second_def<const> = room.enemies[2]
			assert(not first_def.retain_defeat_in_region, 'first room 2 enemy unexpectedly retains region defeat')
			assert(not second_def.retain_defeat_in_region, 'second room 2 enemy unexpectedly retains region defeat')
			test.first_id = first_def.member_id
			test.second_id = second_def.member_id

			t:at_boundary(world:request_mutation_boundary(), 30)
			local ids<const> = {test.first_id, test.second_id}
			for index = 1, #ids do
				local enemy<const> = castle.room.scene.members[ids[index]]
				assert(enemy ~= nil, 'room enemy did not spawn')
				enemy.events:emit('damage.resolved', {
					status = 'applied', target_id = enemy.id, target_key = enemy.scene_member_id,
					target_kind = enemy.enemy_kind, destroyed = true, room_number = room.room_number,
				})
				enemy:mark_for_disposal()
				t:at_boundary(world:request_mutation_boundary(), 30)
				for defeated = 1, index do
					assert(castle.room.scene.members[ids[defeated]] == nil, 'defeating a peer respawned an enemy')
				end
			end

		end,
	},
}
