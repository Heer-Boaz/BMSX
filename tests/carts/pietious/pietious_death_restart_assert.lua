local progression<const> = require('cartlib/progression')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local castle_map<const> = require('castle/map')

__bmsx_host_test = {
	frames = 0,
	phase = 'enter_world',
	saw_dying_tick = false,
	saw_transition = false,
}

function __bmsx_host_test.setup()
	return host.press('Enter', 2)
end

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil
		and registry:get('room') ~= nil
		and registry:get('pietolon') ~= nil
		and registry:get('d') ~= nil
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 240, 'death restart scenario timed out phase=' .. test.phase)

	local castle<const> = registry:get('c')
	local room<const> = registry:get('room')
	local player<const> = registry:get('pietolon')
	if test.phase == 'enter_world' then
		if world.active_space_id ~= 'main' then
			return false
		end
		player.inventory_items.map_world1 = false
		local switch<const> = castle:enter_world('world_1')
		player:apply_spawn_position(switch)
		player:emit_room_switched(switch.from_room_number, switch.to_room_number, 'world_enter')
		castle:emit_room_enter()
		test.phase = 'start_dying'
		return false
	end

	if test.phase == 'start_dying' then
		assert(world.active_space_id == 'main', 'world entry did not retain the gameplay space')
		assert(room.room_number == castle_map.world_transitions.world_1.world_room_number,
			'death scenario did not enter the world entrance room')
		local item_def<const> = room.items[1]
		assert(item_def.item_type == 'map_world1', 'world entrance room map item is missing')
		local item<const> = registry:get(item_def.id)
		assert(item ~= nil, 'world entrance room map item did not spawn')
		progression.set(castle, 'staff1destroyed', true)
		test.item_id = item_def.id
		test.item = item
		test.dying_state = player.state_machines:bind_state_path('/dying')
		test.quiet_state = player.state_machines:bind_state_path('/quiet')
		player.health = 0
		player:start_dying()
		assert(player.state_machines:matches_state(test.dying_state), 'player did not enter dying state')
		test.phase = 'dying'
		return false
	end

	if test.phase == 'dying' then
		if world.active_space_id == 'main' then
			assert(player.state_machines:matches_state(test.dying_state),
				'player left dying before the death animation completed')
			if player.death_timer > 0 then
				test.saw_dying_tick = true
			end
			return false
		end
		assert(world.active_space_id == 'transition', 'death restart entered an unexpected space')
		assert(test.saw_dying_tick, 'death animation never advanced in the gameplay space')
		test.saw_transition = true
		assert(registry:get(test.item_id) == nil,
			'old room objects survived the death restart disposal barrier')
		test.phase = 'restart'
		return false
	end

	if world.active_space_id ~= 'main' then
		assert(world.active_space_id == 'transition', 'death restart entered an unexpected space')
		assert(registry:get(test.item_id) == nil,
			'room object was admitted before the death restart barrier completed')
		return false
	end

	local transition<const> = castle_map.world_transitions.world_1
	assert(test.saw_transition, 'death restart skipped the transition space')
	assert(castle.current_room_number == transition.world_room_number,
		'death did not return to the current world entrance')
	assert(room.room_number == transition.world_room_number, 'room state did not reload the world entrance')
	assert(player.x == transition.world_spawn_x and player.y == transition.world_spawn_y,
		'player did not respawn at the world entrance')
	assert(player.facing == transition.world_spawn_facing, 'player respawn facing is wrong')
	assert(player.health == player.max_health, 'player health was not restored after death')
	assert(player.state_machines:matches_state(test.quiet_state), 'player did not return to quiet after death')
	assert(progression.get(castle, 'staff1destroyed'),
		'death incorrectly reset defeat retained for the current world visit')
	local item<const> = registry:get(test.item_id)
	assert(item ~= nil, 'world entrance room object did not respawn after death')
	assert(item ~= test.item, 'death restart reused the disposed room object')
	assert(not castle.room_enter_pending, 'death restart did not publish room entry')
	return true
end
