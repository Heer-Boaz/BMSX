local world<const> = require('cartlib/world/world')
local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
require('constants')
local castle_map<const> = require('castle/map')
local apu_slot<const>: *word = 0x08000148
local selected_apu_source<const>: *word = 0x0800018c
local appearance_source_address<const> = rom_dir.audio('appearance').addr
local game_start_source_address<const> = rom_dir.audio('gamestart').addr
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		enter_world = function(t)
			local _director<const>, castle<const>, player<const> = fixture.start_game(t)
			local world_transition<const> = castle_map.definition.world_transitions.world_1
			local test<const> = { stable_frames = 0 }

			local room = registry:get('c').room

			local castle_room_number<const> = 8
			local from<const> = castle.current_room_number

			room = castle:load_room(castle_room_number)
			castle:commit_room_switch({ from_room_number = from, to_room_number = castle_room_number, direction = 'left' }, 0, world_transition.castle_map_x, world_transition.castle_map_y)
			local selected_entrance<const> = room.world_entrance_instances[1]
			room.map_id = 0
			room.map_x = world_transition.castle_map_x
			room.map_y = world_transition.castle_map_y
			room.last_room_switch = nil
			castle.session.world_entrances[world_transition.target].state = 'open'

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

			t:press('ArrowDown', 2)
			t:wait_until('world entrance completes and settles', function()
				*apu_slot = 0
				local selected_source<const> = *selected_apu_source
				assert(selected_source ~= appearance_source_address,
				'world entry emitted the unrelated appearance cue')
				if selected_source == game_start_source_address then
					test.saw_game_start = true
				end

				local castle<const> = registry:get('c')
				local room = registry:get('c').room
				local player<const> = registry:get('pietolon')
				local sprite<const> = player.sprite_component
				if sprite.region_width ~= nil and sprite.region_height == 0 then
					test.saw_hidden_player = true
				end
				local feet_y<const> = player.y + player.height
				local left_x<const> = player.x + 1
				local right_x<const> = player.x + player.width - 2
				local player_on_floor<const> = room:has_collision_flags_at_world(left_x, feet_y + 1, collision_flags_solid_mask, true)
				or room:has_collision_flags_at_world(right_x, feet_y + 1, collision_flags_solid_mask, true)

				local final_outcome<const> = world.active_space_id == 'main'
				and castle.current_room_number == world_transition.world_room_number
				and room.world_number == world_transition.world_number
				and room.map_id == world_transition.world_number
				and room.map_x == world_transition.world_map_x
				and room.map_y == world_transition.world_map_y
				and player.x == world_transition.world_spawn_x
				and player.y == world_transition.world_spawn_y
				and player.facing == world_transition.world_spawn_facing
				and player_on_floor
				and test.saw_hidden_player

				if final_outcome then
					assert(test.saw_game_start,
					'world banner did not select the game-start cue')
					test.stable_frames = test.stable_frames + 1
					return test.stable_frames >= 10
				end

				test.stable_frames = 0
				return false
			end, (player_world_enter_frame_count + flow_banner_prewait_frames + flow_world_banner_frames
			+ flow_room_transition_frames + flow_room_switch_wait_frames) * 3)

		end,
	},
}
