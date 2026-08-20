local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')

local selected_apu_source<const>: *word = 0x0800018c
local replacement_source_address<const> = rom_dir.audio('daemondeath').addr
local dance_source_address<const> = rom_dir.audio('danceofjoy').addr

__bmsx_host_test = {
	frames = 0,
	phase = 'start',
	finished_count = 0,
	saw_terminal_playback = false,
}

local record_finished<const> = function(test)
	test.finished_count = test.finished_count + 1
end

function __bmsx_host_test.setup()
	new_game()
end

function __bmsx_host_test.ready()
	return registry:get('d') ~= nil
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 1200, 'AEM completion scenario timed out phase=' .. test.phase)
	if world.active_space_id ~= 'main' then
		return false
	end
	local director<const> = registry:get('d')

	if test.phase == 'start' then
		director.events:on({
			event = 'victory_dance_done',
			subscriber = test,
			handler = record_finished,
		})
		director.events:emit('victory_dance')
		test.phase = 'cancel'
		return false
	end

	if test.phase == 'cancel' then
		director.events:emit('daemon.defeated')
		assert(*selected_apu_source == replacement_source_address, 'replacement sound was not admitted')
		test.phase = 'verify_cancel'
		return false
	end

	if test.phase == 'verify_cancel' then
		assert(test.finished_count == 0, 'replaced playback emitted natural completion')
		if *selected_apu_source ~= 0 then
			return false
		end
		director.events:emit('victory_dance')
		test.phase = 'await_natural'
		return false
	end

	if *selected_apu_source == dance_source_address then
		test.saw_terminal_playback = true
	end
	if test.finished_count == 0 then
		return false
	end
	assert(test.finished_count == 1, 'natural playback emitted completion more than once')
	assert(test.saw_terminal_playback, 'completion preceded the terminal queued playback')
	return true
end
