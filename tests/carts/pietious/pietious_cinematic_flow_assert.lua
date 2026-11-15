local clock<const> = require('cartlib/clock')
local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')
require('constants')
local apu_slot<const>: *word = 0x08000148
local selected_apu_source<const>: *word = 0x0800018c
local castle_source_address<const> = rom_dir.audio('music_castle').addr
local end_demo_source_address<const> = rom_dir.audio('enddemo').addr
local intro_logo_reveal_timeline_id<const> = 'intro.logo.reveal'
local intro_logo_hold_timeline_id<const> = 'intro.logo.hold'
local intro_logo_hold_frames<const> = 128
local record_room_enter<const> = function(test, _event_type, _emitter, payload)
	test.room_enter_count = test.room_enter_count + 1
	test.room_enter_payload = payload
end
local bind_completion_states<const> = function(test, director)
	test.victory_dance_state = director.state_machines:bind_state_path('/game_completion/victory_dance')
	test.room_curtain_state = director.state_machines:bind_state_path('/game_completion/room_curtain')
	test.end_demo_state = director.state_machines:bind_state_path('/game_completion/end_demo')
	test.end_demo_curtain_state = director.state_machines:bind_state_path('/game_completion/end_demo_curtain')
	test.epilogue_state = director.state_machines:bind_state_path('/game_completion/epilogue')
	test.ending_title_state = director.state_machines:bind_state_path('/title_screen')
end

return {
	kind = 'integration',
	tests = {
		cinematic_flow = function(t)
			t:wait_until('cinematic roots', function() return registry:get('d') ~= nil
				and registry:get('intro') ~= nil
				and registry:get('narrative') ~= nil
				and registry:get('end_demo') ~= nil
				and registry:get('title_screen') ~= nil end, 120)
			t:at_boundary(world:request_mutation_boundary(), 120)
			local test<const> = { room_enter_count = 0 }
			local director = registry:get('d')
			test.initial_director = director
			test.initial_castle = registry:get('c')
			test.initial_player = registry:get('pietolon')
			test.initial_room = test.initial_castle.room
			test.initial_session = test.initial_castle.session
			test.initial_x, test.initial_y = test.initial_player:get_global_position()
			test.elevator = test.initial_castle.elevators[1]
			test.elevator_x, test.elevator_y = test.elevator:get_global_position()
			test.initial_gameplay_time = world.gameplay_time_ms
			test.initial_castle.events:on({
				event = 'room.enter',
				subscriber = test,
				handler = record_room_enter,
			})
			test.intro_state = director.state_machines:bind_state_path('/intro')
			test.story_state = director.state_machines:bind_state_path('/story')
			test.title_state = director.state_machines:bind_state_path('/title_screen')
			test.title_wait_state = director.state_machines:bind_state_path('/title_start_wait')
			test.room_state = director.state_machines:bind_state_path('/room')
			assert(director.state_machines:matches_state(test.intro_state), 'Pietious did not boot into the Konami intro')
			assert(world.active_space_id == 'intro', 'intro did not own the presentation space')
			assert(test.initial_castle.room_enter_pending and not test.initial_room.tiles_visible
			and not director.ui.visual.visible, 'intro admitted the prepared room before gameplay')

			local intro<const> = registry:get('intro')
			intro.state_machines:transition_to('/hidden')
			intro.state_machines:transition_to('/playing/blank')
			local logo<const> = intro.logo_sprite
			local logo_x<const>, logo_y<const> = logo.owner:get_global_position()
			assert(logo.imgid == 'intro_konami'
			and logo_x == 40 and logo_y == 64
			and logo.region_width == 168 and logo.region_height == 1
			and not logo.visible and intro.logo_background.visible,
			'Konami logo did not enter its source-derived white presentation')
			intro.state_machines:transition_to('/playing/reveal')
			local reveal<const> = intro.timelines:get(intro_logo_reveal_timeline_id)
			assert(reveal.frame_duration == clock.frame_delta_milliseconds(),
			'Konami logo reveal did not match Pietious two-VBlank presentation cadence')
			intro.timelines:advance_to(intro_logo_reveal_timeline_id, 23)
			assert(logo.visible and logo.region_height == 24,
			'Konami logo midpoint differs from the Metal Gear row copier')
			intro.timelines:advance_to(intro_logo_reveal_timeline_id, 47)
			assert(logo.region_height == 48, 'Konami logo did not reveal all source scanlines')
			intro.state_machines:transition_to('/playing/hold')
			assert(intro.timelines:get(intro_logo_hold_timeline_id).duration_ms
			== intro_logo_hold_frames * clock.frame_delta_milliseconds(),
			'Konami logo hold did not retain its 256-VBlank duration')
			intro:finish()
			assert(not logo.visible and not intro.logo_background.visible,
			'finishing the Konami logo retained its presentation')
			assert(registry:get('narrative').text_component.presentation_oy == screen_height,
			'story did not start below the screen')

			t:wait_ticks(1)
			do
				assert(director.state_machines:matches_state(test.story_state), 'intro did not advance to the story')
				assert(world.active_space_id == 'narrative', 'story did not own the narrative presentation space')
				local narrative<const> = registry:get('narrative')
				test.story_requested_state = narrative.state_machines:bind_state_path('/story/requested')

			end
			t:press('a', 2, 1)
			t:wait_until('gamepad story skip', function() return registry:get('narrative').state_machines:matches_state(test.story_requested_state) end, 10)
			local story_fade_ticks = 0
			t:wait_until('physical story music fade', function()
				if not director.state_machines:matches_state(test.story_state) then return true end
				story_fade_ticks = story_fade_ticks + 1
				return false
			end, 1000)
			assert(story_fade_ticks > 1, 'story advanced before physical music fade')
			assert(director.state_machines:matches_state(test.title_state), 'story did not advance to the title screen')
			assert(world.active_space_id == 'title', 'title did not own the presentation space')

			assert(test.initial_player.wox == test.initial_x and test.initial_player.woy == test.initial_y
			and test.elevator.wox == test.elevator_x and test.elevator.woy == test.elevator_y,
			'intro and title advanced main-space player or elevator simulation')
			assert(world.gameplay_time_ms > test.initial_gameplay_time,
			'presentation stopped the existing World gameplay clock')
			t:down('ArrowRight')
			t:press('AltRight', 2)
			t:wait_until('initial title start wait', function()
				return director.state_machines:matches_state(test.title_wait_state)
			end, 120)
			assert(world.active_space_id == 'transition' and test.initial_castle.room_enter_pending
			and test.room_enter_count == 0,
			'title completion entered gameplay before the retained start wait')
			assert(director.timelines:get('director.wait.title_start').duration_ms
			== flow_title_start_wait_frames * clock.frame_delta_milliseconds(),
			'title start did not retain its authored frame-clock wait')
			t:wait_until('initial room entry', function()
				return registry:get('d') ~= nil and world.active_space_id == 'main'
				and registry:get('c').current_room_number == 1
			end, 240)
			t:at_boundary(world:request_mutation_boundary(), 120)
			assert(registry:get('d') == test.initial_director and registry:get('c') == test.initial_castle
			and registry:get('pietolon') == test.initial_player and test.initial_castle.room == test.initial_room
			and test.initial_castle.session == test.initial_session,
			'first title start discarded the already prepared game session')
			assert(director.state_machines:matches_state(test.room_state)
			and not test.initial_castle.room_enter_pending and test.room_enter_count == 1
			and test.room_enter_payload.room_number == 1 and test.room_enter_payload.world_number == 0
			and not test.room_enter_payload.suppress_room_music,
			'first gameplay entry did not consume and announce its pending room exactly once')
			assert(test.initial_room.tiles_visible and director.ui.visual.visible and world.gameplay_clock_running,
			'first gameplay entry did not restore the room, HUD and gameplay schedule')
			t:wait_until('initial room music', function()
				*apu_slot = 1
				return *selected_apu_source == castle_source_address
			end, 120)
			t:wait_until('held input on initial room entry', function()
				return test.initial_player.wox > test.initial_x
			end, 12)
			t:up('ArrowRight')
			director = registry:get('d')
			bind_completion_states(test, director)
			t:wait_ticks(50)
			local player<const> = registry:get('pietolon')
			player.status.health = 13
			test.initial_session.rooms['pietious.room_002'].destroyed_rocks.rock_002_02 = true
			test.player_victory_state = player.state_machines:bind_state_path('/victory_dance')
			director.state_machines:transition_to('/daemon_key')
			player.events:emit('item.picked', { item_type = 'keyworld1', item_id = 'cinematic_test_key' })
			assert(director.state_machines:matches_state(test.victory_dance_state),
			'world key did not start the victory sequence')
			assert(player.state_machines:matches_state(test.player_victory_state),
			'world key did not start the player victory dance')

			local victory_ticks = 0
			t:wait_until('visual and audio victory completion', function()
				if not director.state_machines:matches_state(test.victory_dance_state) then return true end
				victory_ticks = victory_ticks + 1
				return false
			end, 1000)
			assert(victory_ticks > 1, 'victory skipped visual or physical-audio completion')
			assert(director.state_machines:matches_state(test.room_curtain_state),
			'victory sequence did not advance to the room curtain')
			assert(not world.gameplay_clock_running, 'end-demo curtain did not stop the XNA room simulation')

			t:wait_until('room curtain', function() return not director.state_machines:matches_state(test.room_curtain_state) end, 120)
			do
				assert(director.state_machines:matches_state(test.end_demo_state), 'room curtain did not advance to the end demo')
				assert(world.active_space_id == 'end_demo', 'end demo did not own its presentation space')
				assert(*selected_apu_source == end_demo_source_address,
				'end-demo audio was not admitted source=' .. tostring(*selected_apu_source))

			end
			local end_demo_ticks = 0
			t:wait_until('end-demo physical audio completion', function()
				if not director.state_machines:matches_state(test.end_demo_state)
				and not director.state_machines:matches_state(test.end_demo_curtain_state) then return true end
				end_demo_ticks = end_demo_ticks + 1
				return false
			end, 1000)
			assert(end_demo_ticks > 1, 'end demo advanced before physical audio completion')
			do
				assert(director.state_machines:matches_state(test.epilogue_state), 'end-demo curtain did not advance to the epilogue')
				assert(world.active_space_id == 'narrative', 'epilogue did not own the narrative presentation space')
				local narrative<const> = registry:get('narrative')
				test.epilogue_requested_state = narrative.state_machines:bind_state_path('/epilogue/requested')
				narrative.events:emit('narrative.epilogue.reached_end')
				assert(narrative.state_machines:matches_state(test.epilogue_requested_state),
				'epilogue completion did not enter its one-shot request state')

			end
			local epilogue_fade_ticks = 0
			t:wait_until('physical epilogue music fade', function()
				if not director.state_machines:matches_state(test.epilogue_state) then return true end
				epilogue_fade_ticks = epilogue_fade_ticks + 1
				return false
			end, 1000)
			assert(epilogue_fade_ticks > 1, 'epilogue advanced before physical music fade')
			assert(director.state_machines:matches_state(test.ending_title_state), 'epilogue did not return to the title screen')
			assert(world.active_space_id == 'title', 'post-epilogue title did not own the presentation space')
			assert(not test.initial_castle.room_enter_pending and test.room_enter_count == 1,
			'completed gameplay recreated an unentered initial room')
			t:press('AltRight', 2)
			t:wait_until('new game after completion', function()
				return registry:get('d') ~= nil and registry:get('d') ~= director
				and world.active_space_id == 'main'
			end, 240)
			t:at_boundary(world:request_mutation_boundary(), 120)
			local fresh_castle<const> = registry:get('c')
			local fresh_player<const> = registry:get('pietolon')
			assert(fresh_castle ~= test.initial_castle and fresh_player ~= test.initial_player
			and fresh_castle.room ~= test.initial_room and fresh_castle.session ~= test.initial_session
			and fresh_player.status == fresh_castle.session.player,
			'post-completion New Game reused the played session or its actors')
			assert(test.initial_castle.world == nil and test.initial_player.world == nil and test.initial_room.world == nil
			and fresh_player.status.health == fresh_player.status.max_health
			and next(fresh_castle.session.rooms['pietious.room_002'].destroyed_rocks) == nil
			and test.initial_session.player.health == 13,
			'New Game did not dispose the played actors and initialize independent persistent state')

		end,
	},
}
