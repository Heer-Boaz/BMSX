-- fsm.lua
-- finite state machine runtime for system rom

local statedefinition = {}
statedefinition.__index = statedefinition

local start_state_prefixes = { ["_"] = true, ["#"] = true }

local function make_def_id(id, parent)
	if not parent then
		return id
	end
	local separator = parent.parent and "/" or ":/"
	return parent.def_id .. separator .. id
end

function statedefinition.new(id, def, root, parent)
	local self = setmetatable({}, statedefinition)
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
			local child = statedefinition.new(state_id, state_def, self.root, self)
			self.states[state_id] = child
			if not self.initial and start_state_prefixes[state_id:sub(1, 1)] then
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

local state = {}
state.__index = state

local function clone_defaults(source)
	local out = {}
	for k, v in pairs(source) do
		out[k] = v
	end
	return out
end

function state.new(definition, target, parent)
	local self = setmetatable({}, state)
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

function state:timeline(id)
	return self.target:get_timeline(id)
end

function state:create_timeline_binding(key, config)
	return {
		id = config.id or key,
		create = config.create,
		autoplay = config.autoplay ~= false,
		stop_on_exit = config.stop_on_exit ~= false,
		play_options = config.play_options,
		defined = false,
	}
end

function state:ensure_timeline_definitions()
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

function state:activate_timelines()
	local bindings = self:ensure_timeline_definitions()
	for i = 1, #bindings do
		local binding = bindings[i]
		if binding.autoplay then
			self.target:play_timeline(binding.id, binding.play_options)
		end
	end
end

function state:deactivate_timelines()
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

function state:start()
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

function state:transition_to(state_id)
	local next_def = self.definition.states[state_id]
	assert(next_def, "state '" .. state_id .. "' not defined under '" .. self.id .. "'")

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
		child = state.new(next_def, self.target, self)
		self.states[state_id] = child
	end
	child:start()
end

function state:transition_to_path(path)
	local current = self
	for part in string.gmatch(path, "[^/]+") do
		current:transition_to(part)
		current = current.states[part]
		if not current then
			break
		end
	end
end

state._path_cache = {}
state._path_cache_max = 256

function state.parse_fs_path(input)
	local cached = state._path_cache[input]
	if cached then
		return cached
	end
	local len = #input
	local i = 1
	local abs = false
	local up = 0
	local segs = {}
	if len == 0 then
		return { abs = false, up = 0, segs = {} }
	end
	if input:sub(i, i) == "/" then
		abs = true
		i = i + 1
	end
	if not abs then
		if input:sub(i, i + 1) == "./" then
			i = i + 2
		else
			while input:sub(i, i + 2) == "../" do
				up = up + 1
				i = i + 3
			end
		end
	end

	local function push_seg(seg)
		if seg == "" or seg == "." then
			return
		end
		if seg == ".." then
			if #segs > 0 then
				table.remove(segs)
			else
				up = up + 1
			end
			return
		end
		segs[#segs + 1] = seg
	end

	while i <= len do
		local c = input:sub(i, i)
		if c == "/" then
			i = i + 1
		elseif c == "[" and input:sub(i + 1, i + 1) == "\"" then
			i = i + 2
			local seg = ""
			local closed = false
			while i <= len do
				local ch = input:sub(i, i)
				i = i + 1
				if ch == "\\" then
					if i <= len then
						local esc = input:sub(i, i)
						i = i + 1
						if esc == "\"" then
							seg = seg .. "\""
						elseif esc == "/" then
							seg = seg .. "/"
						else
							seg = seg .. esc
						end
					end
				elseif ch == "\"" then
					if input:sub(i, i) == "]" then
						i = i + 1
						closed = true
						break
					else
						error("unterminated quoted segment in path '" .. input .. "'.")
					end
				else
					seg = seg .. ch
				end
			end
			if not closed then
				error("unterminated quoted segment in path '" .. input .. "'.")
			end
			push_seg(seg)
		else
			local start = i
			while i <= len and input:sub(i, i) ~= "/" do
				i = i + 1
			end
			push_seg(input:sub(start, i - 1))
		end
	end

	local cache_count = 0
	for _ in pairs(state._path_cache) do
		cache_count = cache_count + 1
	end
	if cache_count >= state._path_cache_max then
		for key in pairs(state._path_cache) do
			state._path_cache[key] = nil
			break
		end
	end
	local rec = { abs = abs, up = up, segs = segs }
	state._path_cache[input] = rec
	return rec
end

function state:matches_state_path(path)
	local function match_segments(start, segments)
		if #segments == 0 then
			return false
		end
		local ctx = start
		for i = 1, #segments do
			local seg = segments[i]
			local child = ctx.states[seg]
			if not child then
				return false
			end
			if not child.definition.is_concurrent and ctx.current_id ~= seg then
				return false
			end
			if i == #segments then
				return true
			end
			ctx = child
		end
		return false
	end

	if type(path) == "table" then
		return match_segments(self, path)
	end

	local spec = state.parse_fs_path(path)
	local ctx = spec.abs and self.root or self
	for i = 1, spec.up do
		if not ctx.parent then
			return false
		end
		ctx = ctx.parent
	end
	return match_segments(ctx, spec.segs)
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

function state:dispatch_event(event_or_name, payload)
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

function state:dispatch_input_event(event_or_name, payload)
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

function state:resolve_input_eval_mode()
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

function state:process_input_events()
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

function state:process_input()
	self:process_input_events()
	if self.definition.process_input then
		local result = self.definition.process_input(self.target, self)
		if type(result) == "string" then
			self:transition_to_path(result)
		end
	end
end

function state:tick(dt)
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

function state:dispose()
	for _, child in pairs(self.states) do
		child:dispose()
	end
	self.states = {}
	self.current_id = nil
end

local statemachinecontroller = {}
statemachinecontroller.__index = statemachinecontroller

function statemachinecontroller.new(opts)
	local self = setmetatable({}, statemachinecontroller)
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

function statemachinecontroller:add_statemachine(id, definition)
	local def = definition
	if not (definition and definition.__is_state_definition) then
		def = statedefinition.new(id, definition)
	end
	local machine = state.new(def, self.target)
	self.statemachines[id] = machine
	return machine
end

function statemachinecontroller:start()
	for _, machine in pairs(self.statemachines) do
		machine:start()
	end
	self.paused = false
end

function statemachinecontroller:tick(dt)
	if self.paused or not self.tick_enabled then
		return
	end
	for _, machine in pairs(self.statemachines) do
		machine:tick(dt)
	end
end

function statemachinecontroller:dispatch(event_or_name, payload)
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

function statemachinecontroller:dispatch_input(event_or_name, payload)
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

function statemachinecontroller:dispatch_event(event)
	return self:dispatch(event)
end

function statemachinecontroller:transition_to(path)
	local machine_id, state_path = path:match("^(.-):/(.+)$")
	if not machine_id then
		machine_id = path
		state_path = path
	end
	local machine = self.statemachines[machine_id]
	machine:transition_to_path(state_path)
end

function statemachinecontroller:matches_state_path(path)
	local machine_id, state_path = path:match("^(.-):/(.+)$")
	if machine_id then
		local machine = self.statemachines[machine_id]
		if not machine then
			return false
		end
		return machine:matches_state_path(state_path)
	end
	for _, machine in pairs(self.statemachines) do
		if machine:matches_state_path(path) then
			return true
		end
	end
	return false
end

function statemachinecontroller:pause()
	self.paused = true
end

function statemachinecontroller:resume()
	self.paused = false
end

function statemachinecontroller:dispose()
	self:pause()
	for _, machine in pairs(self.statemachines) do
		machine:dispose()
	end
	self.statemachines = {}
end

return {
	statedefinition = statedefinition,
	state = state,
	statemachinecontroller = statemachinecontroller,
}
