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
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		room_music_transition = function(t)
			local director<const> = fixture.start_game(t)
			director.events:emit('lithograph_exit_done', world_room_music)
			t:wait_until('world music', function() *apu_slot = 1; return *selected_apu_source == world_source end, 500)
			local targets<const> = { {seal_room_music, seal_stinger_source}, {world_room_music, world_source} }
			local previous_source = world_source
			for index = 1, #targets do
				local target<const> = targets[index]
				director.events:emit('room.enter', target[1])
				*apu_slot = 1
				assert(*selected_apu_source == previous_source, 'room change cut off current music before fade')
				local transition_ticks = 0
				t:wait_until('physical room-music fade', function()
					*apu_slot = 1
					if *selected_apu_source == target[2] then return true end
					transition_ticks = transition_ticks + 1
					return false
				end, 500)
				assert(transition_ticks > 20, 'room music changed before physical fade completed')
				previous_source = target[2]
			end
			director.events:emit('world_leave_transition_start')
			*apu_slot = 1
			assert(*selected_apu_source == world_source, 'world-leave music did not enter physical fade')
			director.events:emit('world_emerge_start')
			*apu_slot = 1
			assert(*selected_apu_source == world_source, 'world emergence cut off in-flight fade')

		end,
	},
}
