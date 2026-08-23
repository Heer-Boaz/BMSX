local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local moon<const> = require('enemies/moon')
require('constants')

local moon_tree<const> = {}

moon_tree.id = moon.tree_id

-- The complete immutable combat graph stays together. Actor methods implement
-- its domain tasks; the lifecycle FSM remains owned by moon.lua.
function moon_tree.register()
	local tasks<const> = moon.tasks
	local services<const> = moon.services
	local fly_attack<const> = {
		type = 'sequence',
		services = {
			{
				service = services.spawn_mini_moon,
				interval = {
					period_units = moon_mini_spawn_interval_ticks,
					units_per_tick = 1,
				},
				restart_timer_on_each_activation = true,
			},
		},
		children = {
			{
				type = 'task',
				task = tasks.fly_left,
				interval_ticks = 1,
			},
			{
				type = 'random_selector',
				children = {
					{
						type = 'task',
						task = tasks.fly_up,
						interval_ticks = 1,
					},
					{
						type = 'task',
						task = tasks.fly_down,
						interval_ticks = 1,
					},
				},
			},
			{
				type = 'simple_parallel',
				finish_mode = 'abort_background',
				main_task = {
					type = 'task',
					task = tasks.small_ray_pass,
					interval_ticks = moon_small_ray_move_interval_ticks,
				},
				background_tree = {
					type = 'sequence',
					children = {
						{
							type = 'task',
							task = tasks.rotate_to_small_ray_direction,
							interval_ticks = 1,
						},
						{
							type = 'sequence',
							services = {
								{
									service = services.small_ray_flashes,
								},
							},
							children = {
								{
									type = 'wait',
									duration_ticks = moon_small_ray_flash_ticks,
								},
								{
									type = 'task',
									task = tasks.fire_small_ray_volley,
								},
								{
									type = 'sequence',
									decorators = {
										{
											type = 'loop',
											infinite_loop = true,
										},
									},
									children = {
										{
											type = 'wait',
											duration_ticks = moon_small_ray_volley_interval_ticks,
										},
										{
											type = 'task',
											task = tasks.fire_small_ray_volley,
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}
	local death_ray_attack<const> = {
		type = 'sequence',
		children = {
			{
				type = 'task',
				task = tasks.rotate_to_right,
				interval_ticks = 1,
			},
			{
				type = 'task',
				task = tasks.begin_death_ray,
			},
			{
				type = 'simple_parallel',
				finish_mode = 'abort_background',
				main_task = {
					type = 'wait',
					duration_ticks = moon_death_ray_cycle_ticks,
				},
				background_tree = {
					type = 'sequence',
					children = {
						{
							type = 'task',
							task = tasks.death_ray_movement,
						},
						{
							type = 'wait',
							duration_ticks = moon_death_ray_move_pause_ticks,
						},
					},
				},
			},
		},
	}
	behaviour_tree_library.register(moon_tree.id, {
		root = {
			type = 'sequence',
			children = {
				{
					type = 'task',
					task = tasks.enter,
					interval_ticks = moon_enter_interval_ticks,
				},
				fly_attack,
				death_ray_attack,
				{
					type = 'sequence',
					decorators = {
						{
							type = 'loop',
							infinite_loop = true,
						},
					},
					children = {
						{
							type = 'wait',
							duration_ticks = moon_wait_for_attack_ticks,
							services = {
								{
									service = services.vertical_playfield_movement,
									interval = {
										period_units = moon_slow_vertical_period_units,
										units_per_tick = moon_slow_vertical_units_per_tick,
									},
									restart_timer_on_each_activation = true,
								},
							},
						},
						{
							type = 'weighted_random_selector',
							choices = {
								{
									weight = moon_fly_attack_weight,
									child = {
										type = 'sequence',
										children = {
											fly_attack,
											death_ray_attack,
										},
									},
								},
								{
									weight = moon_death_ray_attack_weight,
									child = death_ray_attack,
								},
							},
						},
					},
				},
			},
		},
	})
end

return moon_tree
