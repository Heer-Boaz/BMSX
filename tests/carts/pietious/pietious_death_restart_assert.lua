local progression<const> = require('cartlib/progression')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local castle_map<const> = require('castle/map')

local dying_imgids<const> = {
	'pietolon_dying_1',
	'pietolon_dying_2',
	'pietolon_dying_3',
	'pietolon_dying_4',
	'pietolon_dying_5',
}

__bmsx_host_test = {
	frames = 0,
	phase = 'enter_world',
	dying_pose = 1,
	saw_curtain = false,
	saw_transition = false,
	death_screen_frames = 0,
}

function __bmsx_host_test.setup()
	registry:get('d').request_new_game()
end

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil
		and registry:get('room') ~= nil
		and registry:get('pietolon') ~= nil
		and registry:get('d') ~= nil
		and registry:get('transition') ~= nil
		and registry:get('ui') ~= nil
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 600, 'death restart scenario timed out phase=' .. test.phase)

	local castle<const> = registry:get('c')
	local room<const> = registry:get('room')
	local player<const> = registry:get('pietolon')
	local director<const> = registry:get('d')
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
		test.death_curtain_state = director.state_machines:bind_state_path('/death_curtain')
		test.death_screen_state = director.state_machines:bind_state_path('/death_screen')
		local ui<const> = registry:get('ui')
		ui.hud_health_level = 0
		ui.hud_health_target = 0
		player.health = 0
		player:start_dying()
		assert(player.state_machines:matches_state(test.dying_state), 'player did not enter dying state')
		test.phase = 'dying'
		return false
	end

	if test.phase == 'dying' then
		assert(world.active_space_id == 'main', 'death animation left gameplay before the curtain')
		assert(player.state_machines:matches_state(test.dying_state),
			'player left dying before the death animation completed')
		local imgid<const> = player.sprite_component.imgid
		if imgid == dying_imgids[test.dying_pose + 1] then
			test.dying_pose = test.dying_pose + 1
		else
			assert(imgid == dying_imgids[test.dying_pose], 'death animation skipped or reversed a pose')
		end
		if director.state_machines:matches_state(test.death_curtain_state) then
			test.saw_curtain = true
			assert(test.dying_pose == #dying_imgids, 'death animation ended before its final pose')
			assert(registry:get(test.item_id) == test.item,
				'death curtain disposed the room before it finished closing')
			test.last_curtain_width = director.curtain_width
			test.phase = 'curtain'
			return false
		end
		return false
	end

	if test.phase == 'curtain' and world.active_space_id == 'main' then
		assert(director.state_machines:matches_state(test.death_curtain_state),
			'death curtain stopped before entering the game-over screen')
		assert(director.curtain_width >= test.last_curtain_width,
			'death curtain moved backwards while closing')
		test.last_curtain_width = director.curtain_width
		assert(registry:get(test.item_id) == test.item,
			'death curtain disposed the room before it finished closing')
		return false
	end

	if world.active_space_id == 'transition' then
		assert(director.state_machines:matches_state(test.death_screen_state),
			'death restart entered transition space without the game-over screen')
		assert(test.saw_curtain, 'death restart skipped the closing curtain')
		assert(test.last_curtain_width > 0, 'death curtain never advanced')
		local transition_screen<const> = registry:get('transition')
		assert(transition_screen.text_component.visible, 'game-over text is hidden')
		assert(transition_screen.text_component.text == 'PROBEER HET NOG EENS...',
			'game-over text differs from the original Pietious screen')
		test.saw_transition = true
		test.death_screen_frames = test.death_screen_frames + 1
		assert(registry:get(test.item_id) == nil,
			'room object was admitted before the death restart barrier completed')
		test.phase = 'restart'
		return false
	end

	assert(world.active_space_id == 'main', 'death restart entered an unexpected space')
	local transition<const> = castle_map.world_transitions.world_1
	assert(test.saw_transition, 'death restart skipped the transition space')
	assert(test.death_screen_frames >= flow_death_screen_frames,
		'death restart skipped the game-over screen hold')
	assert(castle.current_room_number == transition.world_room_number,
		'death did not return to the current world entrance')
	assert(room.room_number == transition.world_room_number, 'room state did not reload the world entrance')
	assert(player.x == transition.world_spawn_x and player.y == transition.world_spawn_y,
		'player did not respawn at the world entrance')
	assert(player.facing == transition.world_spawn_facing, 'player respawn facing is wrong')
	assert(player.health == player.max_health, 'player health was not restored after death')
	local ui<const> = registry:get('ui')
	assert(ui.hud_health_level == player.max_health, 'health bar did not snap to restored health')
	assert(ui.hud_health_target == player.max_health, 'health bar retained a stale target after restart')
	assert(player.state_machines:matches_state(test.quiet_state), 'player did not return to quiet after death')
	assert(progression.get(castle, 'staff1destroyed'),
		'death incorrectly reset defeat retained for the current world visit')
	local item<const> = registry:get(test.item_id)
	assert(item ~= nil, 'world entrance room object did not respawn after death')
	assert(item ~= test.item, 'death restart reused the disposed room object')
	assert(not castle.room_enter_pending, 'death restart did not publish room entry')
	return true
end
