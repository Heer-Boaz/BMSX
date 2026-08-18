local behaviour_tree<const> = require('cartlib/behaviour_tree/bt')
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
require('constants')

-- The authored tree owns encounter decisions and phase composition. Its leaves
-- are bounded tasks (walk, pose timeline, spawn window, pounce and re-entry
-- support); none of them contains a second hidden boss state machine.
local world1_daemon_tree<const> = {}
local result<const> = behaviour_tree.result
local bt_running<const> = result.running
local bt_success<const> = result.success

local arrival_spawn<const> = 1
local arrival_pounce<const> = 2
local arrival_move_backward<const> = 3
local followup_pounce<const> = 1
local followup_move_backward<const> = 2

world1_daemon_tree.id = 'enemy_world1_daemon'
world1_daemon_tree.timeline_id = {
	prepare_spawn = 'world1_daemon.prepare_spawn',
	unprepare_spawn = 'world1_daemon.unprepare_spawn',
	prepare_pounce = 'world1_daemon.prepare_pounce',
	unprepare_pounce = 'world1_daemon.unprepare_pounce',
	death = 'world1_daemon.death',
}

local timeline_play_options<const> = {
	rewind = true,
	snap_to_start = true,
}

local timeline_finished<const> = function(_owner, task_state)
	task_state.complete = true
end

local timeline_on_start<const> = function(task_state, target, _blackboard, timeline_id)
	task_state.complete = false
	target.timelines:play(timeline_id, timeline_play_options, timeline_finished, task_state)
	return bt_running
end

local timeline_on_running<const> = function(task_state)
	if task_state.complete then
		return bt_success
	end
	return bt_running
end

local timeline_on_halted<const> = function(_task_state, target, _blackboard, timeline_id)
	target.timelines:stop(timeline_id)
end

local timeline_callbacks<const> = {
	on_start = timeline_on_start,
	on_running = timeline_on_running,
	on_halted = timeline_on_halted,
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

local no_halt_work<const> = function()
end

local move_in_callbacks<const> = {
	on_start = move_in_on_start,
	on_running = move_in_on_running,
	on_halted = no_halt_work,
}

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

local move_out_callbacks<const> = {
	on_start = move_out_on_start,
	on_running = move_out_on_running,
	on_halted = no_halt_work,
}

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

local spawn_attack_callbacks<const> = {
	on_start = spawn_attack_on_start,
	on_running = tick_spawn_attack,
	on_halted = no_halt_work,
}

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

local pounce_callbacks<const> = {
	on_start = pounce_on_start,
	on_running = pounce_on_running,
	on_halted = no_halt_work,
}

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

local zak_spawner_callbacks<const> = {
	on_start = zak_spawner_on_start,
	on_running = tick_zak_spawner,
	on_halted = no_halt_work,
}

local choose_arrival_action<const> = function(_target, blackboard)
	local node_data<const> = blackboard.node_data
	if node_data.no_spawn_run_count >= 1 then
		node_data.arrival_action = arrival_spawn
		node_data.no_spawn_run_count = 0
		return bt_success
	end
	local roll<const> = math.random(1, 10)
	if roll <= 6 then
		node_data.arrival_action = arrival_spawn
		node_data.no_spawn_run_count = 0
	elseif roll <= 9 then
		node_data.arrival_action = arrival_pounce
		node_data.no_spawn_run_count = node_data.no_spawn_run_count + 1
	else
		node_data.arrival_action = arrival_move_backward
		node_data.no_spawn_run_count = node_data.no_spawn_run_count + 1
	end
	return bt_success
end

local arrival_action_is<const> = function(_target, blackboard, action)
	return blackboard.node_data.arrival_action == action
end

local choose_spawn_followup<const> = function(_target, blackboard)
	if math.random(1, 3) <= 2 then
		blackboard.node_data.spawn_followup = followup_pounce
	else
		blackboard.node_data.spawn_followup = followup_move_backward
	end
	return bt_success
end

local spawn_followup_is<const> = function(_target, blackboard, followup)
	return blackboard.node_data.spawn_followup == followup
end

local finish_cycle<const> = function(target, blackboard)
	blackboard.node_data.first_run = false
	target:choose_entrance()
	return bt_success
end

local timeline_action<const> = function(id, timeline_id)
	return behaviour_tree.stateful_action_node.new(id, timeline_callbacks, 0, timeline_id)
end

local move_in_action<const> = function(id)
	return behaviour_tree.stateful_action_node.new(id, move_in_callbacks)
end

local move_out_action<const> = function(id, backward)
	return behaviour_tree.stateful_action_node.new(id, move_out_callbacks, 0, backward)
end

local spawn_attack<const> = function(prefix)
	local timeline_id<const> = world1_daemon_tree.timeline_id
	return behaviour_tree.sequence_node.new(prefix, {
		timeline_action(prefix .. '.prepare', timeline_id.prepare_spawn),
		behaviour_tree.stateful_action_node.new(prefix .. '.bursts', spawn_attack_callbacks),
		timeline_action(prefix .. '.unprepare', timeline_id.unprepare_spawn),
		behaviour_tree.wait_node.new(prefix .. '.wait', boss_world1_wait_after_spawn_ticks),
	})
end

local pounce_attack<const> = function(prefix)
	local timeline_id<const> = world1_daemon_tree.timeline_id
	return behaviour_tree.sequence_node.new(prefix, {
		timeline_action(prefix .. '.prepare', timeline_id.prepare_pounce),
		behaviour_tree.wait_node.new(prefix .. '.wait_before', boss_world1_wait_before_pounce_ticks),
		behaviour_tree.stateful_action_node.new(prefix .. '.pounce', pounce_callbacks),
		behaviour_tree.wait_node.new(prefix .. '.wait_after', boss_world1_wait_after_pounce_ticks),
		timeline_action(prefix .. '.unprepare', timeline_id.unprepare_pounce),
	})
end

local pounce_and_exit<const> = function(prefix)
	return behaviour_tree.sequence_node.new(prefix, {
		pounce_attack(prefix .. '.attack'),
		move_out_action(prefix .. '.exit', false),
	})
end

local later_run_branch<const> = function()
	return behaviour_tree.sequence_node.new('world1_daemon.later_run', {
		behaviour_tree.action_node.new('world1_daemon.later_run.choose', choose_arrival_action),
		behaviour_tree.selector_node.new('world1_daemon.later_run.action', {
			behaviour_tree.sequence_node.new('world1_daemon.later_run.spawn', {
				behaviour_tree.condition_node.new(
					'world1_daemon.later_run.spawn.condition',
					arrival_action_is,
					'NONE',
					0,
					arrival_spawn
				),
				spawn_attack('world1_daemon.later_run.spawn.attack'),
				behaviour_tree.action_node.new(
					'world1_daemon.later_run.spawn.choose_followup',
					choose_spawn_followup
				),
				behaviour_tree.selector_node.new('world1_daemon.later_run.spawn.followup', {
					behaviour_tree.sequence_node.new('world1_daemon.later_run.spawn.pounce', {
						behaviour_tree.condition_node.new(
							'world1_daemon.later_run.spawn.pounce.condition',
							spawn_followup_is,
							'NONE',
							0,
							followup_pounce
						),
						pounce_and_exit('world1_daemon.later_run.spawn.pounce.action'),
					}),
					behaviour_tree.sequence_node.new('world1_daemon.later_run.spawn.exit_backward', {
						behaviour_tree.condition_node.new(
							'world1_daemon.later_run.spawn.exit_backward.condition',
							spawn_followup_is,
							'NONE',
							0,
							followup_move_backward
						),
						move_out_action('world1_daemon.later_run.spawn.exit_backward.action', true),
					}),
				}),
			}),
			behaviour_tree.sequence_node.new('world1_daemon.later_run.pounce', {
				behaviour_tree.condition_node.new(
					'world1_daemon.later_run.pounce.condition',
					arrival_action_is,
					'NONE',
					0,
					arrival_pounce
				),
				pounce_and_exit('world1_daemon.later_run.pounce.action'),
			}),
			behaviour_tree.sequence_node.new('world1_daemon.later_run.exit_backward', {
				behaviour_tree.condition_node.new(
					'world1_daemon.later_run.exit_backward.condition',
					arrival_action_is,
					'NONE',
					0,
					arrival_move_backward
				),
				move_out_action('world1_daemon.later_run.exit_backward.action', true),
			}),
		}),
	})
end

function world1_daemon_tree.register()
	local root<const> = behaviour_tree.sequence_node.new(world1_daemon_tree.id, {
		move_in_action('world1_daemon.move_in'),
		behaviour_tree.selector_node.new('world1_daemon.arrival', {
			behaviour_tree.sequence_node.new('world1_daemon.first_run', {
				behaviour_tree.condition_node.new(
					'world1_daemon.first_run.condition',
					function(_target, blackboard)
						return blackboard.node_data.first_run
					end
				),
				spawn_attack('world1_daemon.first_run.spawn'),
				pounce_and_exit('world1_daemon.first_run.pounce'),
			}),
			later_run_branch(),
		}),
		behaviour_tree.parallel_node.new('world1_daemon.reentry', {
			behaviour_tree.wait_node.new('world1_daemon.reentry.wait', boss_world1_reentry_ticks),
			behaviour_tree.stateful_action_node.new(
				'world1_daemon.reentry.zaks',
				zak_spawner_callbacks
			),
		}, 'ONE'),
		behaviour_tree.action_node.new('world1_daemon.next_entrance', finish_cycle),
	})
	behaviour_tree_library.register(root)
end

return world1_daemon_tree
