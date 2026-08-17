local world<const> = require('cartlib/world/world')
local progression<const> = require('cartlib/progression')
local registry<const> = require('cartlib/registry')
local castle_map<const> = require('castle/map')
local combat_damage<const> = require('combat/damage')

__bmsx_host_test = __bmsx_host_test or {
	frames = 0,
	appearance_count = 0,
}

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
	local enemies<const> = castle_map.room_templates[room_number].enemies
	for i = 1, #enemies do
		local enemy<const> = enemies[i]
		if enemy.destroyed_condition == condition then
			castle.events:emit('damage.resolved', {
				target_id = enemy.id,
				target_kind = enemy.kind,
				destroyed = true,
				room_number = room_number,
			})
			return
		end
	end
	error('missing destroyed condition source ' .. condition)
end

function __bmsx_host_test.setup()
	return host.press('Enter', 2)
end

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil and registry:get('room') ~= nil and registry:get('pietolon') ~= nil
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 480, 'enemy region-respawn scenario timed out')
	if world.active_space_id ~= 'main' then
		return false
	end

	local castle<const> = registry:get('c')
	local room<const> = registry:get('room')
	local phase<const> = test.phase
	if phase == nil then
		castle.events:on({
			event = 'appearance',
			subscriber = test,
			handler = record_appearance,
		})
		assert(progression.get(castle, 'debug.world1_stairs'), 'starting ladder debug setting is missing')
		castle:enter_world('world_1')
		test.phase = 1
	elseif phase == 1 then
		assert(progression.get(castle, 'r109.stairs'), 'starting ladder debug setting did not seed world 1')
		assert(test.appearance_count == 0, 'starting ladder debug setting emitted the reveal cue')
		assert(not progression.get(castle, 'staff1destroyed'), 'starting ladder debug setting defeated staff 1')
		assert(not progression.get(castle, 'staff2destroyed'), 'starting ladder debug setting defeated staff 2')
		assert(not progression.get(castle, 'staff3destroyed'), 'starting ladder debug setting defeated staff 3')
		progression.set(castle, 'debug.world1_stairs', false)
		castle:leave_world_to_castle()
		test.phase = 2
	elseif phase == 2 then
		assert(not progression.get(castle, 'r109.stairs'), 'world 1 ladder survived the region boundary')
		castle:enter_world('world_1')
		test.phase = 3
	elseif phase == 3 then
		assert(not progression.get(castle, 'r109.stairs'), 'world 1 ladder appeared without its debug setting')
		castle:switch_room('left', 0, 0)
		test.phase = 4
	elseif phase == 4 then
		castle:switch_room('left', 0, 0)
		test.phase = 5
	elseif phase == 5 then
		castle:switch_room('down', 0, 0)
		test.phase = 6
	elseif phase == 6 then
		assert(room.room_number == 106, 'enemy respawn scenario did not enter room 106')
		local enemy_defs<const> = {}
		for i = 1, #room.enemies do
			local enemy_def<const> = room.enemies[i]
			if enemy_def.kind == 'marspeinenaardappel' then
				enemy_defs[#enemy_defs + 1] = enemy_def
			end
		end
		local enemy_def<const> = enemy_defs[1]
		assert(enemy_def.retain_defeat_in_region, 'room 106 enemy must retain defeat within world 1')
		test.room106_enemy_defs = enemy_defs
		test.enemy_id = enemy_def.id
		local enemy<const> = registry:get(enemy_def.id)
		assert(enemy ~= nil, 'room 106 enemy did not spawn')
		destroy_enemy(enemy)
		assert(progression.get(castle, enemy_def.id), 'enemy defeat was not retained in world 1')
		test.phase = 7
	elseif phase == 7 then
		castle:switch_room('up', 0, 0)
		test.phase = 8
	elseif phase == 8 then
		castle:switch_room('down', 0, 0)
		test.phase = 9
	elseif phase == 9 then
		assert(room.room_number == 106, 'enemy respawn scenario did not return to room 106')
		assert(registry:get(test.enemy_id) == nil, 'enemy respawned during the same world visit')
		test.room106_destroy_index = 2
		test.phase = 'destroy_room106_enemies'
	elseif phase == 'destroy_room106_enemies' then
		local enemy_defs<const> = test.room106_enemy_defs
		local index<const> = test.room106_destroy_index
		if index <= #enemy_defs then
			local enemy<const> = registry:get(enemy_defs[index].id)
			assert(enemy ~= nil, 'room 106 enemy disappeared before it was defeated')
			destroy_enemy(enemy)
			test.room106_destroy_index = index + 1
			return false
		end
		test.phase = 'verify_room106_wall'
	elseif phase == 'verify_room106_wall' then
		assert(progression.get(castle, 'r106.wall'), 'room 106 wall condition did not open')
		assert(#room.wall_instances == 0, 'room 106 collision retained the disappearing wall')
		assert(test.appearance_count == 1, 'room 106 wall did not emit exactly one reveal cue')
		castle:leave_world_to_castle()
		assert(not progression.get(castle, test.enemy_id), 'enemy defeat survived the world-to-castle boundary')
		assert(not progression.get(castle, 'r106.wall'), 'room 106 wall survived the world-to-castle boundary')
		test.phase = 10
	elseif phase == 10 then
		castle:enter_world('world_1')
		test.phase = 11
	elseif phase == 11 then
		castle:switch_room('left', 0, 0)
		test.phase = 12
	elseif phase == 12 then
		castle:switch_room('left', 0, 0)
		test.phase = 13
	elseif phase == 13 then
		castle:switch_room('down', 0, 0)
		test.phase = 14
	elseif phase == 14 then
		assert(registry:get(test.enemy_id) ~= nil, 'enemy did not respawn on the next world visit')
		assert(#room.wall_instances == 1, 'room 106 wall did not respawn on the next world visit')
		assert(not progression.get(castle, 'r109.stairs'), 'world 1 ladder was already open before the staff encounter')
		emit_condition_source_destroyed(castle, 104, 'staff1destroyed')
		emit_condition_source_destroyed(castle, 107, 'staff2destroyed')
		emit_condition_source_destroyed(castle, 110, 'staff3destroyed')
		assert(progression.get(castle, 'r109.stairs'), 'staff progression did not open the world stairs')
		assert(test.appearance_count == 2, 'staff progression did not emit one reveal cue')
		castle:leave_world_to_castle()
		test.phase = 15
	elseif phase == 15 then
		assert(not progression.get(castle, 'staff1destroyed'), 'staff 1 defeat survived the region boundary')
		assert(not progression.get(castle, 'staff2destroyed'), 'staff 2 defeat survived the region boundary')
		assert(not progression.get(castle, 'staff3destroyed'), 'staff 3 defeat survived the region boundary')
		assert(not progression.get(castle, 'r109.stairs'), 'world 1 ladder survived the region boundary')
		castle:enter_world('world_1')
		test.phase = 16
	elseif phase == 16 then
		castle:switch_room('left', 0, 0)
		test.phase = 17
	elseif phase == 17 then
		castle:switch_room('up', 0, 0)
		test.phase = 18
	elseif phase == 18 then
		castle:switch_room('up', 0, 0)
		test.phase = 19
	else
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
		assert(registry:get(staff_def.id) ~= nil, 'staff did not respawn on the next world visit')
		emit_condition_source_destroyed(castle, 104, 'staff1destroyed')
		emit_condition_source_destroyed(castle, 107, 'staff2destroyed')
		emit_condition_source_destroyed(castle, 110, 'staff3destroyed')
		assert(test.appearance_count == 3, 'staff progression did not repeat the reveal cue after reset')
		return true
	end
	return false
end
