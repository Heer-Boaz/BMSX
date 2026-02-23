-- behaviourtree.lua
-- behaviour tree runtime + definition registry

local behaviourtree = {}
behaviourtree.success = "success"
behaviourtree.failure = "failed"
behaviourtree.running = "running"

local blackboard = {}
blackboard.__index = blackboard

function blackboard.new(opts)
	local self = setmetatable({}, blackboard)
	self.id = opts.id
	self.nodedata = {}
	return self
end

function blackboard:clear_node_data()
	self.nodedata = {}
end

local btnode = {}
btnode.__index = btnode

function btnode.new(id, priority)
	local self = setmetatable({}, btnode)
	self.id = id or "node"
	self.priority = priority or 0
	return self
end

function btnode:tick(_target, _blackboard)
	error("behaviour tree node '" .. tostring(self.id) .. "' must implement tick().")
end

local parametrizednode = {}
parametrizednode.__index = parametrizednode
setmetatable(parametrizednode, { __index = btnode })

function parametrizednode.new(id, priority, parameters)
	local self = setmetatable(btnode.new(id, priority), parametrizednode)
	self.parameters = parameters
	return self
end

local sequence = {}
sequence.__index = sequence
setmetatable(sequence, { __index = btnode })

function sequence.new(id, children, priority)
	local self = setmetatable(btnode.new(id, priority), sequence)
	self.children = children or {}
	return self
end

function sequence:tick(target, blackboard)
	for i = 1, #self.children do
		local status = self.children[i]:tick(target, blackboard)
		if status ~= behaviourtree.success then
			return status
		end
	end
	return behaviourtree.success
end

local selector = {}
selector.__index = selector
setmetatable(selector, { __index = btnode })

function selector.new(id, children, priority)
	local self = setmetatable(btnode.new(id, priority), selector)
	self.children = children or {}
	return self
end

function selector:tick(target, blackboard)
	for i = 1, #self.children do
		local status = self.children[i]:tick(target, blackboard)
		if status ~= behaviourtree.failure then
			return status
		end
	end
	return behaviourtree.failure
end

local parallel = {}
parallel.__index = parallel
setmetatable(parallel, { __index = btnode })

function parallel.new(id, children, success_policy, priority)
	local self = setmetatable(btnode.new(id, priority), parallel)
	self.children = children or {}
	self.success_policy = success_policy or "all"
	return self
end

function parallel:tick(target, blackboard)
	local any_running
	local success_count = 0
	for i = 1, #self.children do
		local status = self.children[i]:tick(target, blackboard)
		if status == behaviourtree.running then
			any_running = true
		elseif status == behaviourtree.success then
			success_count = success_count + 1
			if self.success_policy == "one" then
				return behaviourtree.success
			end
		elseif status == behaviourtree.failure and self.success_policy == "all" then
			return behaviourtree.failure
		end
	end
	if self.success_policy == "all" and success_count == #self.children then
		return behaviourtree.success
	end
	return any_running and behaviourtree.running or behaviourtree.failure
end

local decorator = {}
decorator.__index = decorator
setmetatable(decorator, { __index = btnode })

function decorator.new(id, child, decorator_fn, priority)
	local self = setmetatable(btnode.new(id, priority), decorator)
	self.child = child
	self.decorator = decorator_fn
	return self
end

function decorator:tick(target, blackboard)
	local status = self.child:tick(target, blackboard)
	return self.decorator(target, blackboard, status)
end

local condition = {}
condition.__index = condition
setmetatable(condition, { __index = parametrizednode })

function condition.new(id, condition_fn, modifier, priority, parameters)
	local self = setmetatable(parametrizednode.new(id, priority, parameters), condition)
	self.condition = condition_fn
	self.modifier = modifier
	return self
end

function condition:tick(target, blackboard)
	local result = self.condition(target, blackboard, self.parameters)
	if self.modifier == "not" then
		result = not result
	end
	return result and behaviourtree.success or behaviourtree.failure
end

local compositecondition = {}
compositecondition.__index = compositecondition
setmetatable(compositecondition, { __index = parametrizednode })

function compositecondition.new(id, conditions, modifier, priority, parameters)
	local self = setmetatable(parametrizednode.new(id, priority, parameters), compositecondition)
	self.conditions = conditions or {}
	self.modifier = modifier or "and"
	return self
end

function compositecondition:tick(target, blackboard)
	local combined = (self.modifier == "and")
	for i = 1, #self.conditions do
		local result = self.conditions[i](target, blackboard, self.parameters)
		if self.modifier == "and" then
			combined = combined and result
		else
			combined = combined or result
		end
	end
	return combined and behaviourtree.success or behaviourtree.failure
end

local randomselector = {}
randomselector.__index = randomselector
setmetatable(randomselector, { __index = btnode })

function randomselector.new(id, children, propname, priority)
	local self = setmetatable(btnode.new(id, priority), randomselector)
	self.children = children or {}
	self.currentchild_propname = propname
	return self
end

function randomselector:tick(target, blackboard)
	local idx = blackboard.nodedata[self.currentchild_propname]
	if idx == nil then
		idx = math.random(1, #self.children)
		blackboard.nodedata[self.currentchild_propname] = idx
	end
	local status = self.children[idx]:tick(target, blackboard)
	if status ~= behaviourtree.running then
		blackboard.nodedata[self.currentchild_propname] = nil
	end
	return status
end

local limit = {}
limit.__index = limit
setmetatable(limit, { __index = btnode })

function limit.new(id, limit_count, propname, child, priority)
	local self = setmetatable(btnode.new(id, priority), limit)
	self.limit = limit_count
	self.count_propname = propname
	self.child = child
	return self
end

function limit:tick(target, blackboard)
	local count = blackboard.nodedata[self.count_propname] or 0
	if count < self.limit then
		local status = self.child:tick(target, blackboard)
		if status ~= behaviourtree.running then
			blackboard.nodedata[self.count_propname] = count + 1
		end
		return status
	end
	return behaviourtree.failure
end

local priorityselector = {}
priorityselector.__index = priorityselector
setmetatable(priorityselector, { __index = btnode })

local function sort_by_priority_desc(a, b)
	return (a.priority or 0) > (b.priority or 0)
end

function priorityselector.new(id, children, priority)
	local self = setmetatable(btnode.new(id, priority), priorityselector)
	self.children = children or {}
	if #self.children > 1 then
		table.sort(self.children, sort_by_priority_desc)
	end
	return self
end

function priorityselector:tick(target, blackboard)
	for i = 1, #self.children do
		local status = self.children[i]:tick(target, blackboard)
		if status ~= behaviourtree.failure then
			return status
		end
	end
	return behaviourtree.failure
end

local wait = {}
wait.__index = wait
setmetatable(wait, { __index = btnode })

function wait.new(id, wait_time, propname, priority)
	local self = setmetatable(btnode.new(id, priority), wait)
	self.wait_time = wait_time
	self.wait_propname = propname
	return self
end

function wait:tick(_target, blackboard)
	local elapsed = blackboard.nodedata[self.wait_propname] or 0
	if elapsed < self.wait_time then
		blackboard.nodedata[self.wait_propname] = elapsed + 1
		return behaviourtree.running
	end
	blackboard.nodedata[self.wait_propname] = nil
	return behaviourtree.success
end

local action = {}
action.__index = action
setmetatable(action, { __index = parametrizednode })

function action.new(id, action_fn, priority, parameters)
	local self = setmetatable(parametrizednode.new(id, priority, parameters), action)
	self.action = action_fn
	return self
end

function action:tick(target, blackboard)
	return self.action(target, blackboard, self.parameters)
end

local compositeaction = {}
compositeaction.__index = compositeaction
setmetatable(compositeaction, { __index = parametrizednode })

function compositeaction.new(id, actions, priority, parameters)
	local self = setmetatable(parametrizednode.new(id, priority, parameters), compositeaction)
	self.actions = actions or {}
	return self
end

function compositeaction:tick(target, blackboard)
	local outcome
	for i = 1, #self.actions do
		local status = self.actions[i]:tick(target, blackboard)
		if status == behaviourtree.failure then
			return status
		end
		if status == behaviourtree.running then
			outcome = status
		end
	end
	return outcome or behaviourtree.success
end

local behaviourtreedefinitions = {}

local function build_node(spec, id)
	if type(spec) ~= 'table' then
		error("behavior tree '" .. tostring(id) .. "' has invalid node spec: expected table.")
	end
	local node_type = spec.type or spec.kind or spec.node
	if node_type == nil then
		error("behavior tree '" .. tostring(id) .. "' node is missing required type/kind/node.")
	end
	if node_type == 'selector' then
		local children = {}
		for i = 1, #spec.children do
			children[i] = build_node(spec.children[i], id)
		end
		return selector.new(id, children, spec.priority)
	end
	if node_type == 'sequence' then
		local children = {}
		for i = 1, #spec.children do
			children[i] = build_node(spec.children[i], id)
		end
		return sequence.new(id, children, spec.priority)
	end
	if node_type == 'parallel' then
		local children = {}
		for i = 1, #spec.children do
			children[i] = build_node(spec.children[i], id)
		end
		return parallel.new(id, children, spec.successpolicy, spec.priority)
	end
	if node_type == 'decorator' then
		local child = build_node(spec.child, id)
		return decorator.new(id, child, spec.decorator, spec.priority)
	end
	if node_type == 'condition' then
		return condition.new(id, spec.condition, spec.modifier, spec.priority, spec.parameters)
	end
	if node_type == 'compositecondition' then
		return compositecondition.new(id, spec.conditions, spec.modifier, spec.priority, spec.parameters)
	end
	if node_type == 'randomselector' then
		local children = {}
		for i = 1, #spec.children do
			children[i] = build_node(spec.children[i], id)
		end
		return randomselector.new(id, children, spec.currentchild_propname, spec.priority)
	end
	if node_type == 'limit' then
		local child = build_node(spec.child, id)
		return limit.new(id, spec.limit, spec.count_propname, child, spec.priority)
	end
	if node_type == 'priorityselector' then
		local children = {}
		for i = 1, #spec.children do
			children[i] = build_node(spec.children[i], id)
		end
		return priorityselector.new(id, children, spec.priority)
	end
	if node_type == 'wait' then
		return wait.new(id, spec.wait_time, spec.wait_propname, spec.priority)
	end
	if node_type == 'action' then
		return action.new(id, spec.action, spec.priority, spec.parameters)
	end
	if node_type == 'compositeaction' then
		local actions = {}
		for i = 1, #spec.actions do
			actions[i] = build_node(spec.actions[i], id)
		end
		return compositeaction.new(id, actions, spec.priority, spec.parameters)
	end
	error("behavior tree '" .. tostring(id) .. "' has unsupported node type '" .. tostring(node_type) .. "'.")
end

function behaviourtree.register_definition(id, definition)
	if type(id) ~= 'string' or #id == 0 then
		error('behavior tree definition id must be a non-empty string.')
	end
	if behaviourtreedefinitions[id] ~= nil then
		error("behavior tree '" .. id .. "' is already registered.")
	end
	if type(definition) ~= 'table' then
		error("behavior tree '" .. id .. "' definition must be a table.")
	end
	local root = definition.root or definition
	build_node(root, id)
	behaviourtreedefinitions[id] = definition
end

function behaviourtree.instantiate(id)
	local def = behaviourtreedefinitions[id]
	if def == nil then
		error("behavior tree '" .. tostring(id) .. "' is not registered.")
	end
	local root = def.root or def
	return build_node(root, id)
end

behaviourtree.blackboard = blackboard
behaviourtree.btnode = btnode
behaviourtree.sequence = sequence
behaviourtree.selector = selector
behaviourtree.parallel = parallel
behaviourtree.decorator = decorator
behaviourtree.condition = condition
behaviourtree.compositecondition = compositecondition
behaviourtree.randomselector = randomselector
behaviourtree.limit = limit
behaviourtree.priorityselector = priorityselector
behaviourtree.wait = wait
behaviourtree.action = action
behaviourtree.compositeaction = compositeaction

return behaviourtree
