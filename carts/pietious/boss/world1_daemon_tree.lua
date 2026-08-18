local bt_result<const> = require('cartlib/behaviour_tree/result')
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
require('constants')

-- The definition owns encounter decisions and phase composition. Its leaves
-- are bounded tasks (walk, spawn window, pounce and re-entry support); none of
-- them contains a second hidden boss state machine.
local world1_daemon_tree<const> = {}
local bt_running<const> = bt_result.running
local bt_success<const> = bt_result.success

world1_daemon_tree.id = 'enemy_world1_daemon'
world1_daemon_tree.timeline_id = {
	prepare_spawn = 'world1_daemon.prepare_spawn',
	unprepare_spawn = 'world1_daemon.unprepare_spawn',
	prepare_pounce = 'world1_daemon.prepare_pounce',
	unprepare_pounce = 'world1_daemon.unprepare_pounce',
	death = 'world1_daemon.death',
}

local advance_walk_cadence<const> = function(node_memory)
	local ticks<const> = node_memory.ticks + 1
	if ticks < boss_world1_walk_step_ticks then
		node_memory.ticks = ticks
		return false
	end
	node_memory.ticks = 0
	return true
end

local move_in_execute<const> = function(target, node_memory)
	node_memory.ticks = 0
	target:begin_walk()
	return bt_running
end

local move_in_tick<const> = function(target, node_memory)
	if not advance_walk_cadence(node_memory) then
		return bt_running
	end
	if target:walk_into_room() then
		return bt_success
	end
	return bt_running
end

local move_out_execute<const> = function(target, node_memory)
	node_memory.ticks = 0
	target:begin_walk()
	return bt_running
end

local move_out_tick<const> = function(target, node_memory, _execution, backward)
	if not advance_walk_cadence(node_memory) then
		return bt_running
	end
	if target:walk_out_of_room(backward) then
		return bt_success
	end
	return bt_running
end

local spawn_attack_tick<const> = function(target, node_memory)
	local elapsed_ticks<const> = node_memory.elapsed_ticks + 1
	local cadence<const> = node_memory.cadence + boss_world1_spawn_cadence_units_per_tick
	node_memory.elapsed_ticks = elapsed_ticks
	if cadence >= boss_world1_spawn_cadence_units then
		node_memory.cadence = cadence - boss_world1_spawn_cadence_units
		local burst_count<const> = node_memory.burst_count
		target:spawn_attack_burst(burst_count)
		node_memory.burst_count = burst_count + 1
	else
		node_memory.cadence = cadence
	end
	if elapsed_ticks >= boss_world1_spawn_duration_ticks then
		return bt_success
	end
	return bt_running
end

local spawn_attack_execute<const> = function(target, node_memory)
	node_memory.elapsed_ticks = 0
	node_memory.cadence = 0
	node_memory.burst_count = 0
	return spawn_attack_tick(target, node_memory)
end

local pounce_execute<const> = function(target)
	target:begin_pounce()
	return bt_running
end

local pounce_tick<const> = function(target)
	if target:pounce_step() then
		return bt_success
	end
	return bt_running
end

local spawn_zak_service<const> = function(target)
	target:spawn_zak()
end

local choose_next_entrance<const> = function(target)
	target:choose_entrance()
	return bt_success
end

function world1_daemon_tree.register()
	local timeline_id<const> = world1_daemon_tree.timeline_id
	local move_in<const> = {
		type = 'task',
		node_memory = true,
		execute = move_in_execute,
		tick = move_in_tick,
	}
	local move_out_forward<const> = {
		type = 'task',
		node_memory = true,
		execute = move_out_execute,
		tick = move_out_tick,
		parameters = false,
	}
	local move_out_backward<const> = {
		type = 'task',
		node_memory = true,
		execute = move_out_execute,
		tick = move_out_tick,
		parameters = true,
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
				execute = spawn_attack_execute,
				tick = spawn_attack_tick,
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
	local pounce_attack<const> = {
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
				execute = pounce_execute,
				tick = pounce_tick,
			},
			{
				type = 'wait',
				duration_ticks = boss_world1_wait_after_pounce_ticks,
			},
			{
				type = 'timeline',
				timeline_id = timeline_id.unprepare_pounce,
			},
		},
	}
	local pounce_and_exit<const> = {
		type = 'sequence',
		children = {
			pounce_attack,
			move_out_forward,
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
	local pounce_without_spawn<const> = {
		type = 'sequence',
		children = {
			{
				type = 'add_blackboard',
				key = 'no_spawn_run_count',
				value = 1,
			},
			pounce_and_exit,
		},
	}
	local exit_backward_without_spawn<const> = {
		type = 'sequence',
		children = {
			{
				type = 'add_blackboard',
				key = 'no_spawn_run_count',
				value = 1,
			},
			move_out_backward,
		},
	}
	local later_run<const> = {
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
						child = pounce_without_spawn,
					},
					{
						weight = 1,
						child = exit_backward_without_spawn,
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
				move_in,
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
						later_run,
					},
				},
				{
					type = 'wait',
					duration_ticks = boss_world1_reentry_ticks,
					services = {
						{
							interval_ticks = boss_world1_zak_cadence_units
								/ boss_world1_spawn_cadence_units_per_tick,
							on_tick = spawn_zak_service,
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
					execute = choose_next_entrance,
				},
			},
		},
	})
end

return world1_daemon_tree
