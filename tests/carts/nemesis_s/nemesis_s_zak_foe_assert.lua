local clock<const> = require('cartlib/clock')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local enemy_bullet<const> = require('enemies/enemy_bullet')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')

local update_seconds<const> = clock.gameplay_delta_milliseconds() * 0.001
local jump_velocity_q8<const> = math.round(
	zak_foe_horizontal_speed_px_per_second * update_seconds * 0x100
)
local jump_acceleration_q8<const> = math.round(
	zak_foe_vertical_acceleration_px_per_second_squared *
		update_seconds * update_seconds * 0x100
)

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
	test.bullets = world:active_definition_view(ids_enemy_bullet_def)
	local velocity_x<const>, velocity_y<const> = enemy_bullet.aim_velocity(-124, -16)
	assert(velocity_x == -0x0273 and velocity_y == -0x006e,
		'Nemesis 2 enemy-shot direction table changed')
	assert(enemy_bullet.aim_velocity(16, 16) == nil,
		'Nemesis 2 close-range enemy-shot admission changed')
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 220, 'Nemesis S ZakFoe scenario timed out phase=' .. test.phase)

	local stage<const> = registry:get(ids_stage_instance)
	if world.active_space_id ~= 'main' or stage == nil then
		return false
	end
	if test.phase == 'shooter_destroyed' then
		if registry:get(test.foe.id) ~= nil then
			return false
		end
		local bullet<const> = registry:get(test.retained_bullet_id)
		assert(bullet ~= nil, 'destroying ZakFoe also removed its admitted projectile')
		if world.gameplay_time_ms == test.shooter_destroyed_time_ms then
			return false
		end
		assert(bullet.x ~= test.retained_bullet_x or bullet.y ~= test.retained_bullet_y,
			'ZakFoe projectile stopped updating after its shooter was destroyed')
		return true
	end

	if test.phase == 'spawn' then
		stage.scrolling = false
		stage.actor_spawn_index = stage.actor_spawn_count + 1
		local foe<const> = world:spawn(ids_zak_foe_def, {
			stage = stage,
			pos = { x = 200, y = 112 },
		})
		local foe_collider<const> = foe:get_component(collider_2d_component)
		foe_collider:set_enabled(false)
		test.foe = foe
		test.foe_collider_local_id = foe_collider.id_local
		test.jumping_state = foe.state_machines:bind_state_path('/jumping')
		test.recovering_state = foe.state_machines:bind_state_path('/recovering')
		test.prepare_state = foe.state_machines:bind_state_path('/prepare_jump')
		test.spawn_time_ms = world.gameplay_time_ms
		test.phase = 'before_pause'
		return false
	end

	local state_machines<const> = test.foe.state_machines
	if test.jumping_time_ms == nil and state_machines:matches_state(test.jumping_state) then
		local elapsed<const> = world.gameplay_time_ms - test.spawn_time_ms
		assert(elapsed >= zak_foe_prepare_ms
			and elapsed <= zak_foe_prepare_ms + clock.gameplay_delta_milliseconds(),
			'ZakFoe prepare timeline changed its authored cadence')
		test.jumping_time_ms = world.gameplay_time_ms
		test.jump_sample_time_ms = world.gameplay_time_ms + clock.gameplay_delta_milliseconds()
		test.jump_start_x = test.foe.x
		test.jump_start_y = test.foe.y
		local motion<const> = test.foe.motion
		assert(motion.velocity_x == -jump_velocity_q8
			and motion.velocity_y == -jump_velocity_q8,
			'ZakFoe jump did not retain its authored XNA launch velocity')
		assert(motion.acceleration_x == 0
			and motion.acceleration_y == jump_acceleration_q8,
			'ZakFoe jump did not retain its authored XNA acceleration')
	elseif test.jumping_time_ms ~= nil
	and test.jump_sampled == nil
	and world.gameplay_time_ms >= test.jump_sample_time_ms
	and state_machines:matches_state(test.jumping_state) then
		local motion<const> = test.foe.motion
		local delta_x<const> = test.foe.x - test.jump_start_x
		local delta_y<const> = test.foe.y - test.jump_start_y
		assert(math.abs(delta_x + (jump_velocity_q8 >> 8)) <= 1,
			'ZakFoe horizontal jump speed changed with the gameplay cadence: ' .. delta_x)
		assert(math.abs(delta_y + (jump_velocity_q8 >> 8)) <= 1,
			'ZakFoe vertical launch speed changed with the gameplay cadence: ' .. delta_y)
		assert(motion.velocity_y == -jump_velocity_q8 + jump_acceleration_q8,
			'ZakFoe acceleration was not integrated after movement')
		test.jump_sampled = true
	elseif test.jumping_time_ms ~= nil
	and test.recovering_time_ms == nil
	and state_machines:matches_state(test.recovering_state) then
		local elapsed<const> = world.gameplay_time_ms - test.jumping_time_ms
		assert(elapsed >= zak_foe_jump_ms
			and elapsed <= zak_foe_jump_ms + clock.gameplay_delta_milliseconds(),
			'ZakFoe jump timeline changed its authored cadence')
		test.recovering_time_ms = world.gameplay_time_ms
	elseif test.recovering_time_ms ~= nil
	and test.recovered_time_ms == nil
	and state_machines:matches_state(test.prepare_state) then
		local elapsed<const> = world.gameplay_time_ms - test.recovering_time_ms
		assert(elapsed >= zak_foe_recovery_ms
			and elapsed <= zak_foe_recovery_ms + clock.gameplay_delta_milliseconds(),
			'ZakFoe recovery timeline changed its authored cadence')
		test.recovered_time_ms = world.gameplay_time_ms
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
			local bullet<const> = bullets[index]
			local repeat_delay_ms<const> = world.gameplay_time_ms - test.first_shot_time_ms
			assert(test.recovered_time_ms ~= nil, 'ZakFoe phase cycle did not complete')
			assert(repeat_delay_ms >= zak_foe_fire_min_ms,
				'ZakFoe repeated before the authored random cooldown')
			assert(repeat_delay_ms <= zak_foe_fire_max_ms + clock.gameplay_delta_milliseconds(),
				'ZakFoe exceeded the authored random cooldown')
			test.retained_bullet_id = bullet.id
			test.retained_bullet_x = bullet.x
			test.retained_bullet_y = bullet.y
			local player<const> = registry:get('nemesis_s.player.1')
			local projectile<const> = player.primary_projectiles[1]
			player:spawn_bullet(player, projectile)
			test.foe.events:emit('overlap.begin', {
				other_id = player.id,
				other_collider_local_id = projectile.collider.id_local,
				other_layer = collision_player_projectile_layer,
				collider_local_id = test.foe_collider_local_id,
				contact = {
					point = { x = test.foe.x, y = test.foe.y },
				},
			})
			test.shooter_destroyed_time_ms = world.gameplay_time_ms
			test.phase = 'shooter_destroyed'
			return false
		end
	end
	return false
end
