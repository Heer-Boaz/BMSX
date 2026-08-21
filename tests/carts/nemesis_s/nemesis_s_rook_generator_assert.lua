local clock<const> = require('cartlib/clock')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')
require('constants')

local selected_apu_source<const>: *word = 0x0800018c
local spawn_audio_source<const> = rom_dir.audio('parodius_enemy_spawn').addr
local update_milliseconds<const> = clock.update_milliseconds()
local first_spawn_updates<const> = rook_generator_initial_wait_updates
	+ rook_generator_opening_updates + 1
local post_formation_updates<const> = rook_generator_cycle_updates
	- (rook_generator_spawn_count - 1) * rook_generator_spawn_interval_updates

__bmsx_host_test = {
	frames = 0,
	phase = 'spawn',
	spawn_count = 0,
	spawn_times = {},
	checked_spawn_count = 0,
}

local record_spawn<const> = function(test)
	local spawn_count<const> = test.spawn_count + 1
	test.spawn_count = spawn_count
	test.spawn_times[spawn_count] = world.gameplay_time_ms
end

function __bmsx_host_test.ready()
	return registry:get(ids_director_instance) ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = registry:get(ids_director_instance)
	director.state_machines:transition_to('/game_start')
	director.state_machines:transition_to('/gameplay')
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 420, 'Nemesis S RookGenerator scenario timed out phase=' .. test.phase)

	local stage<const> = registry:get(ids_stage_instance)
	if world.active_space_id ~= 'main' or stage == nil then
		return false
	end

	if test.phase == 'spawn' then
		stage.scrolling = false
		stage.actor_spawn_index = stage.actor_spawn_count + 1
		local generator<const> = world:spawn(ids_rook_generator_def, {
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
		test.phase = 'formation'
		return false
	end

	local generator<const> = test.generator
	local state_machines<const> = generator.state_machines
	local spawn_count<const> = test.spawn_count
	if spawn_count > test.checked_spawn_count then
		for spawn_index = test.checked_spawn_count + 1, spawn_count do
			assert(*selected_apu_source == spawn_audio_source,
				'RookGenerator spawn did not emit its XNA enemy-spawn cue')
			if spawn_index == 1 then
				assert(test.spawn_times[1] - test.spawn_time_ms
					== first_spawn_updates * update_milliseconds,
					'RookGenerator changed its initial wait and opening cadence')
			else
				local elapsed<const> = test.spawn_times[spawn_index]
					- test.spawn_times[spawn_index - 1]
				if spawn_index <= rook_generator_spawn_count then
					assert(elapsed
						== rook_generator_spawn_interval_updates * update_milliseconds,
						'RookGenerator changed its eight-update formation interval')
				else
					assert(elapsed == post_formation_updates * update_milliseconds,
						'RookGenerator changed its post-formation hold')
				end
			end
		end
		test.checked_spawn_count = spawn_count
	end

	if spawn_count == rook_generator_spawn_count and test.phase == 'formation' then
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
		test.phase = 'cycle_hold'
		return false
	end

	if spawn_count <= rook_generator_spawn_count then
		return false
	end
	assert(test.spawn_times[spawn_count] - test.spawn_times[1]
		== rook_generator_cycle_updates * update_milliseconds,
		'RookGenerator loop did not repeat after 97 actor updates')
	assert(state_machines:matches_state(test.generating_state),
		'RookGenerator left its retained open generation state')
	return true
end
