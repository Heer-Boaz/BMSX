local clock<const> = require('cartlib/clock')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local enemy_bullet<const> = require('enemies/enemy_bullet')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')
local fixture<const> = require('tests/carts/nemesis_s/fixture')
return {kind = 'integration', tests = {
		jump_motion = function(t)
			local _director<const>, stage<const> = fixture.start_game(t)
			local update_seconds<const> = clock.gameplay_delta_milliseconds() * 0.001
			local jump_velocity_q8<const> = math.round(
			zak_foe_horizontal_speed_px_per_second * update_seconds * 0x100
			)
			local jump_acceleration_q8<const> = math.round(
			zak_foe_vertical_acceleration_px_per_second_squared *
			update_seconds * update_seconds * 0x100
			)

			local test<const> = {}
			stage.scrolling = false
			stage.actor_spawn_index = stage.actor_spawn_count + 1
			local foe<const> = registry:get('nemesis_s.director').gameplay:spawn(ids_zak_foe_def, {
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

			local state_machines<const> = test.foe.state_machines
			t:wait_until('ZakFoe launch', function() return state_machines:matches_state(test.jumping_state) end, 120)
			do
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
			end
			t:wait_until('first jump update', function() return world.gameplay_time_ms >= test.jump_sample_time_ms end, 10)
			assert(state_machines:matches_state(test.jumping_state), 'ZakFoe jump ended before its first update')
			do
				local motion<const> = test.foe.motion
				local delta_x<const> = test.foe.x - test.jump_start_x
				local delta_y<const> = test.foe.y - test.jump_start_y
				assert(math.abs(delta_x + (jump_velocity_q8 >> 8)) <= 1,
				'ZakFoe horizontal jump speed changed with the gameplay cadence: ' .. delta_x)
				assert(math.abs(delta_y + (jump_velocity_q8 >> 8)) <= 1,
				'ZakFoe vertical launch speed changed with the gameplay cadence: ' .. delta_y)
				assert(motion.velocity_y == -jump_velocity_q8 + jump_acceleration_q8,
				'ZakFoe acceleration was not integrated after movement')
			end
			t:wait_until('ZakFoe recovery', function() return state_machines:matches_state(test.recovering_state) end, 120)
			do
				local elapsed<const> = world.gameplay_time_ms - test.jumping_time_ms
				assert(elapsed >= zak_foe_jump_ms
				and elapsed <= zak_foe_jump_ms + clock.gameplay_delta_milliseconds(),
				'ZakFoe jump timeline changed its authored cadence')
				test.recovering_time_ms = world.gameplay_time_ms
			end
			t:wait_until('ZakFoe next preparation', function() return state_machines:matches_state(test.prepare_state) end, 120)
			do
				local elapsed<const> = world.gameplay_time_ms - test.recovering_time_ms
				assert(elapsed >= zak_foe_recovery_ms
				and elapsed <= zak_foe_recovery_ms + clock.gameplay_delta_milliseconds(),
				'ZakFoe recovery timeline changed its authored cadence')
				test.recovered_time_ms = world.gameplay_time_ms
			end
		end,
		paused_fire_and_projectile_lifetime = function(t)
			local _director<const>, stage<const> = fixture.start_game(t)
			local test<const> = {}
			stage.scrolling = false
			stage.actor_spawn_index = stage.actor_spawn_count + 1
			local foe<const> = registry:get('nemesis_s.director').gameplay:spawn(ids_zak_foe_def, {
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

			local bullets<const> = world:active_definition_view(ids_enemy_bullet_def).objects
			local velocity_x<const>, velocity_y<const> = enemy_bullet.aim_velocity(-124, -16)
			assert(velocity_x == -0x0273 and velocity_y == -0x006e, 'enemy-shot direction table changed')
			assert(enemy_bullet.aim_velocity(16, 16) == nil, 'close-range enemy-shot admission changed')
			t:wait_until('pre-fire pause point', function()
				assert(#bullets == 0, 'ZakFoe fired before its initial cooldown')
				return world.gameplay_time_ms - test.spawn_time_ms >= 400
			end, 120)
			local paused_time_ms<const> = world.gameplay_time_ms
			world:set_gameplay_clock_running(false)
			for tick = 1, 30 do
				t:wait_ticks(1)
				assert(world.gameplay_time_ms == paused_time_ms, 'cooldown advanced while gameplay was suspended')
				assert(#bullets == 0, 'ZakFoe fired while gameplay was suspended')
			end
			world:set_gameplay_clock_running(true)
			t:wait_until('ZakFoe initial shot', function()
				if #bullets > 0 then return true end
				assert(world.gameplay_time_ms - test.spawn_time_ms < zak_foe_fire_initial_ms,
				'ZakFoe missed its initial cooldown boundary')
				return false
			end, 120)
			local first_bullet_id<const> = bullets[1].id
			local first_shot_time_ms<const> = world.gameplay_time_ms
			local retained_bullet
			t:wait_until('ZakFoe repeat shot', function()
				for index = 1, #bullets do
					if bullets[index].id ~= first_bullet_id then retained_bullet = bullets[index]; return true end
				end
				return false
			end, 120)
			local repeat_delay_ms<const> = world.gameplay_time_ms - first_shot_time_ms
			assert(repeat_delay_ms >= zak_foe_fire_min_ms, 'ZakFoe repeated before its random cooldown')
			assert(repeat_delay_ms <= zak_foe_fire_max_ms + clock.gameplay_delta_milliseconds(),
			'ZakFoe exceeded its random cooldown')
			local bullet_x<const>, bullet_y<const> = retained_bullet.x, retained_bullet.y
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

			local destroyed_time_ms<const> = world.gameplay_time_ms
			t:wait_until('shooter disposal', function()
				return registry:get(test.foe.id) == nil and world.gameplay_time_ms ~= destroyed_time_ms
			end, 30)
			assert(registry:get(retained_bullet.id) == retained_bullet, 'destroying shooter removed its projectile')
			assert(retained_bullet.x ~= bullet_x or retained_bullet.y ~= bullet_y,
			'projectile stopped updating after its shooter was destroyed')
		end,
}}
