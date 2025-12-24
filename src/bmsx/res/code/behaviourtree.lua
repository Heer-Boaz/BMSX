-- behaviourtree.lua
-- Behaviour tree runtime + definition registry

local BehaviourTree = {}
BehaviourTree.SUCCESS = "SUCCESS"
BehaviourTree.FAILURE = "FAILED"
BehaviourTree.RUNNING = "RUNNING"
BehaviourTree.success = BehaviourTree.SUCCESS
BehaviourTree.failure = BehaviourTree.FAILURE
BehaviourTree.running = BehaviourTree.RUNNING

local function normalize_status(result)
	if type(result) == "table" and result.status then
		return result.status
	end
	return result
end

local Blackboard = {}
Blackboard.__index = Blackboard

function Blackboard.new(opts)
	local self = setmetatable({}, Blackboard)
	self.id = opts.id
	self.data = {}
	self.nodedata = {}
	self.execution_path = {}
	return self
end

function Blackboard:set(key, value)
	self.data[key] = value
end

function Blackboard:get(key)
	return self.data[key]
end

function Blackboard:clear_node_data()
	self.nodedata = {}
end

function Blackboard:apply_updates(updates)
	for _, properties in pairs(updates) do
		for _, entry in ipairs(properties) do
			local key = entry.key or entry.property
			self.data[key] = entry.value
		end
	end
end

function Blackboard:copy_properties(target, properties)
	for i = 1, #properties do
		local entry = properties[i]
		local key = entry.key or entry.property
		self.data[key] = target[entry.property]
	end
end

function Blackboard:get_action_in_progress()
	return self.nodedata.actionInProgress == true
end

function Blackboard:set_action_in_progress(v)
	self.nodedata.actionInProgress = v == true
end

local BTNode = {}
BTNode.__index = BTNode

function BTNode.new(id, priority)
	local self = setmetatable({}, BTNode)
	self.id = id or "node"
	self.priority = priority or 0
	self.enabled = true
	return self
end

function BTNode:tick(_target, _blackboard)
	return BehaviourTree.SUCCESS
end

function BTNode:debug_tick(target, blackboard)
	local status = self:tick(target, blackboard)
	blackboard.execution_path[#blackboard.execution_path + 1] = { node = self, status = status }
	return status
end

local ParametrizedNode = {}
ParametrizedNode.__index = ParametrizedNode
setmetatable(ParametrizedNode, { __index = BTNode })

function ParametrizedNode.new(id, priority, parameters)
	local self = setmetatable(BTNode.new(id, priority), ParametrizedNode)
	self.parameters = parameters or {}
	return self
end

local Sequence = {}
Sequence.__index = Sequence
setmetatable(Sequence, { __index = BTNode })

function Sequence.new(id, children, priority)
	local self = setmetatable(BTNode.new(id, priority), Sequence)
	self.children = children or {}
	return self
end

function Sequence:tick(target, blackboard)
	for i = 1, #self.children do
		local status = normalize_status(self.children[i]:tick(target, blackboard))
		if status ~= BehaviourTree.SUCCESS then
			return status
		end
	end
	return BehaviourTree.SUCCESS
end

local Selector = {}
Selector.__index = Selector
setmetatable(Selector, { __index = BTNode })

function Selector.new(id, children, priority)
	local self = setmetatable(BTNode.new(id, priority), Selector)
	self.children = children or {}
	return self
end

function Selector:tick(target, blackboard)
	for i = 1, #self.children do
		local status = normalize_status(self.children[i]:tick(target, blackboard))
		if status ~= BehaviourTree.FAILURE then
			return status
		end
	end
	return BehaviourTree.FAILURE
end

local Parallel = {}
Parallel.__index = Parallel
setmetatable(Parallel, { __index = BTNode })

function Parallel.new(id, children, success_policy, priority)
	local self = setmetatable(BTNode.new(id, priority), Parallel)
	self.children = children or {}
	self.success_policy = success_policy or "ALL"
	return self
end

function Parallel:tick(target, blackboard)
	local any_running = false
	local success_count = 0
	for i = 1, #self.children do
		local status = normalize_status(self.children[i]:tick(target, blackboard))
		if status == BehaviourTree.RUNNING then
			any_running = true
		elseif status == BehaviourTree.SUCCESS then
			success_count = success_count + 1
			if self.success_policy == "ONE" then
				return BehaviourTree.SUCCESS
			end
		elseif status == BehaviourTree.FAILURE and self.success_policy == "ALL" then
			return BehaviourTree.FAILURE
		end
	end
	if self.success_policy == "ALL" and success_count == #self.children then
		return BehaviourTree.SUCCESS
	end
	return any_running and BehaviourTree.RUNNING or BehaviourTree.FAILURE
end

local Decorator = {}
Decorator.__index = Decorator
setmetatable(Decorator, { __index = BTNode })

function Decorator.new(id, child, decorator, priority)
	local self = setmetatable(BTNode.new(id, priority), Decorator)
	self.child = child
	self.decorator = decorator
	return self
end

function Decorator:tick(target, blackboard)
	local status = normalize_status(self.child:tick(target, blackboard))
	return self.decorator(target, blackboard, status)
end

local Condition = {}
Condition.__index = Condition
setmetatable(Condition, { __index = ParametrizedNode })

function Condition.new(id, condition, modifier, priority, parameters)
	local self = setmetatable(ParametrizedNode.new(id, priority, parameters), Condition)
	self.condition = condition
	self.modifier = modifier
	return self
end

function Condition:tick(target, blackboard)
	local result = self.condition(target, blackboard, table.unpack(self.parameters))
	if self.modifier == "NOT" then
		result = not result
	end
	return result and BehaviourTree.SUCCESS or BehaviourTree.FAILURE
end

local CompositeCondition = {}
CompositeCondition.__index = CompositeCondition
setmetatable(CompositeCondition, { __index = ParametrizedNode })

function CompositeCondition.new(id, conditions, modifier, priority, parameters)
	local self = setmetatable(ParametrizedNode.new(id, priority, parameters), CompositeCondition)
	self.conditions = conditions or {}
	self.modifier = modifier or "AND"
	return self
end

function CompositeCondition:tick(target, blackboard)
	local combined = (self.modifier == "AND")
	for i = 1, #self.conditions do
		local result = self.conditions[i](target, blackboard, table.unpack(self.parameters))
		if self.modifier == "AND" then
			combined = combined and result
		else
			combined = combined or result
		end
	end
	return combined and BehaviourTree.SUCCESS or BehaviourTree.FAILURE
end

local RandomSelector = {}
RandomSelector.__index = RandomSelector
setmetatable(RandomSelector, { __index = BTNode })

function RandomSelector.new(id, children, propname, priority)
	local self = setmetatable(BTNode.new(id, priority), RandomSelector)
	self.children = children or {}
	self.currentchild_propname = propname
	return self
end

function RandomSelector:tick(target, blackboard)
	local idx = blackboard.nodedata[self.currentchild_propname]
	if idx == nil then
		idx = math.random(1, #self.children)
		blackboard.nodedata[self.currentchild_propname] = idx
	end
	local status = normalize_status(self.children[idx]:tick(target, blackboard))
	if status ~= BehaviourTree.RUNNING then
		blackboard.nodedata[self.currentchild_propname] = nil
	end
	return status
end

local Limit = {}
Limit.__index = Limit
setmetatable(Limit, { __index = BTNode })

function Limit.new(id, limit, propname, child, priority)
	local self = setmetatable(BTNode.new(id, priority), Limit)
	self.limit = limit
	self.count_propname = propname
	self.child = child
	return self
end

function Limit:tick(target, blackboard)
	local count = blackboard.nodedata[self.count_propname] or 0
	if count < self.limit then
		local status = normalize_status(self.child:tick(target, blackboard))
		if status ~= BehaviourTree.RUNNING then
			blackboard.nodedata[self.count_propname] = count + 1
		end
		return status
	end
	return BehaviourTree.FAILURE
end

local PrioritySelector = {}
PrioritySelector.__index = PrioritySelector
setmetatable(PrioritySelector, { __index = BTNode })

function PrioritySelector.new(id, children, priority)
	local self = setmetatable(BTNode.new(id, priority), PrioritySelector)
	self.children = children or {}
	return self
end

function PrioritySelector:tick(target, blackboard)
	table.sort(self.children, function(a, b)
		return (a.priority or 0) > (b.priority or 0)
	end)
	for i = 1, #self.children do
		local status = normalize_status(self.children[i]:tick(target, blackboard))
		if status ~= BehaviourTree.FAILURE then
			return status
		end
	end
	return BehaviourTree.FAILURE
end

local Wait = {}
Wait.__index = Wait
setmetatable(Wait, { __index = BTNode })

function Wait.new(id, wait_time, propname, priority)
	local self = setmetatable(BTNode.new(id, priority), Wait)
	self.wait_time = wait_time
	self.wait_propname = propname
	return self
end

function Wait:tick(_target, blackboard)
	local elapsed = blackboard.nodedata[self.wait_propname] or 0
	if elapsed < self.wait_time then
		blackboard.nodedata[self.wait_propname] = elapsed + 1
		return BehaviourTree.RUNNING
	end
	blackboard.nodedata[self.wait_propname] = nil
	return BehaviourTree.SUCCESS
end

local Action = {}
Action.__index = Action
setmetatable(Action, { __index = ParametrizedNode })

function Action.new(id, action, priority, parameters)
	local self = setmetatable(ParametrizedNode.new(id, priority, parameters), Action)
	self.action = action
	return self
end

function Action:tick(target, blackboard)
	return self.action(target, blackboard, table.unpack(self.parameters))
end

local CompositeAction = {}
CompositeAction.__index = CompositeAction
setmetatable(CompositeAction, { __index = ParametrizedNode })

function CompositeAction.new(id, actions, priority, parameters)
	local self = setmetatable(ParametrizedNode.new(id, priority, parameters), CompositeAction)
	self.actions = actions or {}
	return self
end

function CompositeAction:tick(target, blackboard)
	local outcome = BehaviourTree.SUCCESS
	for i = 1, #self.actions do
		local status = normalize_status(self.actions[i]:tick(target, blackboard))
		if status == BehaviourTree.FAILURE then
			return status
		end
		if status == BehaviourTree.RUNNING then
			outcome = status
		end
	end
	return outcome
end

local BehaviourTreeDefinitions = {}

local function build_node(spec, id)
	local node_type = spec.type or spec.kind or spec.node
	if node_type == "selector" or node_type == "Selector" then
		local children = {}
		for i = 1, #spec.children do
			children[i] = build_node(spec.children[i], id)
		end
		return Selector.new(id, children, spec.priority)
	end
	if node_type == "sequence" or node_type == "Sequence" then
		local children = {}
		for i = 1, #spec.children do
			children[i] = build_node(spec.children[i], id)
		end
		return Sequence.new(id, children, spec.priority)
	end
	if node_type == "parallel" or node_type == "Parallel" then
		local children = {}
		for i = 1, #spec.children do
			children[i] = build_node(spec.children[i], id)
		end
		return Parallel.new(id, children, spec.successPolicy, spec.priority)
	end
	if node_type == "decorator" or node_type == "Decorator" then
		local child = build_node(spec.child, id)
		return Decorator.new(id, child, spec.decorator, spec.priority)
	end
	if node_type == "condition" or node_type == "Condition" then
		return Condition.new(id, spec.condition, spec.modifier, spec.priority, spec.parameters)
	end
	if node_type == "compositecondition" or node_type == "CompositeCondition" then
		return CompositeCondition.new(id, spec.conditions, spec.modifier, spec.priority, spec.parameters)
	end
	if node_type == "randomselector" or node_type == "RandomSelector" then
		local children = {}
		for i = 1, #spec.children do
			children[i] = build_node(spec.children[i], id)
		end
		return RandomSelector.new(id, children, spec.currentchild_propname, spec.priority)
	end
	if node_type == "limit" or node_type == "Limit" then
		local child = build_node(spec.child, id)
		return Limit.new(id, spec.limit, spec.count_propname, child, spec.priority)
	end
	if node_type == "priorityselector" or node_type == "PrioritySelector" then
		local children = {}
		for i = 1, #spec.children do
			children[i] = build_node(spec.children[i], id)
		end
		return PrioritySelector.new(id, children, spec.priority)
	end
	if node_type == "wait" or node_type == "Wait" then
		return Wait.new(id, spec.wait_time, spec.wait_propname, spec.priority)
	end
	if node_type == "action" or node_type == "Action" then
		return Action.new(id, spec.action, spec.priority, spec.parameters)
	end
	if node_type == "compositeaction" or node_type == "CompositeAction" then
		local actions = {}
		for i = 1, #spec.actions do
			actions[i] = build_node(spec.actions[i], id)
		end
		return CompositeAction.new(id, actions, spec.priority, spec.parameters)
	end
	return BTNode.new(id)
end

function BehaviourTree.register_definition(id, definition)
	BehaviourTreeDefinitions[id] = definition
end

function BehaviourTree.instantiate(id)
	local def = BehaviourTreeDefinitions[id]
	local root = def.root or def
	return build_node(root, id)
end

BehaviourTree.Blackboard = Blackboard
BehaviourTree.BTNode = BTNode
BehaviourTree.Sequence = Sequence
BehaviourTree.Selector = Selector
BehaviourTree.Parallel = Parallel
BehaviourTree.Decorator = Decorator
BehaviourTree.Condition = Condition
BehaviourTree.CompositeCondition = CompositeCondition
BehaviourTree.RandomSelector = RandomSelector
BehaviourTree.Limit = Limit
BehaviourTree.PrioritySelector = PrioritySelector
BehaviourTree.Wait = Wait
BehaviourTree.Action = Action
BehaviourTree.CompositeAction = CompositeAction
BehaviourTree.Definitions = BehaviourTreeDefinitions

return BehaviourTree
