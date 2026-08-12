-- Behaviour tree nodes. Root nodes are immutable definitions shared by every
-- component instance; per-object node state lives on the component blackboard.

local behaviourtree<const> = {}
local result_running<const> = 1
local result_success<const> = 2
local result_failure<const> = 3

local btnode<const> = {}
btnode.__index = btnode

function btnode.new(id, priority)
	local self<const> = setmetatable({}, btnode)
	self.id = id
	self.priority = priority or 0
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
	self.children = children
	return self
end

function sequencenode:tick(target, blackboard)
	for i = 1, #self.children do
		local status<const> = self.children[i]:tick(target, blackboard)
		if status ~= result_success then
			return status
		end
	end
	return result_success
end

local selectornode<const> = {}
selectornode.__index = selectornode
setmetatable(selectornode, { __index = btnode })

function selectornode.new(id, children, priority)
	local self<const> = setmetatable(btnode.new(id, priority), selectornode)
	self.children = children
	return self
end

function selectornode:tick(target, blackboard)
	for i = 1, #self.children do
		local status<const> = self.children[i]:tick(target, blackboard)
		if status ~= result_failure then
			return status
		end
	end
	return result_failure
end

local parallelnode<const> = {}
parallelnode.__index = parallelnode
setmetatable(parallelnode, { __index = btnode })

local parallelonenode<const> = {}
parallelonenode.__index = parallelonenode
setmetatable(parallelonenode, { __index = btnode })

local parallel_class_by_policy<const> = {
	['ALL'] = parallelnode,
	['ONE'] = parallelonenode,
}

function parallelnode.new(id, children, success_policy, priority)
	local node_class<const> = parallel_class_by_policy[success_policy or 'ALL']
	local self<const> = setmetatable(btnode.new(id, priority), node_class)
	self.children = children
	return self
end

function parallelnode:tick(target, blackboard)
	local any_running
	for i = 1, #self.children do
		local status<const> = self.children[i]:tick(target, blackboard)
		if status ~= result_success then
			if status == result_running then
				any_running = true
			else
				return status
			end
		end
	end
	return any_running and result_running or result_success
end

function parallelonenode:tick(target, blackboard)
	local any_running
	for i = 1, #self.children do
		local status<const> = self.children[i]:tick(target, blackboard)
		if status ~= result_failure then
			if status == result_running then
				any_running = true
			else
				return status
			end
		end
	end
	return any_running and result_running or result_failure
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

local negatedconditionnode<const> = {}
negatedconditionnode.__index = negatedconditionnode
setmetatable(negatedconditionnode, { __index = parametrizedbtnode })

local condition_class_by_modifier<const> = {
	['NONE'] = conditionnode,
	['NOT'] = negatedconditionnode,
}

function conditionnode.new(id, condition_fn, modifier, priority, parameters)
	local self<const> = setmetatable(
		parametrizedbtnode.new(id, priority, parameters),
		condition_class_by_modifier[modifier or 'NONE'])
	self.condition = condition_fn
	return self
end

function conditionnode:tick(target, blackboard)
	return self.condition(target, blackboard, self.parameters) and result_success or result_failure
end

function negatedconditionnode:tick(target, blackboard)
	return self.condition(target, blackboard, self.parameters) and result_failure or result_success
end

local compositeconditionnode<const> = {}
compositeconditionnode.__index = compositeconditionnode
setmetatable(compositeconditionnode, { __index = parametrizedbtnode })

local compositeorconditionnode<const> = {}
compositeorconditionnode.__index = compositeorconditionnode
setmetatable(compositeorconditionnode, { __index = parametrizedbtnode })

local composite_condition_class_by_modifier<const> = {
	['AND'] = compositeconditionnode,
	['OR'] = compositeorconditionnode,
}

function compositeconditionnode.new(id, conditions, modifier, priority, parameters)
	local self<const> = setmetatable(
		parametrizedbtnode.new(id, priority, parameters),
		composite_condition_class_by_modifier[modifier or 'AND'])
	self.conditions = conditions
	return self
end

function compositeconditionnode:tick(target, blackboard)
	for i = 1, #self.conditions do
		if not self.conditions[i](target, blackboard, self.parameters) then
			return result_failure
		end
	end
	return result_success
end

function compositeorconditionnode:tick(target, blackboard)
	for i = 1, #self.conditions do
		if self.conditions[i](target, blackboard, self.parameters) then
			return result_success
		end
	end
	return result_failure
end

local randomselectornode<const> = {}
randomselectornode.__index = randomselectornode
setmetatable(randomselectornode, { __index = btnode })

function randomselectornode.new(id, children, property_name, priority)
	local self<const> = setmetatable(btnode.new(id, priority), randomselectornode)
	self.children = children
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
	if status ~= result_running then
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
		if status ~= result_running then
			blackboard.node_data[self.count_property_name] = count + 1
		end
		return status
	end
	return result_failure
end

local priorityselectornode<const> = {}
priorityselectornode.__index = priorityselectornode
setmetatable(priorityselectornode, { __index = btnode })

local sort_by_priority_desc<const> = function(a, b)
	return a.priority > b.priority
end

function priorityselectornode.new(id, children, priority)
	local self<const> = setmetatable(btnode.new(id, priority), priorityselectornode)
	self.children = children
	if #self.children > 1 then
		table.sort(self.children, sort_by_priority_desc)
	end
	return self
end

function priorityselectornode:tick(target, blackboard)
	for i = 1, #self.children do
		local status<const> = self.children[i]:tick(target, blackboard)
		if status ~= result_failure then
			return status
		end
	end
	return result_failure
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
		return result_running
	end
	blackboard.node_data[self.wait_property_name] = nil
	return result_success
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
	self.actions = actions
	return self
end

function compositeactionnode:tick(target, blackboard)
	local outcome
	for i = 1, #self.actions do
		local status<const> = self.actions[i]:tick(target, blackboard)
		if status == result_failure then
			return status
		end
		if status == result_running then
			outcome = status
		end
	end
	return outcome or result_success
end

behaviourtree.result = {
	running = result_running,
	success = result_success,
	failure = result_failure,
}
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
