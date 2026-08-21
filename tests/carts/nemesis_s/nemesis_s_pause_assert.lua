local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')
require('constants')

local apu_slot<const>: *word = 0x08000148
local selected_apu_source<const>: *word = 0x0800018c
local apu_active_mask<const>: *word = 0x08000190
local music_slot_mask<const> = 0x00000002
local stage_music_source<const> = rom_dir.audio('music_stage_intro').addr
local pause_source<const> = rom_dir.audio('nemesis2_pause').addr

local read_slot_source<const> = function(slot)
	*apu_slot = slot
	return *selected_apu_source
end

__bmsx_host_test = {
	frames = 0,
	phase = 'boot',
}

function __bmsx_host_test.ready()
	return registry:get(ids_director_instance) ~= nil
end

function __bmsx_host_test.setup()
	local test<const> = __bmsx_host_test
	local director<const> = registry:get(ids_director_instance)
	director.state_machines:transition_to('/game_start')
	test.director = director
	test.running_state = director.state_machines:bind_state_path('/gameplay/running')
	test.pause_state = director.state_machines:bind_state_path('/gameplay/pause')
end

function __bmsx_host_test.update()
	if world.active_space_id == 'game_start' then
		local director<const> = registry:get(ids_director_instance)
		if director.status_bar ~= nil then
			director.state_machines:transition_to('/gameplay')
		end
		return false
	end
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 240, 'Nemesis S pause scenario timed out phase=' .. test.phase)

	local director<const> = test.director
	local stage<const> = director.stage
	local player<const> = director.players[1]
	if test.phase == 'boot' then
		if world.active_space_id ~= 'main'
		or not director.state_machines:matches_state(test.running_state)
		or read_slot_source(1) ~= stage_music_source then
			return false
		end
		test.phase = 'enter_pause'
		return host.press('F1', 4)
	end

	if test.phase == 'enter_pause' then
		if not director.state_machines:matches_state(test.pause_state)
		or world.gameplay_clock_running then
			return false
		end
		assert(world.active_space_id == 'main', 'pause changed the retained gameplay space')
		test.stage = stage
		test.player = player
		test.gameplay_time_ms = world.gameplay_time_ms
		test.stage_tape_head = stage.tape_head
		test.stage_scroll_px = stage.total_scroll_px
		test.stage_scroll_gate = stage.scroll_gate
		test.player_frame = player.frame
		test.player_x = player.x
		test.player_y = player.y
		test.player_visual_visible = player.vessel_visual.visible
		test.paused_frames = 0
		test.phase = 'paused'
		return false
	end

	if test.phase == 'paused' then
		assert(not world.gameplay_clock_running, 'pause resumed the gameplay schedule')
		assert(world.gameplay_time_ms == test.gameplay_time_ms,
			'gameplay time advanced while the gameplay clock was suspended')
		assert(director.stage == test.stage and director.players[1] == test.player,
			'pause replaced the retained gameplay objects')
		assert(stage.tape_head == test.stage_tape_head
			and stage.total_scroll_px == test.stage_scroll_px
			and stage.scroll_gate == test.stage_scroll_gate,
			'stage simulation advanced during pause')
		assert(player.frame == test.player_frame
			and player.x == test.player_x
			and player.y == test.player_y,
			'player simulation advanced during pause')
		assert(player.vessel_visual.visible == test.player_visual_visible,
			'pause changed the retained gameplay presentation')
		assert(read_slot_source(1) == stage_music_source
			and (*apu_active_mask & music_slot_mask) ~= 0,
			'pause discarded the retained music voice')
		if read_slot_source(0) == pause_source then
			test.saw_pause_sound = true
		end
		test.paused_frames = test.paused_frames + 1
		if test.paused_frames < 12 then
			return false
		end
		assert(test.saw_pause_sound, 'pause did not play the XNA pause sound')
		test.phase = 'resume'
		return host.press('F1', 4)
	end

	if test.phase == 'resume' then
		if not director.state_machines:matches_state(test.running_state)
		or not world.gameplay_clock_running then
			return false
		end
		assert(world.active_space_id == 'main'
			and director.stage == test.stage
			and director.players[1] == test.player,
			'resume rebuilt the retained gameplay scene')
		assert(read_slot_source(1) == stage_music_source
			and (*apu_active_mask & music_slot_mask) ~= 0,
			'resume restarted or discarded the retained music voice')
		test.resumed_gameplay_time_ms = world.gameplay_time_ms
		test.resumed_player_frame = player.frame
		test.rate_sample_frames = 0
		test.rate_gameplay_updates = 0
		test.phase = 'resumed'
		return false
	end

	test.rate_sample_frames = test.rate_sample_frames + 1
	if world.gameplay_time_ms ~= test.resumed_gameplay_time_ms then
		test.resumed_gameplay_time_ms = world.gameplay_time_ms
		test.rate_gameplay_updates = test.rate_gameplay_updates + 1
	end
	if test.rate_sample_frames < 120 then
		return false
	end
	assert(test.rate_gameplay_updates == 50,
		'5/6 gameplay clock did not admit 50 fixed steps over 60 world updates')
	return player.frame > test.resumed_player_frame
end
