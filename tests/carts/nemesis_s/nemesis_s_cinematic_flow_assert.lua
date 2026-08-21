local registry<const> = require('cartlib/registry')
local clock<const> = require('cartlib/clock')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')

local apu_slot<const>: *word = 0x08000148
local selected_apu_source<const>: *word = 0x0800018c
local end_demo_music_source<const> = rom_dir.audio('music_end_demo').addr
local intro_reveal_timeline_id<const> = 'nemesis_s.intro.logo_reveal'
local intro_hold_timeline_id<const> = 'nemesis_s.intro.logo_hold'
local konami_logo_hold_frames<const> = 256
local end_demo_timeline_id<const> = 'nemesis_s.end_demo.presentation'
local first_curtain_start_ms<const> = 18240
local first_curtain_end_ms<const> = 19440
local second_slide_start_ms<const> = 19640
local second_curtain_start_ms<const> = 37800
local end_demo_end_ms<const> = 39000

local read_music_source<const> = function()
	*apu_slot = 1
	return *selected_apu_source
end

__bmsx_host_test = {
	frames = 0,
	phase = 'boot',
}

function __bmsx_host_test.ready()
	return registry:get('nemesis_s.director') ~= nil
		and registry:get('nemesis_s.intro') ~= nil
		and registry:get('nemesis_s.story') ~= nil
		and registry:get('nemesis_s.title_screen') ~= nil
end

function __bmsx_host_test.setup()
	local test<const> = __bmsx_host_test
	local director<const> = registry:get('nemesis_s.director')
	test.intro_state = director.state_machines:bind_state_path('/intro')
	test.story_state = director.state_machines:bind_state_path('/story')
	test.title_state = director.state_machines:bind_state_path('/title')
	test.game_start_state = director.state_machines:bind_state_path('/game_start')
	test.gameplay_state = director.state_machines:bind_state_path('/gameplay')
	test.end_demo_state = director.state_machines:bind_state_path('/end_demo')
	assert(director.state_machines:matches_state(test.intro_state), 'Nemesis S did not boot into its intro')
	assert(world.active_space_id == 'intro', 'intro did not own the active presentation space')

	local intro<const> = registry:get('nemesis_s.intro')
	intro.state_machines:transition_to('/hidden')
	intro.state_machines:transition_to('/playing/blank')
	local logo<const> = intro.sprite_component
	assert(logo.imgid == 'intro_konami'
		and logo.offset_x == 40 and logo.offset_y == 64
		and logo.region_width == 168 and logo.region_height == 1
		and not logo.visible,
		'Konami logo did not enter the source-derived blank presentation')
	intro.state_machines:transition_to('/playing/reveal')
	local reveal<const> = intro.timelines:get(intro_reveal_timeline_id)
	assert(reveal.frame_duration == clock.frame_delta_milliseconds() * 2,
		'Konami logo reveal did not retain its two-VBlank row cadence')
	assert(logo.visible and logo.region_height == 1,
		'Konami logo did not reveal its first scanline')
	intro.timelines:advance_to(intro_reveal_timeline_id, 23)
	assert(logo.region_height == 24,
		'Konami logo midpoint differs from the Metal Gear row copier')
	intro.timelines:advance_to(intro_reveal_timeline_id, 47)
	assert(logo.region_height == 48,
		'Konami logo did not reveal all source scanlines')
	intro.state_machines:transition_to('/playing/hold')
	assert(intro.timelines:get(intro_hold_timeline_id).duration_ms
		== konami_logo_hold_frames * clock.frame_delta_milliseconds(),
		'Konami logo hold did not retain the zero-counter wrap duration')
	intro:finish()
	assert(not logo.visible, 'completed Konami logo remained visible')
	assert(director.state_machines:matches_state(test.story_state), 'intro did not advance to story')
	assert(world.active_space_id == 'story', 'story did not own the active presentation space')

	local story<const> = registry:get('nemesis_s.story')
	assert(story.sprite_component.imgid == 'story_coup', 'story did not start on the coup image')
	assert(story.primary_text.static_text_line_count == 4 and story.primary_text.offset_y == 144,
		'first story caption differs from the XNA layout')
	local story_panel_frames<const> = { 1257, 538, 480, 419, 367, 1014, 2101, 1202, 839 }
	local story_frame_ms<const> = clock.frame_delta_milliseconds()
	for index = 1, #story_panel_frames do
		assert(story.timelines:get('nemesis_s.story.slide.' .. tostring(index)).duration_ms
			== story_panel_frames[index] * story_frame_ms,
			'story panel duration left its observed Nemesis 2 VBlank boundary')
	end
	story.timelines:advance_to('nemesis_s.story.slide.1', 18)
	assert(story.primary_text.glyph_visible_height == nil, 'story glyph-row reveal did not reach full height')
	story.state_machines:transition_to('/playing/slide_6')
	assert(story.secondary_text.visible and story.sprite_component.imgid == nil,
		'Pieton interlude did not start from its authored black frame')
	story.timelines:advance_to('nemesis_s.story.slide.6', 125)
	assert(story.sprite_component.imgid == nil,
		'Pieton portrait appeared before the original 50 Hz panel boundary')
	story.timelines:advance_to('nemesis_s.story.slide.6', 126)
	assert(story.sprite_component.imgid == 'story_piet2', 'Pieton interlude did not reveal its image')
	story.timelines:advance_to('nemesis_s.story.slide.6', 158)
	assert(story.curtain_start == 78 and story.curtain_end == 62,
		'Pieton curtain did not reach its retained upper reveal bounds')
	story.timelines:advance_to('nemesis_s.story.slide.6', 310)
	assert(story.curtain_start == 126 and story.curtain_end == 110,
		'Pieton curtain did not return to its retained lower bounds')
	story.timelines:advance_to('nemesis_s.story.slide.6', 663)
	assert(story.curtain_end == 4 and story.secondary_text.glyph_visible_height == nil,
		'Pieton wipe did not reveal the complete second caption')
	story.timelines:advance_to('nemesis_s.story.slide.6', 1003)
	assert(story.curtain_count == 8,
		'Pieton panel did not reach black on the original transition boundary')
	story.events:emit('story_done')
	assert(director.state_machines:matches_state(test.title_state), 'story did not advance to title')
	assert(world.active_space_id == 'title', 'title did not own the active presentation space')

	local title<const> = registry:get('nemesis_s.title_screen')
	assert(title.sprite_component.imgid == 'title_screen_1' and title.selector.offset_y == 136,
		'title did not enter its authored idle presentation')
	title.timelines:advance_to('nemesis_s.title_screen.idle', 8)
	assert(title.sprite_component.imgid == 'title_screen_2',
		'title logo did not enter its four-VBlank palette phase')
	title.timelines:advance_to('nemesis_s.title_screen.idle', 12)
	assert(title.sprite_component.imgid == 'title_screen_1' and not title.selector.visible,
		'title idle presentation did not retain the ROM 8/4 and 12/12 cadences')
	title:toggle_player_count()
	assert(title.selected_player_count == 2 and title.selector.offset_y == 152
		and title.selector.visible,
		'title selector did not retain the two-player selection')
	title.state_machines:transition_to('/startup/confirmation')
	title.timelines:advance_to('nemesis_s.title_screen.confirmation', 4)
	assert(not title.selection_hider.visible,
		'selection confirmation did not alternate after four VBlanks')
	title.state_machines:transition_to('/startup/hangar_blackout')
	assert(not title.visible, 'hangar transition did not begin on the ROM black frame')
	title.state_machines:transition_to('/startup/flight/lift')
	title.timelines:advance_to('nemesis_s.title_screen.lift', 4)
	assert(title.normal_ship.offset_y == 121 and title.burst_ship.offset_y == 121,
		'Metalion lift did not retain the first ROM position boundary')
	title.timelines:advance_to('nemesis_s.title_screen.hangar', 4)
	assert(title.sprite_component.imgid == 'title_hangar_2',
		'hangar lights did not retain the first observed ROM boundary')
	title.timelines:advance_to('nemesis_s.title_screen.lift', 49)
	assert(title.normal_ship.offset_y == 81 and title.burst_ship.offset_y == 81,
		'Metalion lift did not retain its final visible ROM step')
	title.state_machines:transition_to('/startup/flight/ignition')
	assert(title.normal_ship.offset_y == 73 and title.burst_ship.offset_y == 73,
		'Metalion ignition did not enter at the hangar endpoint')
	title.timelines:advance_to('nemesis_s.title_screen.ignition', 0)
	assert(title.burst_ship.imgid == 'title_startup_metalion_burst_1',
		'Metalion startup flicker did not begin on the burst frame')
	title.timelines:advance_to('nemesis_s.title_screen.ignition', 2)
	assert(title.burst_ship.imgid == 'title_startup_metalion',
		'Metalion ignition did not alternate after two VBlanks')
	title.state_machines:transition_to('/startup/flight/burst_ramp')
	title.timelines:advance_to('nemesis_s.title_screen.burst_ramp', 8)
	assert(title.burst_ship.imgid == 'title_startup_metalion_burst_2',
		'Metalion burst ramp did not retain its third four-VBlank pose')
	title.state_machines:transition_to('/startup/flight/burst_hold')
	assert(title.burst_ship.imgid == 'title_startup_metalion_burst_3',
		'Metalion startup did not reach full burst')
	title.state_machines:transition_to('/startup/flight/burst_cooldown')
	title.timelines:advance_to('nemesis_s.title_screen.burst_cooldown', 0)
	assert(title.burst_ship.imgid == 'title_startup_metalion_burst_2',
		'Metalion cooldown did not begin on its second burst image')
	title.timelines:advance_to('nemesis_s.title_screen.burst_cooldown', 8)
	assert(title.burst_ship.imgid == 'title_startup_metalion_burst_1',
		'Metalion cooldown did not enter its final seven-VBlank pose')
	title.state_machines:transition_to('/startup/blackout')
	assert(not title.visible, 'title blackout kept presentation sprites visible')
	title.events:emit('title_screen_done', { player_count = 2 })
	assert(director.state_machines:matches_state(test.game_start_state),
		'title completion did not enter the retained game-start wait')
	assert(director.player_count == 2, 'director discarded the selected player count')
	assert(world.active_space_id == 'game_start', 'game-start wait did not activate its status-only space')
	local status_bar<const> = registry:get('nemesis_s.status_bar')
	assert(#status_bar.rows == 2, 'status bar discarded the selected player count')
	assert(status_bar.rows[1].life_text.text == '9' and status_bar.rows[2].life_text.text == '9',
		'game-start status did not reset both XNA life counters')
	local player_states<const> = director.player_states
	assert(player_states[1].current_powerup_slot == 0 and player_states[2].current_powerup_slot == 0,
		'game-start status did not reset both power-up selections')
	assert(status_bar.rows[1].player_state == player_states[1]
		and status_bar.rows[2].player_state == player_states[2],
		'status presentation did not bind the retained player states')
	local player_1<const> = registry:get('nemesis_s.player.1')
	local player_2<const> = registry:get('nemesis_s.player.2')
	assert(player_1 ~= nil and player_1.x == 80 and player_1.y == 60,
		'selected game did not spawn player 1 at the XNA start')
	assert(player_2 ~= nil and player_2.x == 120 and player_2.y == 80,
		'selected two-player game did not spawn player 2 at the XNA start')
	assert(player_1.sprite.imgid == 'metallion_n' and player_2.sprite.imgid == 'metallion_n_p2',
		'local players did not retain their authored vessel presentation')
	assert(player_1.player_state == player_states[1] and player_2.player_state == player_states[2],
		'player pawns did not receive their retained player state')
	assert(#player_1.options == 0 and #player_2.options == 0,
		'new players retained the removed debug option loadout')
	assert(player_1.primary_projectiles[1].type == 0
		and player_1.missile_projectiles[1].type == 0
		and player_1.secondary_projectiles[1].type == 0,
		'new player retained active weapons from the removed debug loadout')
	local stage<const> = director.stage
	assert(not stage.yellow_blink and not stage.blue_blink and stage.blink_turn == 'yellow',
		'star blink did not begin from the XNA visible phase')
	stage.timelines:advance_time_to(ids_stage_star_blink_timeline, stage_star_blink_frame_ms)
	assert(stage.yellow_blink and not stage.blue_blink and stage.blink_turn == 'yellow',
		'yellow stars did not hide after the authored 50 ms phase')
	stage.timelines:advance_time_to(ids_stage_star_blink_timeline, stage_star_blink_frame_ms * 2)
	assert(not stage.yellow_blink and not stage.blue_blink and stage.blink_turn == 'blue',
		'yellow stars did not restore before the blue phase')
	stage.timelines:advance_time_to(ids_stage_star_blink_timeline, stage_star_blink_frame_ms * 3)
	assert(not stage.yellow_blink and stage.blue_blink and stage.blink_turn == 'blue',
		'blue stars did not hide on their authored phase')
	test.phase = 'game_start'
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 200, 'Nemesis S cinematic flow timed out')
	local director<const> = registry:get('nemesis_s.director')
	if test.phase == 'gameplay' then
		test.gameplay_frames = test.gameplay_frames + 1
		if test.gameplay_frames < 20 then
			return false
		end
		local stage<const> = director.stage
		stage.events:emit('stage.completed')
		assert(director.state_machines:matches_state(test.end_demo_state),
			'stage completion did not enter the XNA end demo')
		assert(world.active_space_id == 'end_demo',
			'end demo did not own the active presentation space')
		test.phase = 'end_demo'
		return false
	end
	if test.phase == 'end_demo' then
		if read_music_source() ~= end_demo_music_source then
			return false
		end
		assert(registry:get(ids_stage_instance) == nil
			and registry:get('nemesis_s.player.1') == nil
			and registry:get('nemesis_s.status_bar') == nil,
			'completed gameplay retained its unloaded space objects')
		local presentation<const> = registry:get('nemesis_s.end_demo')
		assert(presentation.sprite_component.imgid == 'end_demo_sint_duim',
			'end demo did not start on the authored Sint image')
		assert(presentation.caption.static_text_line_count == 21
			and presentation.caption.offset_x == 0
			and presentation.caption.offset_y == 8,
			'first end-demo caption differs from the XNA layout')
		presentation.timelines:advance_time_to(end_demo_timeline_id, 240)
		assert(presentation.caption.glyph_visible_height == nil,
			'first end-demo caption did not finish its four-row delayed reveal')
		presentation.timelines:advance_time_to(end_demo_timeline_id, first_curtain_start_ms)
		assert(presentation.curtain.visible and presentation.curtain_count == 1,
			'first end-demo curtain did not start on its authored boundary')
		presentation.timelines:advance_time_to(end_demo_timeline_id, first_curtain_end_ms)
		assert(not presentation.visible and not presentation.curtain.visible,
			'end-demo inter-slide gap did not hide the completed slide')
		presentation.timelines:advance_time_to(end_demo_timeline_id, second_slide_start_ms)
		assert(presentation.visible
			and presentation.sprite_component.imgid == 'end_demo_boaz'
			and presentation.caption.static_text_line_count == 16
			and presentation.caption.offset_x == 128
			and presentation.caption.glyph_visible_height == 0,
			'second end-demo slide differs from the XNA image and caption layout')
		presentation.timelines:advance_time_to(end_demo_timeline_id, second_slide_start_ms + 160)
		assert(presentation.caption.glyph_visible_height == nil,
			'second end-demo caption did not retain its faster XNA reveal')
		presentation.timelines:advance_time_to(end_demo_timeline_id, second_curtain_start_ms)
		assert(presentation.curtain.visible and presentation.curtain_count == 1,
			'second end-demo curtain did not start on its authored boundary')
		presentation.timelines:advance_time_to(end_demo_timeline_id, end_demo_end_ms - 1)
		presentation.timelines:tick_frame(1)
		assert(director.state_machines:matches_state(test.title_state)
			and world.active_space_id == 'title',
			'end-demo completion did not return to the title presentation')
		assert(read_music_source() == end_demo_music_source,
			'title entry stopped the non-looping XNA end-demo music')
		return true
	end
	if not director.state_machines:matches_state(test.gameplay_state) then
		assert(director.state_machines:matches_state(test.game_start_state),
			'director left game-start through an unexpected state')
		return false
	end
	local game_start_timeline<const> = director.timelines:get('nemesis_s.director.game_start')
	assert(game_start_timeline.duration_ms == 41 * clock.frame_delta_milliseconds()
		and game_start_timeline.ended,
		'game-start wait did not complete on the ROM ship-admission boundary')
	assert(world.active_space_id == 'main', 'gameplay did not activate the stage space')
	assert(registry:get('nemesis_s.status_bar').space_id == 'main',
		'status bar did not move into the gameplay presentation space')
	test.phase = 'gameplay'
	test.gameplay_frames = 0
	return false
end
