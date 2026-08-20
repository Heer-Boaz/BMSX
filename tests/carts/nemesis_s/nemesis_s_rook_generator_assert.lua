local clock<const> = require('cartlib/clock')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')

__bmsx_host_test = {
	frames = 0,
	phase = 'spawn',
	spawn_count = 0,
	spawn_times = {},
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
	assert(test.frames < 360, 'Nemesis S RookGenerator scenario timed out phase=' .. test.phase)

	local stage<const> = registry:get(ids_stage_instance)
	if world.active_space_id ~= 'main' or stage == nil then
		return false
	end

	if test.phase == 'spawn' then
		stage.scrolling = false
		stage.actor_spawn_index = stage.actor_spawn_count + 1
		local generator<const> = world:spawn(ids_rook_generator_def, {
			pos = { x = 200, y = 112 },
		})
		generator:get_component(collider_2d_component):set_enabled(false)
		generator.events:on({
			event = 'enemy.spawned',
			subscriber = test,
			handler = record_spawn,
		})
		test.generator = generator
		test.idle_state = generator.state_machines:bind_state_path('/idle')
		test.generating_state = generator.state_machines:bind_state_path('/generating')
		test.spawn_time_ms = world.gameplay_time_ms
		test.phase = 'initial_wait'
		return false
	end

	local generator<const> = test.generator
	local state_machines<const> = generator.state_machines
	if test.phase == 'initial_wait' then
		assert(test.spawn_count == 0, 'RookGenerator spawned before opening')
		if not state_machines:matches_state(test.generating_state) then
			return false
		end
		local elapsed<const> = world.gameplay_time_ms - test.spawn_time_ms
		assert(elapsed >= rook_generator_initial_wait_ms
			and elapsed <= rook_generator_initial_wait_ms + clock.frame_milliseconds(),
			'RookGenerator changed its initial wait cadence')
		test.generation_time_ms = world.gameplay_time_ms
		test.phase = 'burst'
		return false
	end

	if test.phase == 'burst' then
		local spawn_count<const> = test.spawn_count
		if spawn_count > 0 then
			local previous_time_ms = test.generation_time_ms
			if spawn_count > 1 then
				previous_time_ms = test.spawn_times[spawn_count - 1]
			end
			local elapsed<const> = test.spawn_times[spawn_count] - previous_time_ms
			assert(elapsed >= rook_generator_spawn_interval_ms
				and elapsed <= rook_generator_spawn_interval_ms + clock.frame_milliseconds(),
				'RookGenerator changed its repeated spawn cadence')
		end
		if spawn_count < generator.rook_target_count then
			return false
		end
		assert(state_machines:matches_state(test.idle_state),
			'RookGenerator did not close after its authored burst')
		test.burst_finished_time_ms = world.gameplay_time_ms
		test.phase = 'random_wait'
		return false
	end

	if not state_machines:matches_state(test.generating_state) then
		return false
	end
	local elapsed<const> = world.gameplay_time_ms - test.burst_finished_time_ms
	assert(elapsed >= rook_generator_min_wait_ms,
		'RookGenerator repeated before its authored random wait')
	assert(elapsed <= rook_generator_max_wait_ms + clock.frame_milliseconds(),
		'RookGenerator exceeded its authored random wait')
	return true
end
