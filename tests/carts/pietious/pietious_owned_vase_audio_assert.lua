local combat_damage<const> = require('combat/damage')
local progression<const> = require('cartlib/progression')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local record_appearance<const> = function(test)
	test.appearance_count = test.appearance_count + 1
end
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		owned_vase_audio = function(t)
			local _director<const>, castle<const> = fixture.start_game(t)
			local room = castle.room
			local test<const> = {appearance_count = 0}
			castle.events:on({
				event = 'appearance',
				subscriber = test,
				handler = record_appearance,
			})
			assert(room.player.status.inventory_items.greenvase, 'debug loadout does not own the green vase')
			castle:switch_room('up', 0, 0)
			room = castle.room

			t:at_boundary(world:request_mutation_boundary(), 30)
			assert(room.room_number == 6, 'owned green vase scenario did not enter room 6')
			castle:switch_room('up', 0, 0)
			room = castle.room

			t:at_boundary(world:request_mutation_boundary(), 30)
			assert(room.room_number == 13, 'owned green vase scenario did not enter room 13')
			local cloud_def<const> = room.enemies[1]
			assert(cloud_def.definition_id == 'enemy.cloud', 'room 13 cloud definition is missing')
			local cloud<const> = registry:get('c').room.scene.members[cloud_def.member_id]
			assert(cloud ~= nil, 'room 13 cloud did not spawn')
			cloud.health = 1
			local result<const> = combat_damage.resolve(cloud, combat_damage.build_weapon_request(
			cloud,
			cloud.enemy_kind,
			{ other_id = 'test.sword' },
			'sword'
			))
			cloud:process_damage_result(result)
			assert(progression.get(castle, 'cloud_1_destroyed'), 'cloud defeat did not retain its condition')
			test.vase_id = room.items[1].member_id

			t:at_boundary(world:request_mutation_boundary(), 30)
			assert(registry:get('c').room.scene.members[test.vase_id] == nil, 'owned green vase was spawned again')
			assert(test.appearance_count == 0, 'owned green vase emitted a false reveal cue')

		end,
	},
}
