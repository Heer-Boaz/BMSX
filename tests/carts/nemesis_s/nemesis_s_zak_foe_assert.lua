local clock<const> = require('cartlib/clock')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')

__bmsx_host_test = {
	frames = 0,
	phase = 'spawn',
}

function __bmsx_host_test.ready()
	return registry:get(ids_director_instance) ~= nil
end

function __bmsx_host_test.setup()
	local test<const> = __bmsx_host_test
	local director<const> = registry:get(ids_director_instance)
	director.state_machines:transition_to('/game_start')
	director.state_machines:transition_to('/gameplay')
	test.bullets = world:active_definition_view(ids_enemy_bullet_def)
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 220, 'Nemesis S ZakFoe scenario timed out phase=' .. test.phase)

	local stage<const> = registry:get(ids_stage_instance)
	if world.active_space_id ~= 'main' or stage == nil then
		return false
	end

	if test.phase == 'spawn' then
		stage.scrolling = false
		stage.actor_spawn_index = stage.actor_spawn_count + 1
		local foe<const> = world:spawn(ids_zak_foe_def, {
			stage = stage,
			pos = { x = 200, y = 112 },
		})
		foe:get_component(collider_2d_component):set_enabled(false)
		test.spawn_time_ms = world.gameplay_time_ms
		test.phase = 'before_pause'
		return false
	end

	local bullets<const> = test.bullets.objects
	if test.phase == 'before_pause' then
		assert(#bullets == 0, 'ZakFoe fired before its authored initial cooldown')
		if world.gameplay_time_ms - test.spawn_time_ms < 400 then
			return false
		end
		test.paused_time_ms = world.gameplay_time_ms
		test.pause_frames = 0
		test.phase = 'paused'
		world:set_gameplay_clock_running(false)
		return false
	end

	if test.phase == 'paused' then
		assert(world.gameplay_time_ms == test.paused_time_ms,
			'ZakFoe cooldown advanced while gameplay was suspended')
		assert(#bullets == 0, 'ZakFoe fired while gameplay was suspended')
		test.pause_frames = test.pause_frames + 1
		if test.pause_frames < 30 then
			return false
		end
		test.phase = 'first_shot'
		world:set_gameplay_clock_running(true)
		return false
	end

	if test.phase == 'first_shot' then
		if #bullets == 0 then
			assert(world.gameplay_time_ms - test.spawn_time_ms < zak_foe_fire_initial_ms,
				'ZakFoe missed its initial cooldown boundary')
			return false
		end
		test.first_bullet_id = bullets[1].id
		test.first_shot_time_ms = world.gameplay_time_ms
		test.phase = 'repeat_shot'
		return false
	end

	for index = 1, #bullets do
		if bullets[index].id ~= test.first_bullet_id then
			local repeat_delay_ms<const> = world.gameplay_time_ms - test.first_shot_time_ms
			assert(repeat_delay_ms >= zak_foe_fire_min_ms,
				'ZakFoe repeated before the authored random cooldown')
			assert(repeat_delay_ms <= zak_foe_fire_max_ms + clock.frame_milliseconds(),
				'ZakFoe exceeded the authored random cooldown')
			return true
		end
	end
	return false
end
