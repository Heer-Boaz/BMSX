local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local world1_daemon_module<const> = require('boss/world1_daemon')
require('constants')

-- The builder keeps the complete immutable behaviour template together.
-- Domain task methods are referenced directly, just like callbacks in an FSM
-- definition; cartlib lowers the graph to a retained evaluator at admission.
local world1_daemon_tree<const> = {}
local world1_daemon<const> = world1_daemon_module.world1_daemon

world1_daemon_tree.id = world1_daemon.tree_id
world1_daemon_tree.timeline_id = world1_daemon.timeline_id

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
				type = 'task',
				node_memory = true,
				execute = world1_daemon.execute_spawn_attack,
				tick = world1_daemon.tick_spawn_attack,
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
				key = 'no_spawn_run_count',
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
			{
				key = 'first_run',
				initial_value = true,
			},
			{
				key = 'no_spawn_run_count',
				initial_value = 0,
			},
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
									key = 'first_run',
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
											key = 'no_spawn_run_count',
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
														key = 'no_spawn_run_count',
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
														key = 'no_spawn_run_count',
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
							interval_ticks = boss_world1_zak_cadence_units
								/ boss_world1_spawn_cadence_units_per_tick,
							on_tick = world1_daemon.spawn_zak,
						},
					},
				},
				{
					type = 'set_blackboard',
					key = 'first_run',
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
