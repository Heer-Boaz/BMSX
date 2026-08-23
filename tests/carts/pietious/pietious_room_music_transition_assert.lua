local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')

local apu_slot<const>: *word = 0x08000148
local selected_apu_source<const>: *word = 0x0800018c
local world_source<const> = rom_dir.audio('music_world').addr
local seal_stinger_source<const> = rom_dir.audio('music_seal_1').addr

local world_room_music<const> = {
	world_number = 1,
	has_active_seal = false,
	daemon_fight_active = false,
	suppress_room_music = false,
}

local seal_room_music<const> = {
	world_number = 1,
	has_active_seal = true,
	daemon_fight_active = false,
	suppress_room_music = false,
}

__bmsx_host_test = {
	phase = 'start_world',
	frames = 0,
	transition_frames = 0,
}

function __bmsx_host_test.ready()
	return registry:get('d') ~= nil
end

function __bmsx_host_test.setup()
	registry:get('d').request_new_game()
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 500, 'room music transition timed out phase=' .. test.phase)
	if world.active_space_id ~= 'main' then
		return false
	end

	local director<const> = registry:get('d')
	*apu_slot = 1
	local source<const> = *selected_apu_source
	if test.phase == 'start_world' then
		director.events:emit('lithograph_exit_done', world_room_music)
		test.phase = 'await_world'
		return false
	end
	if test.phase == 'await_world' then
		if source ~= world_source then
			return false
		end
		director.events:emit('room.enter', seal_room_music)
		*apu_slot = 1
		assert(*selected_apu_source == world_source,
			'entering the seal room cut off world music before its fade')
		test.phase = 'await_seal'
		test.transition_frames = 0
		return false
	end
	if test.phase == 'await_seal' then
		test.transition_frames = test.transition_frames + 1
		if source ~= seal_stinger_source then
			return false
		end
		assert(test.transition_frames > 20,
			'seal stinger started before the physical room-music fade completed')
		director.events:emit('room.enter', world_room_music)
		*apu_slot = 1
		assert(*selected_apu_source == seal_stinger_source,
			'leaving the seal room cut off its active stinger before the fade')
		test.phase = 'await_world_return'
		test.transition_frames = 0
		return false
	end

	test.transition_frames = test.transition_frames + 1
	if source ~= world_source then
		return false
	end
	assert(test.transition_frames > 20,
		'world music resumed before the seal-room fade completed')
	director.events:emit('world_leave_transition_start')
	*apu_slot = 1
	assert(*selected_apu_source == world_source,
		'world-leave music did not enter its physical fade')
	director.events:emit('world_emerge_start')
	*apu_slot = 1
	assert(*selected_apu_source == world_source,
		'world emergence cut off the in-flight world-leave fade')
	return true
end
