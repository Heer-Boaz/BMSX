local base_component<const> = require('cartlib/component/base_component')

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
	self.node_data = {}
	self:rebind_program(program)
	return self
end

function bt_component.factory(tree_id)
	return function(opts)
		return bt_component.new(opts, tree_id)
	end
end

function bt_component:rebind_program(program)
	self.evaluate = program.evaluate
	self.operand = program.operand
	-- A program replacement restarts evaluator-owned progress while retaining
	-- action-owned blackboard data. Runtime slot numbers belong only to the
	-- installed program and never become cart-visible state keys.
	if program.state_slot_count == 0 then
		self._execution_state = nil
	else
		self._execution_state = {}
	end
end

return bt_component
