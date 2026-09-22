local fixture<const> = require('tests/carts/nemesis_s/fixture')
local rom_dir<const> = require('cartlib/rom_dir')
local apu_slot<const>: *word = 0x08000148
local selected_apu_source<const>: *word = 0x0800018c
local stage_intro_source<const> = rom_dir.audio('music_stage_intro').addr
local stage_source<const> = rom_dir.audio('music_stage').addr
local boss_intro_source<const> = rom_dir.audio('music_boss_intro').addr
local boss_source<const> = rom_dir.audio('music_boss').addr

local music_source<const> = function()
	*apu_slot = 1
	return *selected_apu_source
end

return {
	kind = 'integration',
	tests = {
		tape_cues_crossfade_and_boss_stinger_loops = function(t)
			local _<const>, stage<const> = fixture.start_game(t)
			t:wait_until('stage intro music', function() return music_source() == stage_intro_source end, 120)
			assert(stage.tape_head - 1 == 31, 'stage boot changed the XNA tape-head origin')
			stage.actor_spawn_index = stage.actor_spawn_count + 1
			while stage.tape_head - 1 < 138 do stage:advance_tape() end
			assert(stage.tape_head - 1 == 138, 'main-theme cue crossed the authored XNA column')
			t:wait_until('main-theme crossfade', function() return music_source() == stage_source end, 400)
			while stage.tape_head - 1 < 480 do stage:advance_tape() end
			assert(stage.tape_head - 1 == 480, 'boss-theme cue crossed the authored XNA column')
			t:wait_until('boss intro crossfade', function() return music_source() == boss_intro_source end, 400)
			t:wait_until('boss stinger completion', function() return music_source() ~= boss_intro_source end, 400)
			assert(music_source() == boss_source, 'boss stinger did not hand off to the looping theme')
			while stage.tape_head - 1 < 492 do stage:advance_tape() end
			assert(stage.tape_head - 1 == 492, 'stage missed the first authored XNA scroll stop')
			assert(not stage.scrolling, 'stage remained active at the first authored XNA scroll stop')
			assert(stage.scroll_stop_index == 2, 'stage did not retain the second authored XNA scroll stop')
		end,
	},
}
