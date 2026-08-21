local clock<const> = require('cartlib/clock')
local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')

local apu_slot<const>: *word = 0x08000148
local selected_apu_source<const>: *word = 0x0800018c
local stage_music_source<const> = rom_dir.audio('music_stage').addr
local curtain_timeline_id<const> = 'nemesis_s.director.game_over_curtain'
local blackout_timeline_id<const> = 'nemesis_s.director.game_over_blackout'

local read_music_source<const> = function()
	*apu_slot = 1
	return *selected_apu_source
end

__bmsx_host_test = {
	frames = 0,
}

function __bmsx_host_test.ready()
	return registry:get(ids_director_instance) ~= nil
end

function __bmsx_host_test.setup()
	local test<const> = __bmsx_host_test
	local director<const> = registry:get(ids_director_instance)
	director.state_machines:transition_to('/game_start')
	director.state_machines:transition_to('/gameplay')
	test.game_over_curtain_state = director.state_machines:bind_state_path('/game_over/curtain')
	test.game_over_blackout_state = director.state_machines:bind_state_path('/game_over/blackout')
	test.game_start_state = director.state_machines:bind_state_path('/game_start')
	test.gameplay_state = director.state_machines:bind_state_path('/gameplay')

	local stage<const> = director.stage
	stage.tape_head = 120
	assert(stage:restart_column() == 0, 'checkpoint moved before XNA tape head 120')
	stage.tape_head = 121
	assert(stage:restart_column() == 120, 'checkpoint missed XNA tape head 120')
	stage.tape_head = 250
	assert(stage:restart_column() == 120, 'checkpoint moved before XNA tape head 250')
	stage.tape_head = 251
	assert(stage:restart_column() == 227, 'checkpoint missed XNA tape head 250')
	stage.tape_head = 421
	assert(stage:restart_column() == 227, 'checkpoint moved before XNA tape head 421')
	stage.tape_head = 422
	assert(stage:restart_column() == 420, 'checkpoint missed XNA tape head 421')
	stage.tape_head = 493
	assert(stage:restart_column() == 420, 'checkpoint moved before XNA tape head 493')
	stage.tape_head = 494
	assert(stage:restart_column() == 485, 'checkpoint missed XNA tape head 493')

	stage.tape_head = 251
	local previous_stage<const> = stage
	director.player_states[1]:set_lives(0)
	director.players[1].state_machines:transition_to('/dying')
	assert(director.state_machines:matches_state(test.game_over_curtain_state),
		'terminal player death did not begin the XNA curtain')
	assert(not director.status_bar.rows[1].powerups_visible,
		'exhausted player retained the XNA power-up row')
	assert(director.stage == previous_stage and registry:get(ids_stage_instance) == previous_stage,
		'game-over curtain unloaded gameplay before it closed')
	assert(director.game_over_curtain.enabled and director.game_over_curtain.last_tile == -1,
		'game-over curtain did not start from an empty retained strip')

	director.timelines:advance_to(curtain_timeline_id, game_over_curtain_columns)
	assert(director.game_over_curtain.last_tile == game_over_curtain_columns - 1,
		'game-over curtain did not cover all XNA stage columns')
	director.timelines:tick_frame(clock.update_milliseconds())
	assert(director.state_machines:matches_state(test.game_over_blackout_state),
		'completed curtain did not enter the XNA game-over blackout')
	assert(not world.gameplay_clock_running,
		'game-over blackout continued advancing the covered gameplay scene')
	assert(registry:get(ids_stage_instance) == previous_stage,
		'game-over blackout unloaded gameplay before its authored wait')

	director.timelines:tick_frame(game_over_blackout_duration_ms)
	assert(director.state_machines:matches_state(test.game_start_state),
		'game-over blackout did not return to the status-only game start')
	assert(world.gameplay_clock_running,
		'game-over restart did not restore the gameplay clock')
	local restarted_stage<const> = registry:get(ids_stage_instance)
	assert(restarted_stage ~= previous_stage,
		'game-over restart retained the previous gameplay scene')
	assert(restarted_stage.start_column == 227 and restarted_stage.restarting,
		'game-over restart did not retain the exact XNA checkpoint')
	assert(restarted_stage.tape_head - 1 == 258 and restarted_stage.total_scroll_px == 1816,
		'restarted stage did not rebuild its tape from checkpoint column 227')
	assert(director.player_states[1].lives == 9,
		'game-over restart did not restore the XNA player life count')
	assert(not director.game_over_curtain.enabled,
		'game-over curtain remained active over the status-only game start')

	director.timelines:tick_frame(1500)
	assert(director.state_machines:matches_state(test.gameplay_state)
		and world.active_space_id == 'main',
		'status-only game start did not return to checkpoint gameplay')
	test.director = director
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 120, 'Nemesis S game-over restart timed out')
	if read_music_source() ~= stage_music_source then
		return false
	end
	assert(test.director.stage.start_music_cue.restart_event == 'stage.music.restart.main',
		'checkpoint restart replayed a historical stage cue')
	return true
end
