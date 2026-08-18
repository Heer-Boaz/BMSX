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

local advance_walk_cadence<const> = function(task_state)
	local ticks<const> = task_state.ticks + 1
	if ticks < boss_world1_walk_step_ticks then
		task_state.ticks = ticks
		return false
	end
	task_state.ticks = 0
	return true
end

local move_in_on_start<const> = function(task_state, target)
	task_state.ticks = 0
	target:begin_walk()
	return bt_running
end

local move_in_on_running<const> = function(task_state, target)
	if not advance_walk_cadence(task_state) then
		return bt_running
	end
	if target:walk_into_room() then
		return bt_success
	end
	return bt_running
end

local move_out_on_start<const> = function(task_state, target)
	task_state.ticks = 0
	target:begin_walk()
	return bt_running
end

local move_out_on_running<const> = function(task_state, target, _blackboard, backward)
	if not advance_walk_cadence(task_state) then
		return bt_running
	end
	if target:walk_out_of_room(backward) then
		return bt_success
	end
	return bt_running
end

local tick_spawn_attack<const> = function(task_state, target)
	local elapsed_ticks<const> = task_state.elapsed_ticks + 1
	local cadence<const> = task_state.cadence + boss_world1_spawn_cadence_units_per_tick
	task_state.elapsed_ticks = elapsed_ticks
	if cadence >= boss_world1_spawn_cadence_units then
		task_state.cadence = cadence - boss_world1_spawn_cadence_units
		target:spawn_attack_burst()
	else
		task_state.cadence = cadence
	end
	if elapsed_ticks >= boss_world1_spawn_duration_ticks then
		return bt_success
	end
	return bt_running
end

local spawn_attack_on_start<const> = function(task_state, target)
	task_state.elapsed_ticks = 0
	task_state.cadence = 0
	target:begin_spawn_attack()
	return tick_spawn_attack(task_state, target)
end

local pounce_on_start<const> = function(_task_state, target)
	target:begin_pounce()
	return bt_running
end

local pounce_on_running<const> = function(_task_state, target)
	if target:pounce_step() then
		return bt_success
	end
	return bt_running
end

local tick_zak_spawner<const> = function(task_state, target)
	local cadence<const> = task_state.cadence + boss_world1_spawn_cadence_units_per_tick
	if cadence >= boss_world1_zak_cadence_units then
		task_state.cadence = cadence - boss_world1_zak_cadence_units
		target:spawn_zak()
	else
		task_state.cadence = cadence
	end
	return bt_running
end

local zak_spawner_on_start<const> = function(task_state, target)
	task_state.cadence = 0
	return tick_zak_spawner(task_state, target)
end

local spawn_is_required<const> = function(_target, blackboard)
	return blackboard.node_data.no_spawn_run_count >= 1
end

local reset_no_spawn_run_count<const> = function(_target, blackboard)
	blackboard.node_data.no_spawn_run_count = 0
	return bt_success
end

local record_no_spawn_run<const> = function(_target, blackboard)
	local node_data<const> = blackboard.node_data
	node_data.no_spawn_run_count = node_data.no_spawn_run_count + 1
	return bt_success
end

local finish_cycle<const> = function(target, blackboard)
	blackboard.node_data.first_run = false
	target:choose_entrance()
	return bt_success
end

function world1_daemon_tree.register()
	local timeline_id<const> = world1_daemon_tree.timeline_id
	local move_in<const> = {
		type = 'stateful_action',
		on_start = move_in_on_start,
		on_running = move_in_on_running,
	}
	local move_out_forward<const> = {
		type = 'stateful_action',
		on_start = move_out_on_start,
		on_running = move_out_on_running,
		parameters = false,
	}
	local move_out_backward<const> = {
		type = 'stateful_action',
		on_start = move_out_on_start,
		on_running = move_out_on_running,
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
				type = 'stateful_action',
				on_start = spawn_attack_on_start,
				on_running = tick_spawn_attack,
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
				type = 'stateful_action',
				on_start = pounce_on_start,
				on_running = pounce_on_running,
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
				type = 'action',
				action = reset_no_spawn_run_count,
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
				type = 'action',
				action = record_no_spawn_run,
			},
			pounce_and_exit,
		},
	}
	local exit_backward_without_spawn<const> = {
		type = 'sequence',
		children = {
			{
				type = 'action',
				action = record_no_spawn_run,
			},
			move_out_backward,
		},
	}
	local later_run<const> = {
		type = 'selector',
		children = {
			{
				type = 'sequence',
				children = {
					{
						type = 'condition',
						condition = spawn_is_required,
					},
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
		type = 'sequence',
		children = {
			move_in,
			{
				type = 'selector',
				children = {
					{
						type = 'sequence',
						children = {
							{
								type = 'condition',
								condition = function(_target, blackboard)
									return blackboard.node_data.first_run
								end,
							},
							spawn_attack,
							pounce_and_exit,
						},
					},
					later_run,
				},
			},
			{
				type = 'parallel_one',
				children = {
					{
						type = 'wait',
						duration_ticks = boss_world1_reentry_ticks,
					},
					{
						type = 'stateful_action',
						on_start = zak_spawner_on_start,
						on_running = tick_zak_spawner,
					},
				},
			},
			{
				type = 'action',
				action = finish_cycle,
			},
		},
	})
end

return world1_daemon_tree
