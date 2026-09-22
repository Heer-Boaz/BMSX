local clock<const> = require('cartlib/clock')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')
require('constants')
local selected_apu_source<const>: *word = 0x0800018c
local spawn_audio_source<const> = rom_dir.audio('parodius_enemy_spawn').addr
local first_spawn_updates<const> = rook_generator_initial_wait_updates
+ rook_generator_opening_updates + 1
local post_formation_updates<const> = rook_generator_cycle_updates
- (rook_generator_spawn_count - 1) * rook_generator_spawn_interval_updates
local record_spawn<const> = function(test)
	local spawn_count<const> = test.spawn_count + 1
	test.spawn_count = spawn_count
	test.spawn_times[spawn_count] = world.gameplay_time_ms
end
local fixture<const> = require('tests/carts/nemesis_s/fixture')

return {
	kind = 'integration',
	tests = {
		rook_generator = function(t)
			local _director<const>, stage<const> = fixture.start_game(t)
			local gameplay_delta_milliseconds<const> = clock.gameplay_delta_milliseconds()

			local test<const> = { spawn_count = 0, spawn_times = {} }
			stage.scrolling = false
			stage.actor_spawn_index = stage.actor_spawn_count + 1
			local generator<const> = registry:get('nemesis_s.director').gameplay:spawn(ids_rook_generator_def, {
				stage = stage,
				pos = { x = 240, y = 112 },
			})
			generator:get_component(collider_2d_component):set_enabled(false)
			generator.events:on({
				event = 'enemy.spawned',
				subscriber = test,
				handler = record_spawn,
			})
			test.generator = generator
			test.generating_state = generator.state_machines:bind_state_path('/generating')
			test.rook_view = world:active_definition_view(ids_rook_def)
			test.spawn_time_ms = world.gameplay_time_ms

			local generator<const> = test.generator
			local state_machines<const> = generator.state_machines
			for spawn_index = 1, rook_generator_spawn_count + 1 do
				t:wait_until('RookGenerator spawn', function() return test.spawn_count >= spawn_index end, 420)
				assert(*selected_apu_source == spawn_audio_source,
				'RookGenerator spawn did not emit its XNA enemy-spawn cue')
				if spawn_index == 1 then
					assert(test.spawn_times[1] - test.spawn_time_ms
					== first_spawn_updates * gameplay_delta_milliseconds,
					'RookGenerator changed its initial wait and opening cadence')
				else
					local elapsed<const> = test.spawn_times[spawn_index]
					- test.spawn_times[spawn_index - 1]
					if spawn_index <= rook_generator_spawn_count then
						assert(elapsed
						== rook_generator_spawn_interval_updates * gameplay_delta_milliseconds,
						'RookGenerator changed its eight-update formation interval')
					else
						assert(elapsed == post_formation_updates * gameplay_delta_milliseconds,
						'RookGenerator changed its post-formation hold')
					end
				end
				if spawn_index == rook_generator_spawn_count then
					local rooks<const> = test.rook_view.objects
					assert(#rooks == rook_generator_spawn_count,
					'RookGenerator did not retain its five-cloud formation')
					for rook_index = 1, rook_generator_spawn_count do
						assert(rooks[rook_index].rise_distance == rook_rise_distances[rook_index],
						'RookGenerator changed the Nemesis 2 cloud rise formation')
					end
					assert(state_machines:matches_state(test.generating_state)
					and generator.sprite_component.imgid == assets_rook_generator_open,
					'RookGenerator closed between Nemesis 2 formations')

				end
			end
			local spawn_count<const> = test.spawn_count
			assert(test.spawn_times[spawn_count] - test.spawn_times[1]
			== rook_generator_cycle_updates * gameplay_delta_milliseconds,
			'RookGenerator loop did not repeat after 97 actor updates')
			assert(state_machines:matches_state(test.generating_state),
			'RookGenerator left its retained open generation state')
		end,
	},
}
