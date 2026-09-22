local combat_damage<const> = require('combat/damage')
local progression<const> = require('cartlib/progression')
local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')
local selected_apu_source<const>: *word = 0x0800018c
local appearance_source_address<const> = rom_dir.audio('appearance').addr
local record_appearance<const> = function(test)
	test.appearance_count = test.appearance_count + 1
end
local fixture<const> = require('tests/carts/pietious/fixture')
return {
	kind = 'integration',
	tests = {
		appearance_audio = function(t)
			local _director<const>, castle<const> = fixture.start_game(t)
			local room = castle.room
			local test<const> = {appearance_count = 0}
			do
				castle.events:on({
					event = 'appearance',
					subscriber = test,
					handler = record_appearance,
				})
				castle:switch_room('up', 0, 0)
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				assert(room.room_number == 6, 'appearance scenario did not enter room 6')
				castle:switch_room('left', 0, 0)
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				assert(room.room_number == 7, 'appearance scenario did not enter room 7')
				local cross_count = 0
				for i = 1, #room.enemies do
					local def<const> = room.enemies[i]
					if def.definition_id == 'enemy.breakablewall' then
						test.wall_id = def.member_id
					elseif def.definition_id == 'enemy.crossfoe' then
						cross_count = cross_count + 1
						if cross_count == 1 then
							test.destroyed_cross_id = def.member_id
						else
							test.live_cross_id = def.member_id
						end
					end
				end
				local cross<const> = registry:get('c').room.scene.members[test.destroyed_cross_id]
				cross.events:emit('damage.resolved', {
					status = 'applied',
					target_id = cross.id,
					target_key = cross.scene_member_id,
					target_kind = cross.enemy_kind,
					destroyed = true,
					room_number = room.room_number,
				})
				cross:mark_for_disposal()
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				assert(registry:get('c').room.scene.members[test.destroyed_cross_id] == nil, 'room 7 peer survived its disposal barrier')
				local wall<const> = registry:get('c').room.scene.members[test.wall_id]
				local player<const> = registry:get('pietolon')
				wall.health = 1
				player.sword_strike_id = player.sword_strike_id + 1
				wall.events:emit('overlap.begin', {
					other_id = 'test.sword',
					other_collider_local_id = 'sword',
					phase = 'begin',
				})
				assert(progression.get(castle, 'castlewalldestroyed'), 'room 7 wall condition was not retained')
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				assert(registry:get('c').room.scene.members[test.wall_id] == nil, 'room 7 breakable wall survived destruction')
				assert(registry:get('c').room.scene.members[test.destroyed_cross_id] == nil, 'destroying the room 7 wall respawned a defeated peer')
				assert(registry:get('c').room.scene.members[test.live_cross_id] ~= nil, 'destroying the room 7 wall removed a live peer')
				assert(#room.wall_instances == 0, 'room collision retained the destroyed breakable wall')
				assert(test.appearance_count == 1, 'room 7 wall did not emit exactly one reveal cue')
				assert(*selected_apu_source == appearance_source_address, 'room 7 wall did not select the appearance audio')
				castle:switch_room('right', 0, 0)
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				assert(room.room_number == 6, 'green vase scenario did not return to room 6')
				castle:switch_room('up', 0, 0)
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				assert(room.room_number == 13, 'green vase scenario did not enter room 13')
				local player<const> = registry:get('pietolon')
				player.status.inventory_items.greenvase = false
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
				assert(progression.get(castle, 'cloud_1_destroyed'), 'cloud defeat did not retain its reveal condition')
				test.vase_id = room.items[1].member_id
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			assert(registry:get('c').room.scene.members[test.vase_id] ~= nil, 'green vase did not spawn when its cloud was defeated')
			assert(test.appearance_count == 2, 'green vase did not emit exactly one reveal cue')
			assert(*selected_apu_source == appearance_source_address)
		end,
	},
}
