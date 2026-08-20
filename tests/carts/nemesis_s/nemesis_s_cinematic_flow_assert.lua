local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')

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
	assert(director.state_machines:matches_state(test.intro_state), 'Nemesis S did not boot into its intro')
	assert(world.active_space_id == 'intro', 'intro did not own the active presentation space')

	local intro<const> = registry:get('nemesis_s.intro')
	assert(intro.nicolaas.offset_x == -224 and intro.boaz.offset_x == 256,
		'intro logos did not start at the XNA tile positions')
	intro.timelines:advance_time_to('nemesis_s.intro.presentation', 2600)
	assert(intro.nicolaas.offset_x == -80,
		'Sinterklaas logo did not retain the fixed 30 Hz XNA movement cadence')
	intro.timelines:advance_time_to('nemesis_s.intro.presentation', 3000)
	assert(intro.nicolaas.offset_x == 16, 'Sinterklaas logo did not finish at XNA tile x=2')
	intro.timelines:advance_time_to('nemesis_s.intro.presentation', 6160)
	assert(intro.boaz.offset_x == 224,
		'Boaz logo did not retain the fixed 30 Hz XNA movement cadence')
	intro.timelines:advance_time_to('nemesis_s.intro.presentation', 7000)
	assert(intro.boaz.offset_x == 32, 'Boaz logo did not finish at XNA tile x=4')
	intro.timelines:advance_time_to('nemesis_s.intro.presentation', 12160)
	assert(intro.visible, 'intro blackout started before the authored XNA wait elapsed')
	intro.timelines:advance_time_to('nemesis_s.intro.presentation', 13000)
	assert(not intro.visible, 'intro blackout did not hide the logos')
	intro.events:emit('intro_done')
	assert(director.state_machines:matches_state(test.story_state), 'intro did not advance to story')
	assert(world.active_space_id == 'story', 'story did not own the active presentation space')

	local story<const> = registry:get('nemesis_s.story')
	assert(story.sprite_component.imgid == 'story_coup', 'story did not start on the coup image')
	assert(story.primary_text.static_text_line_count == 4 and story.primary_text.offset_y == 144,
		'first story caption differs from the XNA layout')
	story.timelines:advance_time_to('nemesis_s.story.slide.1', 240)
	assert(story.primary_text.glyph_visible_height == nil, 'story glyph-row reveal did not reach full height')
	story.state_machines:transition_to('/playing/slide_6')
	assert(story.secondary_text.visible and story.sprite_component.imgid == nil,
		'Pieton interlude did not start from its authored black frame')
	story.timelines:advance_time_to('nemesis_s.story.slide.6', 240)
	assert(story.sprite_component.imgid == 'story_piet2', 'Pieton interlude did not reveal its image')
	story.timelines:advance_time_to('nemesis_s.story.slide.6', 840)
	assert(story.curtain_start == 78 and story.curtain_end == 62,
		'Pieton curtain did not reach the XNA upper reveal bounds')
	story.timelines:advance_time_to('nemesis_s.story.slide.6', 2740)
	assert(story.curtain_start == 126 and story.curtain_end == 110,
		'Pieton curtain did not return to the XNA lower bounds')
	story.timelines:advance_time_to('nemesis_s.story.slide.6', 5020)
	assert(story.curtain_end == 4 and story.secondary_text.glyph_visible_height == nil,
		'Pieton wipe did not reveal the complete second caption')
	story.events:emit('story_done')
	assert(director.state_machines:matches_state(test.title_state), 'story did not advance to title')
	assert(world.active_space_id == 'title', 'title did not own the active presentation space')

	local title<const> = registry:get('nemesis_s.title_screen')
	assert(title.sprite_component.imgid == 'title_screen_1' and title.selector.offset_y == 136,
		'title did not enter its authored idle presentation')
	title:toggle_player_count()
	assert(title.selected_player_count == 2 and title.selector.offset_y == 152,
		'title selector did not retain the two-player selection')
	title.state_machines:transition_to('/startup/selection')
	title.timelines:advance_time_to('nemesis_s.title_screen.selection', 20)
	assert(not title.selection_hider.visible, 'selection flash did not alternate at 20 ms')
	title.state_machines:transition_to('/startup/flight/launch')
	title.timelines:advance_time_to('nemesis_s.title_screen.launch', 700)
	assert(title.normal_ship.offset_y == 73 and title.burst_ship.offset_y == 73,
		'Metalion launch did not reach the XNA hangar endpoint')
	title.state_machines:transition_to('/startup/flight/full_burst')
	title.timelines:advance_time_to('nemesis_s.title_screen.full_burst', 60)
	assert(title.burst_ship.imgid == 'title_startup_metalion_burst_3',
		'Metalion startup did not reach full burst')
	title.state_machines:transition_to('/startup/flight/cooldown')
	title.timelines:advance_time_to('nemesis_s.title_screen.cooldown', 150)
	assert(title.burst_ship.imgid == 'title_startup_metalion',
		'Metalion startup did not cool down to its base image')
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
	test.phase = 'game_start'
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 120, 'Nemesis S game-start flow timed out')
	local director<const> = registry:get('nemesis_s.director')
	if test.phase == 'gameplay' then
		test.gameplay_frames = test.gameplay_frames + 1
		return test.gameplay_frames == 20
	end
	if not director.state_machines:matches_state(test.gameplay_state) then
		assert(director.state_machines:matches_state(test.game_start_state),
			'director left game-start through an unexpected state')
		return false
	end
	assert(test.frames > 70, 'game-start wait completed before the authored 1500 ms')
	assert(world.active_space_id == 'main', 'gameplay did not activate the stage space')
	assert(registry:get('nemesis_s.status_bar').space_id == 'main',
		'status bar did not move into the gameplay presentation space')
	test.phase = 'gameplay'
	test.gameplay_frames = 0
	return false
end
