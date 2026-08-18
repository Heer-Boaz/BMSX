local base_component<const> = require('cartlib/component/base_component')
local blackboard<const> = require('cartlib/behaviour_tree/blackboard')

local bt_component<const> = {}
bt_component.__index = bt_component
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
	-- A program replacement restarts task/service memory while the blackboard
	-- remaps retained values by semantic key. Runtime slot numbers belong only
	-- to the installed program and never become cart-visible state keys.
	self._execution_state = program.create_execution_state()
end

-- Aborting a tree clears compiler-owned execution paths and halts every
-- running stateful action in the displaced subtree.
function bt_component:abort()
	local reset<const> = self.reset
	if reset ~= nil then
		reset(self.parent, self, self._execution_state)
	end
	self._execution_request_pending = false
end

function bt_component:on_detach()
	self:abort()
end

return bt_component
