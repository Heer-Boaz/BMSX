__bmsx_host_test = __bmsx_host_test or {
	frame_count = 0,
	stable_frames = 0,
}

function __bmsx_host_test.ready()
	return oget('c') ~= nil and oget('room') ~= nil and oget('pietolon') ~= nil and oget('d') ~= nil
end

function __bmsx_host_test.setup()
	local castle_map<const> = require('castle_map')
	local world_transition<const> = castle_map.world_transitions.world_1
	local castle<const> = oget('c')
	local room<const> = oget('room')
	local castle_room_number<const> = 8
	local selected_entrance<const> = castle_map.room_templates[castle_room_number].world_entrances[1]

	room:load_room(castle_room_number)
	castle.current_room_number = castle_room_number
	castle.world_entrance_states = {}
	castle:sync_world_entrance_states_for_room(room)
	room.map_id = 0
	room.map_x = world_transition.castle_map_x
	room.map_y = world_transition.castle_map_y
	room.last_room_switch = nil
	castle.world_entrance_states[world_transition.target].state = 'open'

	local player<const> = oget('pietolon')
	player:clear_input_state()
	player:zero_motion()
	player:reset_fall_substate_sequence()
	player:cancel_sword()
	player.jump_substate = 0
	player.jump_inertia = 0
	player.on_vertical_elevator = false
	player.jumping_from_elevator = false
	player.stairs_landing_sound_pending = false

	player.x = selected_entrance.stair_x
	player.y = selected_entrance.stair_y
	player.facing = 1
	player.events:emit('landed_to_quiet')
	return { press = 'ArrowDown', hold_frames = 2 }
end

function __bmsx_host_test.update(_frame, _current_music)
	local constants<const> = require('constants')
	local castle_map<const> = require('castle_map')
	local world_transition<const> = castle_map.world_transitions.world_1
	local castle<const> = oget('c')
	local room<const> = oget('room')
	local player<const> = oget('pietolon')

	local feet_y<const> = player.y + player.height
	local left_x<const> = player.x + 1
	local right_x<const> = player.x + player.width - 2
	local player_on_floor<const> = room:has_collision_flags_at_world(left_x, feet_y + 1, constants.collision_flags.solid_mask, true)
		or room:has_collision_flags_at_world(right_x, feet_y + 1, constants.collision_flags.solid_mask, true)

	local final_outcome<const> = get_space() == 'main'
		and castle.current_room_number == world_transition.world_room_number
		and room.world_number == world_transition.world_number
		and room.map_id == world_transition.world_number
		and room.map_x == world_transition.world_map_x
		and room.map_y == world_transition.world_map_y
		and player.x == world_transition.world_spawn_x
		and player.y == world_transition.world_spawn_y
		and player.facing == world_transition.world_spawn_facing
		and player_on_floor

	if final_outcome then
		__bmsx_host_test.stable_frames = __bmsx_host_test.stable_frames + 1
		return __bmsx_host_test.stable_frames >= 10
	end

	__bmsx_host_test.stable_frames = 0
	__bmsx_host_test.frame_count = __bmsx_host_test.frame_count + 1
	assert(__bmsx_host_test.frame_count < 400,
		'enter-world timed out'
			.. ' room=' .. tostring(castle.current_room_number) .. '/' .. tostring(world_transition.world_room_number)
			.. ' world=' .. tostring(room.world_number) .. '/' .. tostring(world_transition.world_number)
			.. ' space=' .. tostring(get_space())
			.. ' map=' .. tostring(room.map_id) .. ',' .. tostring(room.map_x) .. ',' .. tostring(room.map_y)
			.. ' player=' .. tostring(player.x) .. ',' .. tostring(player.y) .. ',' .. tostring(player.facing)
			.. ' expectedPlayer=' .. tostring(world_transition.world_spawn_x) .. ',' .. tostring(world_transition.world_spawn_y) .. ',' .. tostring(world_transition.world_spawn_facing)
			.. ' onFloor=' .. tostring(player_on_floor))
	return false
end
