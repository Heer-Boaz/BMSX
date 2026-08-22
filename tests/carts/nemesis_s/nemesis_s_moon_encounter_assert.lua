local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local collision_shape<const> = require('cartlib/collision/collision_shape')
local sprite_component<const> = require('cartlib/component/sprite_component')
local clock<const> = require('cartlib/clock')
local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local assets<const> = require('bmsx/assets')
require('constants')

local mini_moons<const> = world:active_definition_view(ids_mini_moon_def)
local small_rays<const> = world:active_definition_view(ids_moon_small_ray_def)
local death_rays<const> = world:active_definition_view(ids_moon_death_ray_def)
local mini_moon_velocity_q8<const> = math.round(
	mini_moon_speed_px_per_second * clock.gameplay_delta_milliseconds() * 0.001 * 0x100
)

__bmsx_host_test = {
	frames = 0,
	phase = 'spawn',
	volley_count = 0,
}

function __bmsx_host_test.on_small_ray_fired(self)
	self.volley_count = self.volley_count + 1
	self.volley_time_ms = world.gameplay_time_ms
	if self.volley_count == 1 then
		self.first_volley_time_ms = self.volley_time_ms
	end
end

function __bmsx_host_test.ready()
	return registry:get(ids_director_instance) ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = registry:get(ids_director_instance)
	director.state_machines:transition_to('/game_start')
end

function __bmsx_host_test.update()
	if world.active_space_id == 'game_start' then
		local director<const> = registry:get(ids_director_instance)
		if director.status_bar ~= nil then
			director.state_machines:transition_to('/gameplay')
		end
		return false
	end
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 1200, 'Nemesis S Moon encounter scenario timed out phase=' .. test.phase)

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
		test.active = boss.state_machines:bind_state_path('/active')
		test.dying = boss.state_machines:bind_state_path('/dying')
		boss.events:on({
			event = 'enemy.moon.small_ray_fired',
			subscriber = test,
			handler = test.on_small_ray_fired,
		})
		assert(boss.health == moon_health and not boss.vulnerable,
			'Moon did not enter armored with its one-player XNA health')
		assert(boss.state_machines:matches_state(test.active) and boss.behaviour.enabled,
			'Moon lifecycle and combat tree did not start together')
		local core<const> = boss:get_component(collider_2d_component, moon_core_collider_id)
		local armor<const> = boss:get_component(collider_2d_component, moon_armor_collider_id)
		assert(core.shape_ref ~= nil and armor.shape_ref ~= nil and core.shape_ref ~= armor.shape_ref,
			'Moon did not bind its separate retained core and armor hitmaps')
		assert(core.mask == collision_enemy_mask,
			'Moon core tilemap did not block both players and their projectiles')
		boss:receive_player_projectile({ damage = 1, x = boss.x, y = boss.y }, moon_core_collider_id)
		assert(boss.health == moon_health,
			'Moon core accepted damage during the armored entrance')
		boss:rotate_counterclockwise()
		assert(boss.sprite_component.imgid == assets_moon_right
			and not boss.sprite_component.flip_h and not boss.sprite_component.flip_v,
			'Moon rotation did not advance visual and collision pose together')
		boss.rotation = moon_rotation_down
		boss:apply_rotation()
		local down_armor<const> = collision_shape.variant_addresses(
			assets.collision_shape_moon_down_armor_addr
		)
		local down_core<const> = collision_shape.variant_addresses(
			assets.collision_shape_moon_down_core_addr
		)
		assert(boss.armor_collider.shape_ref == down_armor
			and boss.core_collider.shape_ref == down_core,
			'Moon reused a transformed opposite pose instead of its authored collision map')
		assert(boss.sprite_component.flip_h and boss.sprite_component.flip_v,
			'Moon collision pose selection changed its retained sprite orientation')
		boss.rotation = moon_rotation_down_right
		boss:apply_rotation()
		test.phase = 'entering'
		return false
	end

	local boss<const> = test.boss
	if test.phase == 'entering' then
		if not boss.vulnerable then
			return false
		end
		assert(boss.x == moon_enter_target_x
			and boss.state_machines:matches_state(test.active)
			and boss.behaviour.enabled,
			'Moon entrance did not stop at the authored combat boundary')
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
		assert(math.abs(motion.velocity_x) == mini_moon_velocity_q8
			or math.abs(motion.velocity_y) == mini_moon_velocity_q8,
			'Mini Moon did not retain the balanced dominant-axis launch speed')
		test.first_mini_spawn_time_ms = world.gameplay_time_ms
		test.phase = 'mini_moon_cadence'
		return false
	end

	if test.phase == 'mini_moon_cadence' then
		if #mini_moons.objects < 2 then
			return false
		end
		local spawn_interval<const> = world.gameplay_time_ms - test.first_mini_spawn_time_ms
		local expected_interval<const> = (
			moon_mini_spawn_interval_ticks * clock.gameplay_delta_milliseconds()
		)
		assert(spawn_interval == expected_interval,
			'Moon did not retain the reduced Mini Moon admission cadence')
		boss.x = 0
		boss.y = 0
		test.phase = 'small_rays'
		return false
	end

	if test.phase == 'small_rays' then
		local rays<const> = small_rays.objects
		if test.volley_count == 0 or #rays < 2 then
			return false
		end
		local direction<const> = rays[1].direction
		assert(direction == boss.vertical_direction and rays[2].direction == direction,
			'Moon volley emitted a ray in the wrong direction')
		local offset_y<const> = direction == moon_vertical_direction_down and 56 or 8
		assert(rays[1].y == boss.y + offset_y and rays[2].y == boss.y + offset_y,
			'Moon volley lost its authored muzzle anchors')
		test.small_ray = rays[1]
		test.small_ray_moving = rays[1].state_machines:bind_state_path('/moving')
		test.phase = 'small_ray_moving'
		return false
	end

	if test.phase == 'small_ray_moving' then
		local ray<const> = test.small_ray
		if not ray.state_machines:matches_state(test.small_ray_moving) then
			return false
		end
		test.small_ray_y = ray.y
		test.small_ray_time_ms = world.gameplay_time_ms
		test.phase = 'small_ray_speed'
		return false
	end

	if test.phase == 'small_ray_speed' then
		if world.gameplay_time_ms == test.small_ray_time_ms then
			return false
		end
		assert(math.abs(test.small_ray_y - test.small_ray.y) == moon_small_ray_speed,
			'Moon small ray did not retain its balanced movement step')
		test.small_ray_pass_previous_x = boss.x
		test.phase = 'small_ray_pass_start'
		return false
	end

	if test.phase == 'small_ray_pass_start' then
		if boss.x == test.small_ray_pass_previous_x then
			return false
		end
		local tile_size<const> = boss.stage.tile_size
		assert(boss.x == test.small_ray_pass_previous_x + tile_size,
			'Moon small-ray pass skipped a retained horizontal tile step')
		test.small_ray_pass_start_x = boss.x
		test.small_ray_pass_start_time_ms = world.gameplay_time_ms
		test.phase = 'small_ray_pass_speed'
		return false
	end

	if test.phase == 'small_ray_pass_speed' then
		local expected_x<const> = test.small_ray_pass_start_x + boss.stage.tile_size * 5
		if boss.x < expected_x then
			return false
		end
		assert(boss.x == expected_x,
			'Moon small-ray pass skipped a retained horizontal tile step')
		local elapsed_ms<const> = world.gameplay_time_ms - test.small_ray_pass_start_time_ms
		local expected_ms<const> = (
			moon_small_ray_move_interval_ticks * clock.gameplay_delta_milliseconds() * 5
		)
		assert(elapsed_ms == expected_ms,
			'Moon small-ray pass did not retain its halved horizontal speed')
		test.phase = 'small_ray_volley_cadence'
		return false
	end

	if test.phase == 'small_ray_volley_cadence' then
		if test.volley_count < 2 then
			return false
		end
		local expected_ms<const> = (
			moon_small_ray_volley_interval_ticks * clock.gameplay_delta_milliseconds()
		)
		assert(test.volley_time_ms - test.first_volley_time_ms == expected_ms,
			'Moon vertical-ray cadence was not halved at its authored BT interval')
		boss.x = playfield_width - moon_width
		boss.y = 0
		player.y = playfield_height - player_height
		test.phase = 'death_ray'
		return false
	end

	if test.phase == 'death_ray' then
		local rays<const> = death_rays.objects
		if #rays == 0 then
			return false
		end
		local ray<const> = rays[1]
		test.ray = ray
		test.ray_cap = ray:get_component(sprite_component, moon_death_ray_cap_id)
		test.ray_cap_collider = ray:get_component(collider_2d_component, moon_death_ray_cap_id)
		test.death_ray_holding = ray.state_machines:bind_state_path('/holding')
		test.death_ray_start_y = boss.y
		test.death_ray_previous_y = boss.y
		test.death_ray_previous_tiles = ray.ray_strip.last_tile
		test.death_ray_update_count = 0
		test.gameplay_time_ms = world.gameplay_time_ms
		assert(boss.behaviour.enabled and boss.vertical_direction == moon_vertical_direction_down,
			'Moon death-ray task did not select the primary player direction')
		assert(ray.x == boss.x + moon_death_ray_offset_x and ray.originator == boss,
			'Moon death ray lost its authored muzzle or source actor binding')
		assert(ray.ray_strip.last_tile == 2
			and ray.ray_strip.enabled and ray.ray_strip_collider.enabled,
			'Moon death ray did not advance its one-tile admission by one source update')
		test.phase = 'death_ray_expanding'
		return false
	end

	if test.phase == 'death_ray_expanding' then
		if world.gameplay_time_ms == test.gameplay_time_ms then
			return false
		end
		test.gameplay_time_ms = world.gameplay_time_ms
		test.death_ray_update_count = test.death_ray_update_count + 1
		local ray<const> = test.ray
		local tile_count<const> = ray.ray_strip.last_tile
		local holding<const> = ray.state_machines:matches_state(test.death_ray_holding)
		if not holding then
			assert(tile_count == test.death_ray_previous_tiles + 1,
				'Moon death ray did not grow by one source tile per gameplay update')
			test.death_ray_previous_tiles = tile_count
		end
		assert(ray.y == boss.y + moon_death_ray_offset_y,
			'Moon death ray did not follow its source actor while expanding')
		local update_count<const> = test.death_ray_update_count
		if update_count == 1 then
			assert(boss.y == test.death_ray_start_y + boss.stage.tile_size,
				'Moon death-ray movement did not consume the source accumulator overflow')
		elseif update_count == 2 or update_count == 3 then
			assert(boss.y == test.death_ray_previous_y,
				'Moon death-ray movement lost its source accumulator stalls')
		end
		test.death_ray_previous_y = boss.y
		if not holding then
			return false
		end
		assert(tile_count == moon_death_ray_tile_count and ray.x > 0,
			'Moon death ray did not reach the left edge at the source growth rate')
		test.hold_start_time_ms = world.gameplay_time_ms
		test.phase = 'death_ray_holding'
		return false
	end

	if test.phase == 'death_ray_holding' then
		if #death_rays.objects ~= 0 then
			local ray<const> = test.ray
			assert(boss.behaviour.enabled,
				'Moon combat tree stopped before the death-ray attack completed')
			assert(ray.ray_strip.last_tile == moon_death_ray_tile_count
				and test.ray_cap.enabled and test.ray_cap_collider.enabled,
				'Moon death ray contracted instead of retaining the source hold')
			assert(ray.y == boss.y + moon_death_ray_offset_y,
				'Moon death ray stopped following its source actor during the hold')
			return false
		end
		assert(world.gameplay_time_ms - test.hold_start_time_ms
			>= (moon_death_ray_hold_updates - 1) * clock.gameplay_delta_milliseconds(),
			'Moon death ray ended before its source hold boundary')
		boss:begin_death_ray()
		test.phase = 'dying_with_ray'
		return false
	end

	if test.phase == 'dying_with_ray' then
		local rays<const> = death_rays.objects
		if #rays == 0 then
			return false
		end
		local ray<const> = rays[1]
		boss.health = 1
		boss.vulnerable = true
		boss:receive_player_projectile({ damage = 1, x = boss.x, y = boss.y }, moon_core_collider_id)
		assert(boss.health == 0 and boss.state_machines:matches_state(test.dying),
			'Moon core destruction did not enter the authored death sequence')
		assert(not boss.behaviour.enabled,
			'Moon combat tree remained active after the lifecycle entered death')
		assert(boss.core_collider.enabled and boss.armor_collider.enabled,
			'Moon death removed its hitmap before the visible body disappeared')
		assert(death_rays.objects[1] == ray
			and ray:get_component(sprite_component, moon_death_ray_cap_id).enabled,
			'Moon death removed its independently retained death ray')
		test.phase = 'dying_ray_finished'
		return false
	end

	if test.phase == 'dying_ray_finished' then
		if #death_rays.objects ~= 0 then
			return false
		end
		assert(boss.state_machines:matches_state(test.dying),
			'Moon death-ray completion escaped the active death sequence')
		if boss.visible then
			return false
		end
		assert(not boss.core_collider.enabled and not boss.armor_collider.enabled,
			'Moon retained its hitmap after the visible body disappeared')
		boss:mark_for_disposal()
		return true
	end

	return false
end
