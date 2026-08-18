local bt_result<const> = require('cartlib/behaviour_tree/result')
local world1_daemon_module<const> = require('boss/world1_daemon')
require('constants')

-- Boss-specific task-node implementations are separate from the tree asset.
-- The records below are immutable node templates shared by every daemon; all
-- mutable task state remains in the component-owned node-memory records.
local world1_daemon_nodes<const> = {}
local world1_daemon<const> = world1_daemon_module.world1_daemon
local bt_running<const> = bt_result.running
local bt_success<const> = bt_result.success

local advance_walk_cadence<const> = function(node_memory)
	local ticks<const> = node_memory.ticks + 1
	if ticks < boss_world1_walk_step_ticks then
		node_memory.ticks = ticks
		return false
	end
	node_memory.ticks = 0
	return true
end

local walk_execute<const> = function(target, node_memory)
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

-- ExecuteTask owns activation-time initialization of its per-agent memory.
-- The first sample is consumed here so the authored spawn window includes
-- the activation tick instead of acquiring an extra scheduler tick.
local spawn_attack_execute<const> = function(target, node_memory)
	node_memory.elapsed_ticks = 0
	node_memory.cadence = 0
	node_memory.burst_count = 0
	return spawn_attack_tick(target, node_memory)
end

world1_daemon_nodes.move_in = {
	type = 'task',
	node_memory = true,
	execute = walk_execute,
	tick = move_in_tick,
}

world1_daemon_nodes.move_out_forward = {
	type = 'task',
	node_memory = true,
	execute = walk_execute,
	tick = move_out_tick,
	parameters = false,
}

world1_daemon_nodes.move_out_backward = {
	type = 'task',
	node_memory = true,
	execute = walk_execute,
	tick = move_out_tick,
	parameters = true,
}

world1_daemon_nodes.spawn_attack = {
	type = 'task',
	node_memory = true,
	execute = spawn_attack_execute,
	tick = spawn_attack_tick,
}

-- These task methods already implement the behaviour-tree result contract;
-- retaining another cart-local adapter would add one Lua call to every pounce
-- update for no semantic ownership.
world1_daemon_nodes.pounce = {
	type = 'task',
	execute = world1_daemon.execute_pounce,
	tick = world1_daemon.tick_pounce,
}

world1_daemon_nodes.choose_entrance = {
	type = 'task',
	execute = world1_daemon.choose_entrance,
}

world1_daemon_nodes.spawn_zak_service = {
	interval_ticks = boss_world1_zak_cadence_units
		/ boss_world1_spawn_cadence_units_per_tick,
	on_tick = world1_daemon.spawn_zak,
}

return world1_daemon_nodes
