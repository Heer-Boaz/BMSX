local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')
local selected_apu_source<const>: *word = 0x0800018c
local replacement_source_address<const> = rom_dir.audio('daemondeath').addr
local dance_source_address<const> = rom_dir.audio('danceofjoy').addr
local record_finished<const> = function(test)
	test.finished_count = test.finished_count + 1
end
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		aem_completion = function(t)
			local director<const> = fixture.start_game(t)
			local test<const> = { finished_count = 0, saw_terminal_playback = false }
			director.events:on({
				event = 'victory_dance_done',
				subscriber = test,
				handler = record_finished,
			})
			director.events:emit('victory_dance')

			t:wait_ticks(1)
			director.events:emit('daemon.defeated')
			assert(*selected_apu_source == replacement_source_address, 'replacement sound was not admitted')
			t:wait_until('replacement playback completes', function()
				assert(test.finished_count == 0, 'replaced playback emitted natural completion')
				return *selected_apu_source == 0
			end, 1200)
			director.events:emit('victory_dance')
			t:wait_until('natural victory playback completes', function()
				if *selected_apu_source == dance_source_address then test.saw_terminal_playback = true end
				return test.finished_count ~= 0
			end, 1200)
			assert(test.finished_count == 1, 'natural playback emitted completion more than once')
			assert(test.saw_terminal_playback, 'completion preceded terminal queued playback')

		end,
	},
}
