-- fsm.lua
-- Finite state machine runtime for system ROM

local StateDefinition = {}
StateDefinition.__index = StateDefinition

local START_STATE_PREFIXES = { ["_"] = true, ["#"] = true }

local function make_def_id(id, parent)
	if not parent then
		return id
	end
	local separator = parent.parent and "/" or ":/"
	return parent.def_id .. separator .. id
end

function StateDefinition.new(id, def, root, parent)
	local self = setmetatable({}, StateDefinition)
	self.__is_state_definition = true
	self.id = id
	self.parent = parent
	self.root = root or self
	self.def_id = def and def.def_id or make_def_id(id, parent)
	self.data = def and def.data or {}
	self.states = {}
	self.initial = def and def.initial or nil
	self.on = def and def.on or {}
	self.tick = def and def.tick or nil
	self.entering_state = def and def.entering_state or nil
	self.exiting_state = def and (def.exiting_state or def.leaving_state) or nil
	self.run_checks = def and def.run_checks or nil
	self.input_event_handlers = def and def.input_event_handlers or {}
	self.process_input = def and def.process_input or nil
	self.is_concurrent = def and def.is_concurrent or false
	self.input_eval = def and def.input_eval or nil
	self.event_list = def and def.event_list or nil
	self.timelines = def and def.timelines or nil
	self.transition_guards = def and def.transition_guards or nil

	if def and def.states then
		for state_id, state_def in pairs(def.states) do
			local child = StateDefinition.new(state_id, state_def, self.root, self)
			self.states[state_id] = child
			if not self.initial and START_STATE_PREFIXES[state_id:sub(1, 1)] then
				self.initial = state_id
			end
		end
	end

	if not self.initial then
		for key in pairs(self.states) do
			self.initial = key
			break
		end
	end
	return self
end

local State = {}
State.__index = State

local function clone_defaults(source)
	local out = {}
	for k, v in pairs(source) do
		out[k] = v
	end
	return out
end

function State.new(definition, target, parent)
	local self = setmetatable({}, State)
	self.definition = definition
	self.target = target
	self.id = definition.id
	self.localdef_id = definition.id
	self.data = clone_defaults(definition.data or {})
	self.states = {}
	self.current_id = nil
	self.started = false
	self.parent = parent
	self.root = parent and parent.root or self
	self.timeline_bindings = nil
	return self
end

function State:timeline(id)
	return self.target:get_timeline(id)
end

function State:create_timeline_binding(key, config)
	return {
		id = config.id or key,
		create = config.create,
		autoplay = config.autoplay ~= false,
		stop_on_exit = config.stop_on_exit ~= false,
		play_options = config.play_options,
		defined = false,
	}
end

function State:ensure_timeline_definitions()
	if not self.timeline_bindings then
		local defs = self.definition.timelines or {}
		local bindings = {}
		for key, config in pairs(defs) do
			bindings[#bindings + 1] = self:create_timeline_binding(key, config)
		end
		self.timeline_bindings = bindings
	end
	local bindings = self.timeline_bindings
	for i = 1, #bindings do
		local binding = bindings[i]
		if not binding.defined then
			local timeline = binding.create()
			self.target:define_timeline(timeline)
			binding.defined = true
		end
	end
	return bindings
end

function State:activate_timelines()
	local bindings = self:ensure_timeline_definitions()
	for i = 1, #bindings do
		local binding = bindings[i]
		if binding.autoplay then
			self.target:play_timeline(binding.id, binding.play_options)
		end
	end
end

function State:deactivate_timelines()
	local bindings = self.timeline_bindings
	if not bindings then
		return
	end
	for i = 1, #bindings do
		local binding = bindings[i]
		if binding.stop_on_exit then
			self.target:stop_timeline(binding.id)
		end
	end
end

function State:start()
	self.started = true
	self:activate_timelines()
	if self.definition.entering_state then
		self.definition.entering_state(self.target, self)
	end
	local initial = self.definition.initial
	if initial then
		self:transition_to(initial)
	end
end

function State:transition_to(state_id)
	local next_def = self.definition.states[state_id]
	assert(next_def, "State '" .. state_id .. "' not defined under '" .. self.id .. "'")

	if self.current_id then
		local old_state = self.states[self.current_id]
		old_state:deactivate_timelines()
		if old_state.definition.exiting_state then
			old_state.definition.exiting_state(self.target, old_state)
		end
	end

	self.current_id = state_id
	local child = self.states[state_id]
	if not child then
		child = State.new(next_def, self.target, self)
		self.states[state_id] = child
	end
	child:start()
end

function State:transition_to_path(path)
	local current = self
	for part in string.gmatch(path, "[^/]+") do
		current:transition_to(part)
		current = current.states[part]
		if not current then
			break
		end
	end
end

local function resolve_handler_transition(handler, target, state, payload)
	local t = type(handler)
	if t == "string" then
		state:transition_to_path(handler)
		return true
	end
	if t == "table" and handler.go then
		local go = handler.go
		local out = type(go) == "string" and go or go(target, state, payload)
		if type(out) == "string" then
			state:transition_to_path(out)
		end
		return true
	end
	if t == "function" then
		local result = handler(target, state, payload)
		if type(result) == "string" then
			state:transition_to_path(result)
		end
		return true
	end
	return false
end

function State:dispatch_event(event_or_name, payload)
	local event_name = event_or_name
	local data = payload
	if type(event_or_name) == "table" then
		event_name = event_or_name.type
		data = event_or_name
	end
	local handler = self.definition.on[event_name]
	if resolve_handler_transition(handler, self.target, self, data) then
		return true
	end
	if self.current_id then
		local child = self.states[self.current_id]
		if child and child:dispatch_event(event_name, data) then
			return true
		end
	end
	return false
end

function State:dispatch_input_event(event_or_name, payload)
	local event_name = event_or_name
	local data = payload
	if type(event_or_name) == "table" then
		event_name = event_or_name.type
		data = event_or_name
	end
	local handler = self.definition.input_event_handlers[event_name]
	if resolve_handler_transition(handler, self.target, self, data) then
		return true
	end
	if self.current_id then
		local child = self.states[self.current_id]
		if child and child:dispatch_input_event(event_name, data) then
			return true
		end
	end
	return false
end

function State:resolve_input_eval_mode()
	local node = self
	while node do
		local mode = node.definition.input_eval
		if mode == "first" or mode == "all" then
			return mode
		end
		node = node.parent
	end
	return "all"
end

function State:process_input_events()
	local handlers = self.definition.input_event_handlers
	if not handlers then
		return
	end
	local player_index = self.target.player_index or 1
	local eval_mode = self:resolve_input_eval_mode()
	for pattern, handler in pairs(handlers) do
		if action_triggered(pattern, player_index) then
			local handled = resolve_handler_transition(handler, self.target, self, { type = pattern, player_index = player_index })
			if handled and eval_mode == "first" then
				return
			end
		end
	end
end

function State:process_input()
	self:process_input_events()
	if self.definition.process_input then
		local result = self.definition.process_input(self.target, self)
		if type(result) == "string" then
			self:transition_to_path(result)
		end
	end
end

function State:tick(dt)
	if self.current_id then
		local child = self.states[self.current_id]
		if child then
			child:tick(dt)
		end
	end
	if self.definition.is_concurrent then
		for id, child in pairs(self.states) do
			if id ~= self.current_id then
				child:tick(dt)
			end
		end
	end
	self:process_input()
	if self.definition.tick then
		local result = self.definition.tick(self.target, self, dt)
		if type(result) == "string" then
			self:transition_to_path(result)
		end
	end
	local checks = self.definition.run_checks
	if checks then
		for i = 1, #checks do
			local result = checks[i](self.target, self, dt)
			if type(result) == "string" then
				self:transition_to_path(result)
				break
			end
		end
	end
end

function State:dispose()
	for _, child in pairs(self.states) do
		child:dispose()
	end
	self.states = {}
	self.current_id = nil
end

local StateMachineController = {}
StateMachineController.__index = StateMachineController

function StateMachineController.new(opts)
	local self = setmetatable({}, StateMachineController)
	opts = opts or {}
	self.target = opts.target
	self.statemachines = {}
	self.tick_enabled = opts.tick_enabled ~= false
	self.paused = false
	if opts.definition then
		local def = opts.definition
		local id = def.id or opts.fsm_id or "master"
		self:add_statemachine(id, def)
	end
	return self
end

function StateMachineController:add_statemachine(id, definition)
	local def = definition
	if not (definition and definition.__is_state_definition) then
		def = StateDefinition.new(id, definition)
	end
	local machine = State.new(def, self.target)
	self.statemachines[id] = machine
	return machine
end

function StateMachineController:start()
	for _, machine in pairs(self.statemachines) do
		machine:start()
	end
	self.paused = false
end

function StateMachineController:tick(dt)
	if self.paused or not self.tick_enabled then
		return
	end
	for _, machine in pairs(self.statemachines) do
		machine:tick(dt)
	end
end

function StateMachineController:dispatch(event_or_name, payload)
	if self.paused then
		return false
	end
	local event_name = event_or_name
	local data = payload
	if type(event_or_name) == "table" then
		event_name = event_or_name.type
		data = event_or_name
	end
	local handled = false
	for _, machine in pairs(self.statemachines) do
		if machine:dispatch_event(event_name, data) then
			handled = true
		end
	end
	return handled
end

function StateMachineController:dispatch_input(event_or_name, payload)
	if self.paused then
		return false
	end
	local event_name = event_or_name
	local data = payload
	if type(event_or_name) == "table" then
		event_name = event_or_name.type
		data = event_or_name
	end
	local handled = false
	for _, machine in pairs(self.statemachines) do
		if machine:dispatch_input_event(event_name, data) then
			handled = true
		end
	end
	return handled
end

function StateMachineController:dispatch_event(event)
	return self:dispatch(event)
end

function StateMachineController:transition_to(path)
	local machine_id, state_path = path:match("^(.-):/(.+)$")
	if not machine_id then
		machine_id = path
		state_path = path
	end
	local machine = self.statemachines[machine_id]
	machine:transition_to_path(state_path)
end

function StateMachineController:pause()
	self.paused = true
end

function StateMachineController:resume()
	self.paused = false
end

function StateMachineController:dispose()
	self:pause()
	for _, machine in pairs(self.statemachines) do
		machine:dispose()
	end
	self.statemachines = {}
end

return {
	StateDefinition = StateDefinition,
	State = State,
	StateMachineController = StateMachineController,
}
