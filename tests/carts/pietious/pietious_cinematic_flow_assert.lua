local clock<const> = require('cartlib/clock')
local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local text_component<const> = require('cartlib/text/text_component')
local world<const> = require('cartlib/world/world')
require('constants')

local apu_slot_select<const>: *word = 0x08000148
local selected_apu_source<const>: *word = 0x0800018c
local end_demo_source_address<const> = rom_dir.audio('enddemo').addr
local intro_logo_reveal_timeline_id<const> = 'intro.logo.reveal'
local intro_logo_hold_timeline_id<const> = 'intro.logo.hold'
local intro_logo_hold_frames<const> = 128

__bmsx_host_test = {
	frames = 0,
	phase = 'boot',
}

function __bmsx_host_test.ready()
	return registry:get('d') ~= nil
		and registry:get('intro') ~= nil
		and registry:get('narrative') ~= nil
		and registry:get('end_demo') ~= nil
		and registry:get('title_screen') ~= nil
end

function __bmsx_host_test.setup()
	local test<const> = __bmsx_host_test
	local director<const> = registry:get('d')
	test.intro_state = director.state_machines:bind_state_path('/intro')
	test.story_state = director.state_machines:bind_state_path('/story')
	test.title_state = director.state_machines:bind_state_path('/title_screen')
	assert(director.state_machines:matches_state(test.intro_state), 'Pietious did not boot into the XNA intro')
	assert(world.active_space_id == 'intro', 'intro did not own the presentation space')

	local intro<const> = registry:get('intro')
	intro.state_machines:transition_to('/hidden')
	intro.state_machines:transition_to('/playing/logo/blank')
	local logo<const> = intro.sprite_component
	assert(logo.imgid == 'intro_konami'
		and logo.offset_x == 40 and logo.offset_y == 64
		and logo.region_width == 168 and logo.region_height == 1
		and not logo.visible and intro.logo_background.visible,
		'Konami logo did not enter its source-derived white presentation')
	intro.state_machines:transition_to('/playing/logo/reveal')
	local reveal<const> = intro.timelines:get(intro_logo_reveal_timeline_id)
	assert(reveal.frame_duration == clock.frame_delta_milliseconds(),
		'Konami logo reveal did not match Pietious two-VBlank presentation cadence')
	intro.timelines:advance_to(intro_logo_reveal_timeline_id, 23)
	assert(logo.visible and logo.region_height == 24,
		'Konami logo midpoint differs from the Metal Gear row copier')
	intro.timelines:advance_to(intro_logo_reveal_timeline_id, 47)
	assert(logo.region_height == 48, 'Konami logo did not reveal all source scanlines')
	intro.state_machines:transition_to('/playing/logo/hold')
	assert(intro.timelines:get(intro_logo_hold_timeline_id).duration_ms
		== intro_logo_hold_frames * clock.frame_delta_milliseconds(),
		'Konami logo hold did not retain its 256-VBlank duration')
	intro.state_machines:transition_to('/playing/presentation')
	assert(not logo.visible and not intro.logo_background.visible,
		'Konami logo presentation remained visible over the Pietious intro')
	assert(intro.sinterklaas.offset_x == -28 * room_tile_size, 'Sinterklaas intro logo started at the wrong x')
	assert(intro.boaz.offset_x == 32 * room_tile_size, 'Boaz intro logo started at the wrong x')
	intro.timelines:seek('intro.presentation', 80)
	assert(intro.sinterklaas.offset_x == 2 * room_tile_size, 'Sinterklaas intro slide did not end at XNA x=2')
	intro.timelines:seek('intro.presentation', 183)
	assert(intro.boaz.offset_x == 4 * room_tile_size, 'Boaz intro slide did not end at XNA x=4')
	intro.timelines:seek('intro.presentation', 333)
	assert(not intro.visible, 'intro blackout did not hide both logos')
	intro.events:emit('intro_done')
	assert(registry:get('narrative').text_component.offset_y == screen_height,
		'story did not start below the screen')
	test.phase = 'story'
end

local bind_completion_states<const> = function(test, director)
	test.victory_dance_state = director.state_machines:bind_state_path('/game_completion/victory_dance')
	test.room_curtain_state = director.state_machines:bind_state_path('/game_completion/room_curtain')
	test.end_demo_state = director.state_machines:bind_state_path('/game_completion/end_demo')
	test.end_demo_curtain_state = director.state_machines:bind_state_path('/game_completion/end_demo_curtain')
	test.epilogue_state = director.state_machines:bind_state_path('/game_completion/epilogue')
	test.ending_title_state = director.state_machines:bind_state_path('/title_screen')
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 2400, 'cinematic flow timed out phase=' .. test.phase)
	local director<const> = registry:get('d')

	if test.phase == 'story' then
		assert(director.state_machines:matches_state(test.story_state), 'intro did not advance to the story')
		assert(world.active_space_id == 'narrative', 'story did not own the narrative presentation space')
		*apu_slot_select = 0
		assert(*selected_apu_source == 0, 'XNA prelude audio continued after leaving the intro')
		local narrative<const> = registry:get('narrative')
		assert(narrative.text_component.static_text_line_count == 54, 'story did not bind the complete XNA text')
		test.story_requested_state = narrative.state_machines:bind_state_path('/story/requested')
		narrative.events:emit('narrative.story.reached_end')
		assert(narrative.state_machines:matches_state(test.story_requested_state),
			'story completion did not enter its one-shot request state')
		test.story_fade_frames = 0
		test.phase = 'story_fade'
		return false
	end

	if test.phase == 'story_fade' then
		test.story_fade_frames = test.story_fade_frames + 1
		if director.state_machines:matches_state(test.story_state) then
			return false
		end
		assert(test.story_fade_frames > 1, 'story advanced before the physical music fade completed')
		assert(director.state_machines:matches_state(test.title_state), 'story did not advance to the title screen')
		assert(world.active_space_id == 'title', 'title did not own the presentation space')
		test.first_director = director
		test.phase = 'title_start'
		return host.press('AltRight', 2)
	end

	if test.phase == 'title_start' then
		if world.active_space_id ~= 'main'
		or registry:get('c').current_room_number ~= 1 then
			return false
		end
		assert(registry:get('d') ~= test.first_director, 'title start reused the completed game session')
		bind_completion_states(test, director)
		test.gameplay_settle_frames = 50
		test.phase = 'gameplay_settle'
		return false
	end

	if test.phase == 'gameplay_settle' then
		test.gameplay_settle_frames = test.gameplay_settle_frames - 1
		if test.gameplay_settle_frames > 0 then
			return false
		end
		local player<const> = registry:get('pietolon')
		test.player_victory_state = player.state_machines:bind_state_path('/victory_dance')
		director.state_machines:transition_to('/daemon_key')
		player.events:emit('item.picked', { item_type = 'keyworld1', item_id = 'cinematic_test_key' })
		assert(director.state_machines:matches_state(test.victory_dance_state),
			'world key did not start the victory sequence')
		assert(player.state_machines:matches_state(test.player_victory_state),
			'world key did not start the player victory dance')
		test.victory_frames = 0
		test.phase = 'victory_dance'
		return false
	end

	if test.phase == 'victory_dance' then
		test.victory_frames = test.victory_frames + 1
		if director.state_machines:matches_state(test.victory_dance_state) then
			return false
		end
		assert(test.victory_frames > 1, 'victory sequence skipped its visual or physical-audio completion')
		assert(director.state_machines:matches_state(test.room_curtain_state),
			'victory sequence did not advance to the room curtain')
		assert(not world.gameplay_clock_running, 'end-demo curtain did not stop the XNA room simulation')
		test.phase = 'room_curtain'
		return false
	end

	if test.phase == 'room_curtain' then
		if director.state_machines:matches_state(test.room_curtain_state) then
			return false
		end
		assert(director.state_machines:matches_state(test.end_demo_state), 'room curtain did not advance to the end demo')
		assert(world.active_space_id == 'end_demo', 'end demo did not own its presentation space')
		local end_demo<const> = registry:get('end_demo')
		assert(end_demo:get_component(text_component).text == 'DAT HEB JE BEST REDELIJK GEDAAN! ',
			'end-demo message differs from the XNA source')
		assert(*selected_apu_source == end_demo_source_address,
			'end-demo audio was not admitted source=' .. tostring(*selected_apu_source))
		test.end_demo_frames = 0
		test.phase = 'end_demo'
		return false
	end

	if test.phase == 'end_demo' then
		test.end_demo_frames = test.end_demo_frames + 1
		assert(test.end_demo_frames < 1000,
			'end-demo audio did not complete source=' .. tostring(*selected_apu_source))
		if director.state_machines:matches_state(test.end_demo_state)
		or director.state_machines:matches_state(test.end_demo_curtain_state) then
			return false
		end
		assert(test.end_demo_frames > 1, 'end demo advanced before its physical audio completion')
		assert(director.state_machines:matches_state(test.epilogue_state), 'end-demo curtain did not advance to the epilogue')
		assert(world.active_space_id == 'narrative', 'epilogue did not own the narrative presentation space')
		local narrative<const> = registry:get('narrative')
		assert(narrative.text_component.static_text_line_count == 136, 'epilogue did not bind the complete XNA text')
		test.epilogue_requested_state = narrative.state_machines:bind_state_path('/epilogue/requested')
		narrative.events:emit('narrative.epilogue.reached_end')
		assert(narrative.state_machines:matches_state(test.epilogue_requested_state),
			'epilogue completion did not enter its one-shot request state')
		test.epilogue_fade_frames = 0
		test.phase = 'epilogue_fade'
		return false
	end

	test.epilogue_fade_frames = test.epilogue_fade_frames + 1
	if director.state_machines:matches_state(test.epilogue_state) then
		return false
	end
	assert(test.epilogue_fade_frames > 1, 'epilogue advanced before the physical music fade completed')
	assert(director.state_machines:matches_state(test.ending_title_state), 'epilogue did not return to the title screen')
	assert(world.active_space_id == 'title', 'post-epilogue title did not own the presentation space')
	return true
end
