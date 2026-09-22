local world<const> = require('cartlib/world/world')
local progression<const> = require('cartlib/progression')
local registry<const> = require('cartlib/registry')
local castle_map<const> = require('castle/map')
local combat_damage<const> = require('combat/damage')
local record_appearance<const> = function(test)
	test.appearance_count = test.appearance_count + 1
end
local destroy_enemy<const> = function(enemy)
	enemy.health = 1
	local result<const> = combat_damage.resolve(enemy, combat_damage.build_weapon_request(
	enemy,
	enemy.enemy_kind,
	{ other_id = 'test.sword' },
	'sword'
	))
	enemy:process_damage_result(result)
end
local emit_condition_source_destroyed<const> = function(castle, room_number, condition)
	local enemies<const> = castle_map.definition.rooms[room_number].enemies
	for i = 1, #enemies do
		local enemy<const> = enemies[i]
		if enemy.destroyed_condition == condition then
			castle.events:emit('damage.resolved', {
				target_key = enemy.member_id,
				target_kind = enemy.definition_id:sub(7),
				destroyed = true,
				room_number = room_number,
			})
			return
		end
	end
	error('missing destroyed condition source ' .. condition)
end
local fixture<const> = require('tests/carts/pietious/fixture')
return {
	kind = 'integration',
	tests = {
		enemy_region_respawn = function(t)
			local _director<const>, castle<const> = fixture.start_game(t)
			local room = castle.room
			local test<const> = {appearance_count = 0}
			do
				castle.events:on({
					event = 'appearance',
					subscriber = test,
					handler = record_appearance,
				})
				assert(progression.get(castle, 'debug.world1_stairs'), 'starting ladder debug setting is missing')
				castle:enter_world('world_1')
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				assert(progression.get(castle, 'r109.stairs'), 'starting ladder debug setting did not seed world 1')
				assert(test.appearance_count == 0, 'starting ladder debug setting emitted the reveal cue')
				assert(not progression.get(castle, 'staff1destroyed'), 'starting ladder debug setting defeated staff 1')
				assert(not progression.get(castle, 'staff2destroyed'), 'starting ladder debug setting defeated staff 2')
				assert(not progression.get(castle, 'staff3destroyed'), 'starting ladder debug setting defeated staff 3')
				progression.set(castle, 'debug.world1_stairs', false)
				castle:leave_world_to_castle()
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				assert(not progression.get(castle, 'r109.stairs'), 'world 1 ladder survived the region boundary')
				castle:enter_world('world_1')
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				assert(not progression.get(castle, 'r109.stairs'), 'world 1 ladder appeared without its debug setting')
				castle:switch_room('left', 0, 0)
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				castle:switch_room('left', 0, 0)
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				castle:switch_room('down', 0, 0)
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				assert(room.room_number == 106, 'enemy respawn scenario did not enter room 106')
				local enemy_defs<const> = {}
				for i = 1, #room.enemies do
					local enemy_def<const> = room.enemies[i]
					if enemy_def.definition_id == 'enemy.marspeinenaardappel' then
						enemy_defs[#enemy_defs + 1] = enemy_def
					end
				end
				local enemy_def<const> = enemy_defs[1]
				assert(enemy_def.retain_defeat_in_region, 'room 106 enemy must retain defeat within world 1')
				test.room106_enemy_defs = enemy_defs
				test.enemy_id = enemy_def.member_id
				local enemy<const> = registry:get('c').room.scene.members[enemy_def.member_id]
				assert(enemy ~= nil, 'room 106 enemy did not spawn')
				destroy_enemy(enemy)
				assert(progression.get(castle, enemy_def.member_id), 'enemy defeat was not retained in world 1')
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				castle:switch_room('up', 0, 0)
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				castle:switch_room('down', 0, 0)
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				assert(room.room_number == 106, 'enemy respawn scenario did not return to room 106')
				assert(registry:get('c').room.scene.members[test.enemy_id] == nil, 'enemy respawned during the same world visit')
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			for index = 2, #test.room106_enemy_defs do
				local enemy<const> = castle.room.scene.members[test.room106_enemy_defs[index].member_id]
				assert(enemy ~= nil, 'room enemy disappeared before defeat')
				destroy_enemy(enemy)
				t:at_boundary(world:request_mutation_boundary(), 30)
			end
			do
				assert(progression.get(castle, 'r106.wall'), 'room 106 wall condition did not open')
				assert(#room.wall_instances == 0, 'room 106 collision retained the disappearing wall')
				assert(test.appearance_count == 1, 'room 106 wall did not emit exactly one reveal cue')
				castle:leave_world_to_castle()
				assert(not progression.get(castle, test.enemy_id), 'enemy defeat survived the world-to-castle boundary')
				assert(not progression.get(castle, 'r106.wall'), 'room 106 wall survived the world-to-castle boundary')
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				castle:enter_world('world_1')
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				castle:switch_room('left', 0, 0)
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				castle:switch_room('left', 0, 0)
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				castle:switch_room('down', 0, 0)
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				assert(registry:get('c').room.scene.members[test.enemy_id] ~= nil, 'enemy did not respawn on the next world visit')
				assert(#room.wall_instances == 1, 'room 106 wall did not respawn on the next world visit')
				assert(not progression.get(castle, 'r109.stairs'), 'world 1 ladder was already open before the staff encounter')
				emit_condition_source_destroyed(castle, 104, 'staff1destroyed')
				emit_condition_source_destroyed(castle, 107, 'staff2destroyed')
				emit_condition_source_destroyed(castle, 110, 'staff3destroyed')
				assert(progression.get(castle, 'r109.stairs'), 'staff progression did not open the world stairs')
				assert(test.appearance_count == 2, 'staff progression did not emit one reveal cue')
				castle:leave_world_to_castle()
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				assert(not progression.get(castle, 'staff1destroyed'), 'staff 1 defeat survived the region boundary')
				assert(not progression.get(castle, 'staff2destroyed'), 'staff 2 defeat survived the region boundary')
				assert(not progression.get(castle, 'staff3destroyed'), 'staff 3 defeat survived the region boundary')
				assert(not progression.get(castle, 'r109.stairs'), 'world 1 ladder survived the region boundary')
				castle:enter_world('world_1')
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				castle:switch_room('left', 0, 0)
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				castle:switch_room('up', 0, 0)
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				castle:switch_room('up', 0, 0)
				room = castle.room
			end
			t:at_boundary(world:request_mutation_boundary(), 30)
			do
				assert(room.room_number == 104, 'staff progression scenario did not enter room 104')
				local staff_def
				for i = 1, #room.enemies do
					local candidate<const> = room.enemies[i]
					if candidate.destroyed_condition == 'staff1destroyed' then
						staff_def = candidate
						break
					end
				end
				assert(staff_def ~= nil, 'room 104 staff definition is missing')
				assert(registry:get('c').room.scene.members[staff_def.member_id] ~= nil, 'staff did not respawn on the next world visit')
				emit_condition_source_destroyed(castle, 104, 'staff1destroyed')
				emit_condition_source_destroyed(castle, 107, 'staff2destroyed')
				emit_condition_source_destroyed(castle, 110, 'staff3destroyed')
				assert(test.appearance_count == 3, 'staff progression did not repeat the reveal cue after reset')
			end
			t:at_boundary(world:request_mutation_boundary(), 30)

		end,
	},
}
