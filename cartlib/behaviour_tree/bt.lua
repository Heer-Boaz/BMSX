-- Behaviour-tree authoring nodes. The library compiles each immutable authored
-- tree into one shared evaluator program; per-object node state lives on the
-- component blackboard.

local contract<const> = require('cartlib/behaviour_tree/contract')

local behaviour_tree<const> = {}
local program_kind<const> = contract.node_kind

local bt_node<const> = {}
bt_node.__index = bt_node

function bt_node.new(id, priority)
	local self<const> = setmetatable({}, bt_node)
	self.id = id
	self.priority = priority or 0
	return self
end

local parametrized_bt_node<const> = {}
parametrized_bt_node.__index = parametrized_bt_node
setmetatable(parametrized_bt_node, { __index = bt_node })

function parametrized_bt_node.new(id, priority, parameters)
	local self<const> = setmetatable(bt_node.new(id, priority), parametrized_bt_node)
	self.parameters = parameters
	return self
end

local sequence_node<const> = {}
sequence_node.__index = sequence_node
sequence_node.program_kind = program_kind.sequence
setmetatable(sequence_node, { __index = bt_node })

function sequence_node.new(id, children, priority)
	local self<const> = setmetatable(bt_node.new(id, priority), sequence_node)
	self.children = children
	return self
end

local selector_node<const> = {}
selector_node.__index = selector_node
selector_node.program_kind = program_kind.selector
setmetatable(selector_node, { __index = bt_node })

function selector_node.new(id, children, priority)
	local self<const> = setmetatable(bt_node.new(id, priority), selector_node)
	self.children = children
	return self
end

local parallel_node<const> = {}
parallel_node.__index = parallel_node
parallel_node.program_kind = program_kind.parallel_all
setmetatable(parallel_node, { __index = bt_node })

local parallel_one_node<const> = {}
parallel_one_node.__index = parallel_one_node
parallel_one_node.program_kind = program_kind.parallel_one
setmetatable(parallel_one_node, { __index = bt_node })

local parallel_class_by_policy<const> = {
	['ALL'] = parallel_node,
	['ONE'] = parallel_one_node,
}

function parallel_node.new(id, children, success_policy, priority)
	local node_class<const> = parallel_class_by_policy[success_policy or 'ALL']
	local self<const> = setmetatable(bt_node.new(id, priority), node_class)
	self.children = children
	return self
end

local decorator_node<const> = {}
decorator_node.__index = decorator_node
decorator_node.program_kind = program_kind.decorator
setmetatable(decorator_node, { __index = bt_node })

function decorator_node.new(id, child, decorator_fn, priority)
	local self<const> = setmetatable(bt_node.new(id, priority), decorator_node)
	self.child = child
	self.decorator = decorator_fn
	return self
end

local condition_node<const> = {}
condition_node.__index = condition_node
condition_node.program_kind = program_kind.condition
setmetatable(condition_node, { __index = parametrized_bt_node })

local negated_condition_node<const> = {}
negated_condition_node.__index = negated_condition_node
negated_condition_node.program_kind = program_kind.negated_condition
setmetatable(negated_condition_node, { __index = parametrized_bt_node })

local condition_class_by_modifier<const> = {
	['NONE'] = condition_node,
	['NOT'] = negated_condition_node,
}

function condition_node.new(id, condition_fn, modifier, priority, parameters)
	local self<const> = setmetatable(
		parametrized_bt_node.new(id, priority, parameters),
		condition_class_by_modifier[modifier or 'NONE'])
	self.condition = condition_fn
	return self
end

local composite_condition_node<const> = {}
composite_condition_node.__index = composite_condition_node
composite_condition_node.program_kind = program_kind.composite_condition
setmetatable(composite_condition_node, { __index = parametrized_bt_node })

local composite_or_condition_node<const> = {}
composite_or_condition_node.__index = composite_or_condition_node
composite_or_condition_node.program_kind = program_kind.composite_or_condition
setmetatable(composite_or_condition_node, { __index = parametrized_bt_node })

local composite_condition_class_by_modifier<const> = {
	['AND'] = composite_condition_node,
	['OR'] = composite_or_condition_node,
}

function composite_condition_node.new(id, conditions, modifier, priority, parameters)
	local self<const> = setmetatable(
		parametrized_bt_node.new(id, priority, parameters),
		composite_condition_class_by_modifier[modifier or 'AND'])
	self.conditions = conditions
	return self
end

local random_selector_node<const> = {}
random_selector_node.__index = random_selector_node
random_selector_node.program_kind = program_kind.random_selector
setmetatable(random_selector_node, { __index = bt_node })

function random_selector_node.new(id, children, property_name, priority)
	local self<const> = setmetatable(bt_node.new(id, priority), random_selector_node)
	self.children = children
	self.current_child_property_name = property_name
	return self
end

local limit_node<const> = {}
limit_node.__index = limit_node
limit_node.program_kind = program_kind.limit
setmetatable(limit_node, { __index = bt_node })

function limit_node.new(id, limit_count, property_name, child, priority)
	local self<const> = setmetatable(bt_node.new(id, priority), limit_node)
	self.limit = limit_count
	self.count_property_name = property_name
	self.child = child
	return self
end

local priority_selector_node<const> = {}
priority_selector_node.__index = priority_selector_node
priority_selector_node.program_kind = program_kind.selector
setmetatable(priority_selector_node, { __index = bt_node })

local sort_by_priority_desc<const> = function(a, b)
	return a.priority > b.priority
end

function priority_selector_node.new(id, children, priority)
	local self<const> = setmetatable(bt_node.new(id, priority), priority_selector_node)
	self.children = children
	if #self.children > 1 then
		table.sort(self.children, sort_by_priority_desc)
	end
	return self
end

local wait_node<const> = {}
wait_node.__index = wait_node
wait_node.program_kind = program_kind.wait
setmetatable(wait_node, { __index = bt_node })

function wait_node.new(id, wait_time, property_name, priority)
	local self<const> = setmetatable(bt_node.new(id, priority), wait_node)
	self.wait_time = wait_time
	self.wait_property_name = property_name
	return self
end

local action_node<const> = {}
action_node.__index = action_node
action_node.program_kind = program_kind.action
setmetatable(action_node, { __index = parametrized_bt_node })

function action_node.new(id, action_fn, priority, parameters)
	local self<const> = setmetatable(parametrized_bt_node.new(id, priority, parameters), action_node)
	self.action = action_fn
	return self
end

local composite_action_node<const> = {}
composite_action_node.__index = composite_action_node
composite_action_node.program_kind = program_kind.composite_action
setmetatable(composite_action_node, { __index = parametrized_bt_node })

function composite_action_node.new(id, actions, priority, parameters)
	local self<const> = setmetatable(parametrized_bt_node.new(id, priority, parameters), composite_action_node)
	self.actions = actions
	return self
end

behaviour_tree.result = contract.result
behaviour_tree.bt_node = bt_node
behaviour_tree.sequence_node = sequence_node
behaviour_tree.selector_node = selector_node
behaviour_tree.parallel_node = parallel_node
behaviour_tree.decorator_node = decorator_node
behaviour_tree.condition_node = condition_node
behaviour_tree.composite_condition_node = composite_condition_node
behaviour_tree.random_selector_node = random_selector_node
behaviour_tree.limit_node = limit_node
behaviour_tree.priority_selector_node = priority_selector_node
behaviour_tree.wait_node = wait_node
behaviour_tree.action_node = action_node
behaviour_tree.composite_action_node = composite_action_node

return behaviour_tree
