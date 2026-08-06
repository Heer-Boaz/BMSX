-- Behaviour tree nodes. Root nodes are immutable definitions shared by every
-- component instance; per-object node state lives on the component blackboard.

local behaviourtree<const> = {}

local btnode<const> = {}
btnode.__index = btnode

function btnode.new(id, priority)
	local self<const> = setmetatable({}, btnode)
	self.id = id
	self.priority = priority
	return self
end

function btnode:tick(_target, _blackboard)
	error('behaviour tree node "' .. tostring(self.id) .. '" must implement tick().')
end

local parametrizedbtnode<const> = {}
parametrizedbtnode.__index = parametrizedbtnode
setmetatable(parametrizedbtnode, { __index = btnode })

function parametrizedbtnode.new(id, priority, parameters)
	local self<const> = setmetatable(btnode.new(id, priority), parametrizedbtnode)
	self.parameters = parameters
	return self
end

local sequencenode<const> = {}
sequencenode.__index = sequencenode
setmetatable(sequencenode, { __index = btnode })

function sequencenode.new(id, children, priority)
	local self<const> = setmetatable(btnode.new(id, priority), sequencenode)
	self.children = children or {}
	return self
end

function sequencenode:tick(target, blackboard)
	for i = 1, #self.children do
		local status<const> = self.children[i]:tick(target, blackboard)
		if status ~= 'SUCCESS' then
			return status
		end
	end
	return 'SUCCESS'
end

local selectornode<const> = {}
selectornode.__index = selectornode
setmetatable(selectornode, { __index = btnode })

function selectornode.new(id, children, priority)
	local self<const> = setmetatable(btnode.new(id, priority), selectornode)
	self.children = children or {}
	return self
end

function selectornode:tick(target, blackboard)
	for i = 1, #self.children do
		local status<const> = self.children[i]:tick(target, blackboard)
		if status ~= 'FAILURE' then
			return status
		end
	end
	return 'FAILURE'
end

local parallelnode<const> = {}
parallelnode.__index = parallelnode
setmetatable(parallelnode, { __index = btnode })

function parallelnode.new(id, children, success_policy, priority)
	local self<const> = setmetatable(btnode.new(id, priority), parallelnode)
	self.children = children or {}
	self.success_policy = success_policy or 'ALL'
	return self
end

function parallelnode:tick(target, blackboard)
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

local decoratornode<const> = {}
decoratornode.__index = decoratornode
setmetatable(decoratornode, { __index = btnode })

function decoratornode.new(id, child, decorator_fn, priority)
	local self<const> = setmetatable(btnode.new(id, priority), decoratornode)
	self.child = child
	self.decorator = decorator_fn
	return self
end

function decoratornode:tick(target, blackboard)
	local status<const> = self.child:tick(target, blackboard)
	return self.decorator(target, blackboard, status)
end

local conditionnode<const> = {}
conditionnode.__index = conditionnode
setmetatable(conditionnode, { __index = parametrizedbtnode })

function conditionnode.new(id, condition_fn, modifier, priority, parameters)
	local self<const> = setmetatable(parametrizedbtnode.new(id, priority, parameters), conditionnode)
	self.condition = condition_fn
	self.modifier = modifier
	return self
end

function conditionnode:tick(target, blackboard)
	local result = self.condition(target, blackboard, self.parameters)
	if self.modifier == 'NOT' then
		result = not result
	end
	return result and 'SUCCESS' or 'FAILURE'
end

local compositeconditionnode<const> = {}
compositeconditionnode.__index = compositeconditionnode
setmetatable(compositeconditionnode, { __index = parametrizedbtnode })

function compositeconditionnode.new(id, conditions, modifier, priority, parameters)
	local self<const> = setmetatable(parametrizedbtnode.new(id, priority, parameters), compositeconditionnode)
	self.conditions = conditions or {}
	self.modifier = modifier or 'AND'
	return self
end

function compositeconditionnode:tick(target, blackboard)
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

local randomselectornode<const> = {}
randomselectornode.__index = randomselectornode
setmetatable(randomselectornode, { __index = btnode })

function randomselectornode.new(id, children, property_name, priority)
	local self<const> = setmetatable(btnode.new(id, priority), randomselectornode)
	self.children = children or {}
	self.current_child_property_name = property_name
	return self
end

function randomselectornode:tick(target, blackboard)
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

local limitnode<const> = {}
limitnode.__index = limitnode
setmetatable(limitnode, { __index = btnode })

function limitnode.new(id, limit_count, property_name, child, priority)
	local self<const> = setmetatable(btnode.new(id, priority), limitnode)
	self.limit = limit_count
	self.count_property_name = property_name
	self.child = child
	return self
end

function limitnode:tick(target, blackboard)
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

local priorityselectornode<const> = {}
priorityselectornode.__index = priorityselectornode
setmetatable(priorityselectornode, { __index = btnode })

local sort_by_priority_desc<const> = function(a, b)
	return (a.priority or 0) > (b.priority or 0)
end

function priorityselectornode.new(id, children, priority)
	local self<const> = setmetatable(btnode.new(id, priority), priorityselectornode)
	self.children = children or {}
	if #self.children > 1 then
		table.sort(self.children, sort_by_priority_desc)
	end
	return self
end

function priorityselectornode:tick(target, blackboard)
	for i = 1, #self.children do
		local status<const> = self.children[i]:tick(target, blackboard)
		if status ~= 'FAILURE' then
			return status
		end
	end
	return 'FAILURE'
end

local waitnode<const> = {}
waitnode.__index = waitnode
setmetatable(waitnode, { __index = btnode })

function waitnode.new(id, wait_time, property_name, priority)
	local self<const> = setmetatable(btnode.new(id, priority), waitnode)
	self.wait_time = wait_time
	self.wait_property_name = property_name
	return self
end

function waitnode:tick(_target, blackboard)
	local elapsed<const> = blackboard.node_data[self.wait_property_name] or 0
	if elapsed < self.wait_time then
		blackboard.node_data[self.wait_property_name] = elapsed + 1
		return 'RUNNING'
	end
	blackboard.node_data[self.wait_property_name] = nil
	return 'SUCCESS'
end

local actionnode<const> = {}
actionnode.__index = actionnode
setmetatable(actionnode, { __index = parametrizedbtnode })

function actionnode.new(id, action_fn, priority, parameters)
	local self<const> = setmetatable(parametrizedbtnode.new(id, priority, parameters), actionnode)
	self.action = action_fn
	return self
end

function actionnode:tick(target, blackboard)
	return self.action(target, blackboard, self.parameters)
end

local compositeactionnode<const> = {}
compositeactionnode.__index = compositeactionnode
setmetatable(compositeactionnode, { __index = parametrizedbtnode })

function compositeactionnode.new(id, actions, priority, parameters)
	local self<const> = setmetatable(parametrizedbtnode.new(id, priority, parameters), compositeactionnode)
	self.actions = actions or {}
	return self
end

function compositeactionnode:tick(target, blackboard)
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

behaviourtree.bt_node = btnode
behaviourtree.sequence_node = sequencenode
behaviourtree.selector_node = selectornode
behaviourtree.parallel_node = parallelnode
behaviourtree.decorator_node = decoratornode
behaviourtree.condition_node = conditionnode
behaviourtree.composite_condition_node = compositeconditionnode
behaviourtree.random_selector_node = randomselectornode
behaviourtree.limit_node = limitnode
behaviourtree.priority_selector_node = priorityselectornode
behaviourtree.wait_node = waitnode
behaviourtree.action_node = actionnode
behaviourtree.composite_action_node = compositeactionnode

return behaviourtree
