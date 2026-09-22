local clock<const> = require('cartlib/clock')
local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')
require('constants')
local selected_apu_source<const>: *word = 0x0800018c
local end_demo_source_address<const> = rom_dir.audio('enddemo').addr
local intro_logo_reveal_timeline_id<const> = 'intro.logo.reveal'
local intro_logo_hold_timeline_id<const> = 'intro.logo.hold'
local intro_logo_hold_frames<const> = 128
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
			local test<const> = {}
			local director = registry:get('d')
			test.intro_state = director.state_machines:bind_state_path('/intro')
			test.story_state = director.state_machines:bind_state_path('/story')
			test.title_state = director.state_machines:bind_state_path('/title_screen')
			assert(director.state_machines:matches_state(test.intro_state), 'Pietious did not boot into the Konami intro')
			assert(world.active_space_id == 'intro', 'intro did not own the presentation space')

			local intro<const> = registry:get('intro')
			intro.state_machines:transition_to('/hidden')
			intro.state_machines:transition_to('/playing/blank')
			local logo<const> = intro.logo_sprite
			assert(logo.imgid == 'intro_konami'
			and logo.parent.x == 40 and logo.parent.y == 64
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
			assert(not intro.members.logo.visible and not intro.logo_background.visible,
			'finishing the Konami logo retained its presentation')
			assert(registry:get('narrative').text_component.offset_y == screen_height,
			'story did not start below the screen')

			t:wait_ticks(1)
			do
				assert(director.state_machines:matches_state(test.story_state), 'intro did not advance to the story')
				assert(world.active_space_id == 'narrative', 'story did not own the narrative presentation space')
				local narrative<const> = registry:get('narrative')
				assert(narrative.text_component.glyph_line_count == 54, 'story did not bind the complete XNA text')
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

			local first_director<const> = director
			t:press('AltRight', 2)
			t:wait_until('fresh game session', function()
				return registry:get('d') ~= first_director and world.active_space_id == 'main' and registry:get('c').current_room_number == 1
			end, 240)
			director = registry:get('d')
			bind_completion_states(test, director)
			t:wait_ticks(50)
			local player<const> = registry:get('pietolon')
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
				local end_demo<const> = registry:get('end_demo')
				assert(end_demo.members.caption.text_component.text == 'DAT HEB JE BEST REDELIJK GEDAAN! ',
				'end-demo message differs from the XNA source')
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
				assert(narrative.text_component.glyph_line_count == 136, 'epilogue did not bind the complete XNA text')
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

		end,
	},
}
