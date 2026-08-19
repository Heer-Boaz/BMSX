local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local blackboard<const> = require('cartlib/behaviour_tree/blackboard')
local world1_daemon_module<const> = require('boss/world1_daemon')
require('constants')

-- The builder keeps the complete immutable behaviour template together.
-- Domain task methods are referenced directly, just like callbacks in an FSM
-- definition; cartlib lowers the graph to a retained evaluator at admission.
local world1_daemon_tree<const> = {}
local world1_daemon<const> = world1_daemon_module.world1_daemon

world1_daemon_tree.id = world1_daemon.tree_id
world1_daemon_tree.timeline_id = world1_daemon.timeline_id
local first_run_key<const> = blackboard.key('first_run', true)
local no_spawn_run_count_key<const> = blackboard.key('no_spawn_run_count', 0)

function world1_daemon_tree.register()
	local timeline_id<const> = world1_daemon_tree.timeline_id
	local move_out_backward<const> = {
		type = 'task',
		execute = world1_daemon.execute_walk,
		tick = world1_daemon.tick_walk_backward_out_of_room,
		interval_ticks = boss_world1_walk_step_ticks,
	}
	local spawn_attack<const> = {
		type = 'sequence',
		children = {
			{
				type = 'timeline',
				timeline_id = timeline_id.prepare_spawn,
			},
			{
				type = 'wait',
				duration_ticks = boss_world1_spawn_duration_ticks,
				services = {
					{
						interval = {
							period_units = boss_world1_spawn_interval_units,
							units_per_tick = boss_world1_time_units_per_tick,
						},
						node_memory = true,
						restart_timer_on_each_activation = true,
						on_become_relevant = function(_target, node_memory)
							node_memory.burst_count = 0
						end,
						on_tick = function(target, node_memory)
							local burst_count<const> = node_memory.burst_count
							target:spawn_attack_burst(burst_count)
							node_memory.burst_count = burst_count + 1
						end,
					},
				},
			},
			{
				type = 'timeline',
				timeline_id = timeline_id.unprepare_spawn,
			},
			{
				type = 'wait',
				duration_ticks = boss_world1_wait_after_spawn_ticks,
			},
		},
	}
	local pounce_and_exit<const> = {
		type = 'sequence',
		children = {
			{
				type = 'timeline',
				timeline_id = timeline_id.prepare_pounce,
			},
			{
				type = 'wait',
				duration_ticks = boss_world1_wait_before_pounce_ticks,
			},
			{
				type = 'task',
				execute = world1_daemon.execute_pounce,
				tick = world1_daemon.tick_pounce,
			},
			{
				type = 'wait',
				duration_ticks = boss_world1_wait_after_pounce_ticks,
			},
			{
				type = 'timeline',
				timeline_id = timeline_id.unprepare_pounce,
			},
			{
				type = 'task',
				execute = world1_daemon.execute_walk,
				tick = world1_daemon.tick_walk_forward_out_of_room,
				interval_ticks = boss_world1_walk_step_ticks,
			},
		},
	}
	local spawn_and_follow_up<const> = {
		type = 'sequence',
		children = {
			{
				type = 'set_blackboard',
				key = no_spawn_run_count_key,
				value = 0,
			},
			spawn_attack,
			{
				type = 'weighted_random_selector',
				choices = {
					{
						weight = 2,
						child = pounce_and_exit,
					},
					{
						weight = 1,
						child = move_out_backward,
					},
				},
			},
		},
	}
	behaviour_tree_library.register(world1_daemon_tree.id, {
		blackboard = {
			first_run_key,
			no_spawn_run_count_key,
		},
		root = {
			type = 'sequence',
			children = {
				{
					type = 'task',
					execute = world1_daemon.execute_walk,
					tick = world1_daemon.tick_walk_into_room,
					interval_ticks = boss_world1_walk_step_ticks,
				},
				{
					type = 'selector',
					children = {
						{
							type = 'sequence',
							decorators = {
								{
									type = 'blackboard',
									key = first_run_key,
									operation = 'equal',
									value = true,
								},
							},
							children = {
								spawn_attack,
								pounce_and_exit,
							},
						},
						{
							type = 'selector',
							children = {
								{
									type = 'sequence',
									decorators = {
										{
											type = 'blackboard',
											key = no_spawn_run_count_key,
											operation = 'greater_or_equal',
											value = 1,
										},
									},
									children = {
										spawn_and_follow_up,
									},
								},
								{
									type = 'weighted_random_selector',
									choices = {
										{
											weight = 6,
											child = spawn_and_follow_up,
										},
										{
											weight = 3,
											child = {
												type = 'sequence',
												children = {
													{
														type = 'add_blackboard',
														key = no_spawn_run_count_key,
														value = 1,
													},
													pounce_and_exit,
												},
											},
										},
										{
											weight = 1,
											child = {
												type = 'sequence',
												children = {
													{
														type = 'add_blackboard',
														key = no_spawn_run_count_key,
														value = 1,
													},
													move_out_backward,
												},
											},
										},
									},
								},
							},
						},
					},
				},
				{
					type = 'wait',
					duration_ticks = boss_world1_reentry_ticks,
					services = {
						{
							interval = {
								period_units = boss_world1_zak_interval_units,
								units_per_tick = boss_world1_time_units_per_tick,
							},
							on_tick = world1_daemon.spawn_zak,
						},
					},
				},
				{
					type = 'set_blackboard',
					key = first_run_key,
					value = false,
				},
				{
					type = 'task',
					execute = world1_daemon.choose_entrance,
				},
			},
		},
	})
end

return world1_daemon_tree
