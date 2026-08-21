local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local clock<const> = require('cartlib/clock')
local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')

local mini_moons<const> = world:active_definition_view(ids_mini_moon_def)
local small_rays<const> = world:active_definition_view(ids_moon_small_ray_def)

__bmsx_host_test = {
	frames = 0,
	phase = 'spawn',
}

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
	assert(test.frames < 700, 'Nemesis S Moon encounter scenario timed out phase=' .. test.phase)

	local stage<const> = registry:get(ids_stage_instance)
	local player<const> = registry:get('nemesis_s.player.1')
	if stage == nil or player == nil or world.active_space_id ~= 'main' then
		return false
	end

	if test.phase == 'spawn' then
		stage.actor_spawn_index = stage.actor_spawn_count + 1
		stage.scrolling = false
		stage.state_machines:transition_to('/running/stopped')
		local boss<const> = world:spawn(ids_moon_def, {
			stage = stage,
			pos = { x = moon_spawn_x, y = moon_spawn_y },
		})
		test.boss = boss
		test.entering = boss.state_machines:bind_state_path('/entering')
		test.fly_attack = boss.state_machines:bind_state_path('/combat/fly_attack')
		test.small_rays_up = boss.state_machines:bind_state_path('/combat/small_rays_up')
		test.death_ray_charging = boss.state_machines:bind_state_path(
			'/combat/death_ray/flashing/charging'
		)
		test.death_ray_firing = boss.state_machines:bind_state_path('/combat/death_ray/firing')
		test.wait_for_attack = boss.state_machines:bind_state_path('/combat/wait_for_new_attack')
		test.dying = boss.state_machines:bind_state_path('/dying')
		assert(boss.health == moon_health and not boss.vulnerable,
			'Moon did not enter armored with its one-player XNA health')
		assert(boss.state_machines:matches_state(test.entering),
			'Moon did not start in its authored entrance state')
		local core<const> = boss:get_component(collider_2d_component, moon_core_collider_id)
		local armor<const> = boss:get_component(collider_2d_component, moon_armor_collider_id)
		assert(core.shape_ref ~= nil and armor.shape_ref ~= nil and core.shape_ref ~= armor.shape_ref,
			'Moon did not bind its separate retained core and armor hitmaps')
		boss:receive_player_projectile({ damage = 1, x = boss.x, y = boss.y }, moon_core_collider_id)
		assert(boss.health == moon_health,
			'Moon core accepted damage during the armored entrance')
		boss:rotate_counterclockwise()
		assert(boss.sprite_component.imgid == assets_moon_right
			and not boss.sprite_component.flip_h and not boss.sprite_component.flip_v,
			'Moon rotation did not advance visual and collision pose together')
		boss.rotation = moon_rotation_down_right
		boss:apply_rotation()
		test.phase = 'entering'
		return false
	end

	local boss<const> = test.boss
	if test.phase == 'entering' then
		if boss.state_machines:matches_state(test.entering) then
			return false
		end
		assert(boss.state_machines:matches_state(test.fly_attack)
			and boss.x == moon_enter_target_x and boss.vulnerable,
			'Moon entrance did not stop at the XNA combat boundary')
		test.phase = 'mini_moon'
		return false
	end

	if test.phase == 'mini_moon' then
		local minis<const> = mini_moons.objects
		if #minis == 0 then
			return false
		end
		local mini<const> = minis[1]
		local motion<const> = mini:get_component(fixed_point_velocity_component)
		assert(math.abs(motion.velocity_x) == mini_moon_speed_q8
			or math.abs(motion.velocity_y) == mini_moon_speed_q8,
			'Mini Moon did not retain the XNA dominant-axis launch speed')
		boss.x = 0
		boss.y = playfield_height - moon_height
		boss.vertical_direction = moon_vertical_direction_up
		boss.state_machines:transition_to('/combat/small_rays_up/rotating')
		assert(boss.state_machines:matches_state(test.small_rays_up),
			'Moon did not enter the upward small-ray pass')
		test.phase = 'small_rays'
		return false
	end

	if test.phase == 'small_rays' then
		local rays<const> = small_rays.objects
		if #rays < 2 then
			return false
		end
		assert(rays[1].direction == moon_vertical_direction_up
			and rays[2].direction == moon_vertical_direction_up,
			'Moon upward volley emitted a ray in the wrong direction')
		assert(rays[1].y == boss.y + 8 and rays[2].y == boss.y + 8,
			'Moon upward volley lost the XNA lower-rotation muzzle anchors')
		boss.rotation = moon_rotation_right
		boss:apply_rotation()
		boss.y = 0
		boss.vertical_direction = moon_vertical_direction_down
		boss.state_machines:transition_to('/combat/death_ray/rotating')
		test.phase = 'death_ray'
		return false
	end

	if test.phase == 'death_ray' then
		if boss.state_machines:matches_state(test.death_ray_charging) then
			test.death_ray_charge_time_ms = world.gameplay_time_ms
			test.phase = 'death_ray_charging'
			return false
		end
		assert(not boss.state_machines:matches_state(test.death_ray_firing),
			'Moon death ray fired before reaching the XNA charge window')
		return false
	end

	if test.phase == 'death_ray_charging' then
		if not boss.state_machines:matches_state(test.death_ray_firing) then
			return false
		end
		assert(world.gameplay_time_ms - test.death_ray_charge_time_ms
			>= moon_death_ray_flash_ms - clock.update_milliseconds(),
			'Moon death-ray charge elapsed before entering its valid firing window')
		local ray<const> = boss.death_ray
		if ray == nil then
			return false
		end
		test.ray = ray
		test.death_ray_contracting = ray.state_machines:bind_state_path('/contracting')
		test.phase = 'death_ray_expanding'
		return false
	end

	if test.phase == 'death_ray_expanding' then
		local ray<const> = test.ray
		if ray.ray_strip.last_tile == 0 then
			return false
		end
		assert(ray.ray_strip.enabled and ray.ray_strip_collider.enabled,
			'Moon death-ray visual and collision strip did not activate together')
		assert(ray.originator == boss and ray.y == boss.y + moon_death_ray_offset_y,
			'Moon death ray did not retain its projectile owner while expanding')
		if not ray.state_machines:matches_state(test.death_ray_contracting) then
			return false
		end
		test.ray_y = ray.y
		test.boss_y = boss.y
		test.gameplay_time_ms = world.gameplay_time_ms
		test.phase = 'death_ray_contracting'
		return false
	end

	if test.phase == 'death_ray_contracting' then
		if world.gameplay_time_ms == test.gameplay_time_ms then
			return false
		end
		local ray<const> = test.ray
		assert(boss.y ~= test.boss_y,
			'Moon stopped moving when its death ray began contracting')
		assert(ray.y == test.ray_y,
			'Moon contracting ray still followed the moving boss instead of its own trajectory')
		assert(not ray.ray_cap.enabled and not ray.ray_cap_collider.enabled,
			'Moon contracting ray retained its leading cap collision')
		ray.x = 0
		test.phase = 'death_ray_finished'
		return false
	end

	if test.phase == 'death_ray_finished' then
		if not boss.state_machines:matches_state(test.wait_for_attack) then
			return false
		end
		assert(boss.death_ray == nil,
			'Moon retained a completed projectile after the death-ray completion boundary')
		boss.state_machines:transition_to('/combat/death_ray/firing')
		local ray<const> = boss.death_ray
		boss.health = 1
		boss.vulnerable = true
		boss:receive_player_projectile({ damage = 1, x = boss.x, y = boss.y }, moon_core_collider_id)
		assert(boss.health == 0 and boss.state_machines:matches_state(test.dying),
			'Moon core destruction did not enter the authored death sequence')
		assert(not boss.core_collider.enabled and not boss.armor_collider.enabled,
			'Moon death retained active hitmap colliders')
		assert(boss.death_ray == ray and ray.ray_cap.enabled,
			'Moon death removed its independently retained death ray')
		ray.state_machines:transition_to('/contracting')
		ray.x = 0
		test.gameplay_time_ms = world.gameplay_time_ms
		test.phase = 'dying_ray_finished'
		return false
	end

	if test.phase == 'dying_ray_finished' then
		if world.gameplay_time_ms == test.gameplay_time_ms then
			return false
		end
		assert(boss.state_machines:matches_state(test.dying) and boss.death_ray == nil,
			'Moon death-ray completion escaped the active death sequence')
		boss:mark_for_disposal()
		return true
	end

	return false
end
