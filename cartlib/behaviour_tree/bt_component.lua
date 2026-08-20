local base_component<const> = require('cartlib/component/base_component')
local blackboard<const> = require('cartlib/behaviour_tree/blackboard')
local clock<const> = require('cartlib/clock')

local bt_component<const> = {}
bt_component.__index = bt_component
bt_component._tick_clocks = clock.gameplay
setmetatable(bt_component, { __index = base_component })

local programs_by_id<const> = {}

function bt_component.install_program(program)
	programs_by_id[program.id] = program
end

function bt_component.new(opts, tree_id)
	local self<const> = setmetatable(base_component.new(opts), bt_component)
	local program<const> = programs_by_id[tree_id]
	self.tree_id = tree_id
	self:rebind_program(program)
	return self
end

function bt_component.factory(tree_id)
	return function(opts)
		return bt_component.new(opts, tree_id)
	end
end

function bt_component:rebind_program(program)
	self:abort()
	local blackboard_layout<const> = program.blackboard_layout
	if blackboard_layout == nil then
		self.blackboard = nil
	else
		local blackboard_instance = self.blackboard
		if blackboard_instance == nil then
			blackboard_instance = blackboard.new()
			self.blackboard = blackboard_instance
		end
		blackboard_instance:rebind(blackboard_layout, self)
	end
	self.evaluate = program.evaluate
	self.operand = program.operand
	self.reset = program.reset
	self._execution_request_pending = false
	self._execution_waiting = false
	-- A program replacement restarts task/service memory while the blackboard
	-- remaps retained values by semantic key. Runtime slot numbers belong only
	-- to the installed program and never become cart-visible state keys.
	self._execution_state, self._active_services = program.create_execution_state()
	self._active_service_count = 0
end

-- Aborting a tree clears compiler-owned execution paths and halts every
-- running stateful action in the displaced subtree.
function bt_component:abort()
	local reset<const> = self.reset
	if reset ~= nil then
		reset(self.parent, self, self._execution_state)
	end
	self._execution_request_pending = false
	self._execution_waiting = false
	if self.enabled then
		self:set_tick_clock_enabled(clock.gameplay, true)
	end
end

-- Blackboard observers schedule one coalesced flow update. A sleeping latent
-- tree is readmitted to its gameplay lane; the evaluator applies requests at
-- the next behaviour-tree boundary rather than mutating the active path here.
function bt_component:request_execution()
	self._execution_request_pending = true
	self:set_tick_clock_enabled(clock.gameplay, true)
end

-- Latent completion publishes directly into the compiler-owned task slot and
-- readmits execution. The producer callback is retained by the task program;
-- no event lookup, listener allocation or frame polling is involved.
function bt_component:finish_latent_task(status_slot, task_result)
	self._execution_state[status_slot] = task_result
	self._execution_waiting = false
	self:set_tick_clock_enabled(clock.gameplay, true)
end

-- A tree with only externally completed work leaves the gameplay lane. Active
-- Services keep their owner scheduled while the evaluator itself remains
-- dormant, matching the separate auxiliary/task scheduling used by UE.
function bt_component:_wait_for_latent_task()
	self._execution_waiting = true
	if self._active_service_count == 0 and not self._execution_request_pending then
		self:set_tick_clock_enabled(clock.gameplay, false)
	end
end

-- Tree lifecycle is distinct from generic component scheduling. Stopping
-- aborts active tasks and services before withdrawing future scheduler
-- admission; its blackboard remains available for the next start.
function bt_component:stop()
	self:abort()
	return base_component.set_enabled(self, false)
end

-- stop() leaves execution at the root, so starting only republishes the
-- component to the retained BT view.
function bt_component:start()
	self:set_tick_clock_enabled(clock.gameplay, true)
	return base_component.set_enabled(self, true)
end

function bt_component:on_detach()
	self:abort()
end

return bt_component
