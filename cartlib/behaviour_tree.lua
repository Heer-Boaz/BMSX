-- Behaviour tree nodes. Root nodes are immutable definitions shared by every
-- component instance; per-object node state lives on the component blackboard.

local behaviour_tree<const> = {}

local bt_node<const> = {}
bt_node.__index = bt_node

function bt_node.new(id, priority)
	local self<const> = setmetatable({}, bt_node)
	self.id = id
	self.priority = priority
	return self
end

function bt_node:tick(_target, _blackboard)
	error('behaviour tree node "' .. tostring(self.id) .. '" must implement tick().')
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
setmetatable(sequence_node, { __index = bt_node })

function sequence_node.new(id, children, priority)
	local self<const> = setmetatable(bt_node.new(id, priority), sequence_node)
	self.children = children or {}
	return self
end

function sequence_node:tick(target, blackboard)
	for i = 1, #self.children do
		local status<const> = self.children[i]:tick(target, blackboard)
		if status ~= 'SUCCESS' then
			return status
		end
	end
	return 'SUCCESS'
end

local selector_node<const> = {}
selector_node.__index = selector_node
setmetatable(selector_node, { __index = bt_node })

function selector_node.new(id, children, priority)
	local self<const> = setmetatable(bt_node.new(id, priority), selector_node)
	self.children = children or {}
	return self
end

function selector_node:tick(target, blackboard)
	for i = 1, #self.children do
		local status<const> = self.children[i]:tick(target, blackboard)
		if status ~= 'FAILURE' then
			return status
		end
	end
	return 'FAILURE'
end

local parallel_node<const> = {}
parallel_node.__index = parallel_node
setmetatable(parallel_node, { __index = bt_node })

function parallel_node.new(id, children, success_policy, priority)
	local self<const> = setmetatable(bt_node.new(id, priority), parallel_node)
	self.children = children or {}
	self.success_policy = success_policy or 'ALL'
	return self
end

function parallel_node:tick(target, blackboard)
	local any_running
	local success_count = 0
	for i = 1, #self.children do
		local status<const> = self.children[i]:tick(target, blackboard)
		if status == 'RUNNING' then
			any_running = true
		elseif status == 'SUCCESS' then
			success_count = success_count + 1
			if self.success_policy == 'ONE' then
				return 'SUCCESS'
			end
		elseif status == 'FAILURE' and self.success_policy == 'ALL' then
			return 'FAILURE'
		end
	end
	if self.success_policy == 'ALL' and success_count == #self.children then
		return 'SUCCESS'
	end
	return any_running and 'RUNNING' or 'FAILURE'
end

local decorator_node<const> = {}
decorator_node.__index = decorator_node
setmetatable(decorator_node, { __index = bt_node })

function decorator_node.new(id, child, decorator_fn, priority)
	local self<const> = setmetatable(bt_node.new(id, priority), decorator_node)
	self.child = child
	self.decorator = decorator_fn
	return self
end

function decorator_node:tick(target, blackboard)
	local status<const> = self.child:tick(target, blackboard)
	return self.decorator(target, blackboard, status)
end

local condition_node<const> = {}
condition_node.__index = condition_node
setmetatable(condition_node, { __index = parametrized_bt_node })

function condition_node.new(id, condition_fn, modifier, priority, parameters)
	local self<const> = setmetatable(parametrized_bt_node.new(id, priority, parameters), condition_node)
	self.condition = condition_fn
	self.modifier = modifier
	return self
end

function condition_node:tick(target, blackboard)
	local result = self.condition(target, blackboard, self.parameters)
	if self.modifier == 'NOT' then
		result = not result
	end
	return result and 'SUCCESS' or 'FAILURE'
end

local composite_condition_node<const> = {}
composite_condition_node.__index = composite_condition_node
setmetatable(composite_condition_node, { __index = parametrized_bt_node })

function composite_condition_node.new(id, conditions, modifier, priority, parameters)
	local self<const> = setmetatable(parametrized_bt_node.new(id, priority, parameters), composite_condition_node)
	self.conditions = conditions or {}
	self.modifier = modifier or 'AND'
	return self
end

function composite_condition_node:tick(target, blackboard)
	local combined = (self.modifier == 'AND')
	for i = 1, #self.conditions do
		local result<const> = self.conditions[i](target, blackboard, self.parameters)
		if self.modifier == 'AND' then
			combined = combined and result
		else
			combined = combined or result
		end
	end
	return combined and 'SUCCESS' or 'FAILURE'
end

local random_selector_node<const> = {}
random_selector_node.__index = random_selector_node
setmetatable(random_selector_node, { __index = bt_node })

function random_selector_node.new(id, children, property_name, priority)
	local self<const> = setmetatable(bt_node.new(id, priority), random_selector_node)
	self.children = children or {}
	self.current_child_property_name = property_name
	return self
end

function random_selector_node:tick(target, blackboard)
	local idx = blackboard.node_data[self.current_child_property_name]
	if idx == nil then
		idx = math.random(1, #self.children)
		blackboard.node_data[self.current_child_property_name] = idx
	end
	local status<const> = self.children[idx]:tick(target, blackboard)
	if status ~= 'RUNNING' then
		blackboard.node_data[self.current_child_property_name] = nil
	end
	return status
end

local limit_node<const> = {}
limit_node.__index = limit_node
setmetatable(limit_node, { __index = bt_node })

function limit_node.new(id, limit_count, property_name, child, priority)
	local self<const> = setmetatable(bt_node.new(id, priority), limit_node)
	self.limit = limit_count
	self.count_property_name = property_name
	self.child = child
	return self
end

function limit_node:tick(target, blackboard)
	local count<const> = blackboard.node_data[self.count_property_name] or 0
	if count < self.limit then
		local status<const> = self.child:tick(target, blackboard)
		if status ~= 'RUNNING' then
			blackboard.node_data[self.count_property_name] = count + 1
		end
		return status
	end
	return 'FAILURE'
end

local priority_selector_node<const> = {}
priority_selector_node.__index = priority_selector_node
setmetatable(priority_selector_node, { __index = bt_node })

local sort_by_priority_desc<const> = function(a, b)
	return (a.priority or 0) > (b.priority or 0)
end

function priority_selector_node.new(id, children, priority)
	local self<const> = setmetatable(bt_node.new(id, priority), priority_selector_node)
	self.children = children or {}
	if #self.children > 1 then
		table.sort(self.children, sort_by_priority_desc)
	end
	return self
end

function priority_selector_node:tick(target, blackboard)
	for i = 1, #self.children do
		local status<const> = self.children[i]:tick(target, blackboard)
		if status ~= 'FAILURE' then
			return status
		end
	end
	return 'FAILURE'
end

local wait_node<const> = {}
wait_node.__index = wait_node
setmetatable(wait_node, { __index = bt_node })

function wait_node.new(id, wait_time, property_name, priority)
	local self<const> = setmetatable(bt_node.new(id, priority), wait_node)
	self.wait_time = wait_time
	self.wait_property_name = property_name
	return self
end

function wait_node:tick(_target, blackboard)
	local elapsed<const> = blackboard.node_data[self.wait_property_name] or 0
	if elapsed < self.wait_time then
		blackboard.node_data[self.wait_property_name] = elapsed + 1
		return 'RUNNING'
	end
	blackboard.node_data[self.wait_property_name] = nil
	return 'SUCCESS'
end

local action_node<const> = {}
action_node.__index = action_node
setmetatable(action_node, { __index = parametrized_bt_node })

function action_node.new(id, action_fn, priority, parameters)
	local self<const> = setmetatable(parametrized_bt_node.new(id, priority, parameters), action_node)
	self.action = action_fn
	return self
end

function action_node:tick(target, blackboard)
	return self.action(target, blackboard, self.parameters)
end

local composite_action_node<const> = {}
composite_action_node.__index = composite_action_node
setmetatable(composite_action_node, { __index = parametrized_bt_node })

function composite_action_node.new(id, actions, priority, parameters)
	local self<const> = setmetatable(parametrized_bt_node.new(id, priority, parameters), composite_action_node)
	self.actions = actions or {}
	return self
end

function composite_action_node:tick(target, blackboard)
	local outcome
	for i = 1, #self.actions do
		local status<const> = self.actions[i]:tick(target, blackboard)
		if status == 'FAILURE' then
			return status
		end
		if status == 'RUNNING' then
			outcome = status
		end
	end
	return outcome or 'SUCCESS'
end

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
