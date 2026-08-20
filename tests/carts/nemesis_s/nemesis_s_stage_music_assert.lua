local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')

local apu_slot<const>: *word = 0x08000148
local selected_apu_source<const>: *word = 0x0800018c
local stage_intro_source<const> = rom_dir.audio('music_stage_intro').addr
local stage_source<const> = rom_dir.audio('music_stage').addr
local boss_intro_source<const> = rom_dir.audio('music_boss_intro').addr
local boss_source<const> = rom_dir.audio('music_boss').addr

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
end

function __bmsx_host_test.setup()
	local director<const> = registry:get('nemesis_s.director')
	director.state_machines:transition_to('/game_start')
	director.state_machines:transition_to('/gameplay')
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 1200, 'Nemesis S stage music scenario timed out phase=' .. test.phase)

	if test.phase == 'boot' then
		local stage<const> = registry:get('nemesis_s.stage')
		if world.active_space_id ~= 'main' or stage == nil or read_music_source() ~= stage_intro_source then
			return false
		end
		assert(stage.tape_head - 1 == 31, 'stage boot changed the XNA tape-head origin')
		stage.scroll_mode = stage.scroll_mode_forced
		while stage.tape_head - 1 < 138 do
			stage:update_runtime()
		end
		assert(stage.tape_head - 1 == 138, 'main-theme cue crossed the authored XNA column')
		test.phase = 'main_fade'
		return false
	end

	if test.phase == 'main_fade' then
		if read_music_source() ~= stage_source then
			return false
		end
		local stage<const> = registry:get('nemesis_s.stage')
		while stage.tape_head - 1 < 480 do
			stage:update_runtime()
		end
		assert(stage.tape_head - 1 == 480, 'boss-theme cue crossed the authored XNA column')
		test.phase = 'boss_fade'
		return false
	end

	if test.phase == 'boss_fade' then
		if read_music_source() ~= boss_intro_source then
			return false
		end
		test.phase = 'boss_intro'
		return false
	end

	local source<const> = read_music_source()
	if source == boss_intro_source then
		return false
	end
	assert(source == boss_source, 'boss stinger did not hand off to the looping boss theme')
	return true
end
