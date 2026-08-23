local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local moon<const> = require('enemies/moon')
require('constants')

local moon_tree<const> = {}

moon_tree.id = moon.tree_id

-- The complete immutable combat graph stays together. Actor methods implement
-- its domain tasks; the lifecycle FSM remains owned by moon.lua.
function moon_tree.register()
	local fly_attack<const> = {
		type = 'sequence',
		services = {
			{
				interval = {
					period_units = moon_mini_spawn_interval_ticks,
					units_per_tick = 1,
				},
				restart_timer_on_each_activation = true,
				on_tick = moon.spawn_mini_moon,
			},
		},
		children = {
			{
				type = 'task',
				tick = moon.tick_fly_left,
				interval_ticks = 1,
			},
			{
				type = 'random_selector',
				children = {
					{
						type = 'task',
						tick = moon.tick_fly_up,
						interval_ticks = 1,
					},
					{
						type = 'task',
						tick = moon.tick_fly_down,
						interval_ticks = 1,
					},
				},
			},
			{
				type = 'parallel_one',
				children = {
					{
						type = 'task',
						tick = moon.tick_small_ray_pass,
						interval_ticks = moon_small_ray_move_interval_ticks,
					},
					{
						type = 'sequence',
						children = {
							{
								type = 'task',
								tick = moon.tick_rotate_to_small_ray_direction,
								interval_ticks = 1,
							},
							{
								type = 'sequence',
								services = {
									{
										on_become_relevant = moon.activate_small_ray_flashes,
										on_cease_relevant = moon.deactivate_flashes,
									},
								},
								children = {
									{
										type = 'wait',
										duration_ticks = moon_small_ray_flash_ticks,
									},
									{
										type = 'task',
										execute = moon.fire_small_ray_volley,
									},
									{
										type = 'loop',
										child = {
											type = 'sequence',
											children = {
												{
													type = 'wait',
													duration_ticks = moon_small_ray_volley_interval_ticks,
												},
												{
													type = 'task',
													execute = moon.fire_small_ray_volley,
												},
											},
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
				tick = moon.tick_rotate_to_right,
				interval_ticks = 1,
			},
			{
				type = 'task',
				execute = moon.begin_death_ray,
			},
			{
				type = 'parallel_one',
				children = {
					{
						type = 'wait',
						duration_ticks = moon_death_ray_cycle_ticks,
					},
					{
						type = 'loop',
						child = {
							type = 'sequence',
							children = {
								{
									type = 'task',
									node_memory = true,
									execute = moon.begin_death_ray_movement,
									tick = moon.tick_death_ray_movement,
								},
								{
									type = 'wait',
									duration_ticks = moon_death_ray_move_pause_ticks,
								},
							},
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
					tick = moon.tick_entering,
					interval_ticks = moon_enter_interval_ticks,
				},
				fly_attack,
				death_ray_attack,
				{
					type = 'loop',
					child = {
						type = 'sequence',
						children = {
							{
								type = 'wait',
								duration_ticks = moon_wait_for_attack_ticks,
								services = {
									{
										interval = {
											period_units = moon_slow_vertical_period_units,
											units_per_tick = moon_slow_vertical_units_per_tick,
										},
										restart_timer_on_each_activation = true,
										on_tick = moon.tick_vertical_playfield,
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
		},
	})
end

return moon_tree
