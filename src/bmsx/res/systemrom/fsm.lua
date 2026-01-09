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

local function collect_event_list(def, list, seen)
	for name in pairs(def.on) do
		if not seen[name] then
			list[#list + 1] = { name = name }
			seen[name] = true
		end
	end
	for _, child in pairs(def.states) do
		collect_event_list(child, list, seen)
	end
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
			if not self.initial and start_state_prefixes[string.sub(state_id, 1, 1)] then
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
	if self.root == self then
		local list = {}
		local seen = {}
		collect_event_list(self, list, seen)
		self.event_list = list
	end
	return self
end

local state = {}
state.__index = state

state.trace_map = {}
state.path_config = { cache_size = 256 }
state.diagnostics = {
	trace_transitions = true,
	trace_dispatch = true,
	mirror_to_vm = false,
	max_entries_per_machine = 512,
}

local BST_MAX_HISTORY = 10
local MAX_TRANSITIONS_PER_TICK = 1000
local EMPTY_GAME_EVENT = { type = "__fsm.synthetic__", emitter = nil, timestamp = 0 }

local function clone_defaults(source)
	local out = {}
	for k, v in pairs(source) do
		out[k] = v
	end
	return out
end

local function should_trace_transitions()
	local diag = state.diagnostics
	return diag and diag.trace_transitions == true
end

local function should_trace_dispatch()
	local diag = state.diagnostics
	return diag and diag.trace_dispatch == true
end

local function append_trace_entry(id, message)
	local diag = state.diagnostics
	if not diag then
		return
	end
	local list = state.trace_map[id]
	if not list then
		list = {}
		state.trace_map[id] = list
	end
	list[#list + 1] = message
	local limit = diag.max_entries_per_machine or 0
	if limit > 0 and #list > limit then
		local overflow = #list - limit
		for i = 1, overflow do
			table.remove(list, 1)
		end
	end
end

local function describe_payload(payload)
	if payload == nil then
		return "nil"
	end
	local t = type(payload)
	if t == "string" then
		return payload
	end
	if t == "number" or t == "boolean" then
		return tostring(payload)
	end
	return tostring(payload)
end

local function clone_snapshot(ctx)
	if not ctx then
		return nil
	end
	local out = {
		trigger = ctx.trigger,
		description = ctx.description,
		event_name = ctx.event_name,
		emitter = ctx.emitter,
		handler_name = ctx.handler_name,
		payload_summary = ctx.payload_summary,
		timestamp = ctx.timestamp,
		bubbled = ctx.bubbled,
		last_transition = ctx.last_transition and {
			from = ctx.last_transition.from,
			to = ctx.last_transition.to,
			execution = ctx.last_transition.execution,
			status = ctx.last_transition.status,
			guard_summary = ctx.last_transition.guard_summary,
			reason = ctx.last_transition.reason,
		} or nil,
	}
	if ctx.action_evaluations then
		local list = {}
		for i = 1, #ctx.action_evaluations do
			list[i] = ctx.action_evaluations[i]
		end
		out.action_evaluations = list
	end
	if ctx.guard_evaluations then
		local list = {}
		for i = 1, #ctx.guard_evaluations do
			local g = ctx.guard_evaluations[i]
			list[i] = {
				side = g.side,
				descriptor = g.descriptor,
				passed = g.passed,
				defined = g.defined,
				type = g.type,
				reason = g.reason,
			}
		end
		out.guard_evaluations = list
	end
	return out
end

local function resolve_emitter_id(event, fallback)
	if not event or not event.emitter then
		return fallback
	end
	local emitter = event.emitter
	if type(emitter) == "table" and emitter.id ~= nil then
		return emitter.id
	end
	return emitter
end

local function resolve_event_payload(event)
	if not event then
		return nil
	end
	local payload = nil
	for k, v in pairs(event) do
		if k ~= "type" and k ~= "emitter" and k ~= "timestamp" and k ~= "timeStamp" and k ~= "target" then
			if not payload then
				payload = {}
			end
			payload[k] = v
		end
	end
	return payload
end

local function trim_string(value)
	return (string.match(value, "^%s*(.-)%s*$"))
end

local function is_no_op_string(value)
	if not value then
		return false
	end
	local trimmed = trim_string(value)
	local lower = string.lower(trimmed)
	return lower == "no-op" or lower == "noop" or lower == "no_op"
end

local function resolve_state_key(definition, state_id)
	local states = definition.states
	if not states then
		error("state '" .. definition.id .. "' does not define substates.")
	end
	if states[state_id] then
		return state_id
	end
	local underscore = "_" .. state_id
	if states[underscore] then
		return underscore
	end
	local hash = "#" .. state_id
	if states[hash] then
		return hash
	end
	return nil
end

local function resolve_state_instance(parent, state_id)
	local child = parent.states[state_id]
	if child then
		return child, state_id
	end
	local underscore = "_" .. state_id
	child = parent.states[underscore]
	if child then
		return child, underscore
	end
	local hash = "#" .. state_id
	child = parent.states[hash]
	if child then
		return child, hash
	end
	return nil, nil
end

function state.new(definition, target, parent)
	local self = setmetatable({}, state)
	self.definition = definition
	self.target = target
	self.target_id = target.id
	self.localdef_id = definition.id
	self.def_id = definition.def_id
	self.parent = parent
	self.root = parent and parent.root or self
	self.id = self:make_id()
	self.data = clone_defaults(definition.data or {})
	self.states = {}
	self.current_id = nil
	self.timeline_bindings = nil
	self.transition_queue = {}
	self.critical_section_counter = 0
	self.is_processing_queue = false
	self._transition_context_stack = nil
	self._hist = {}
	self._hist_head = 0
	self._hist_size = 0
	self.in_tick = false
	self._transitions_this_tick = 0
	self.paused = false
	self:populate_states()
	self:reset(true)
	return self
end

function state:is_root()
	return self.parent == nil
end

function state:make_id()
	if self:is_root() then
		return self.target_id .. "." .. self.localdef_id
	end
	local separator = self.parent.parent and "/" or ":/"
	return self.parent.id .. separator .. self.localdef_id
end

function state:definition_or_throw()
	local def = self.definition
	if not def then
		error("state '" .. tostring(self.localdef_id) .. "' missing definition.")
	end
	return def
end

function state:child_definition_or_throw(child_id)
	local def = self:definition_or_throw()
	if not def.states then
		error("definition '" .. tostring(def.def_id) .. "' has no substates while resolving '" .. child_id .. "'.")
	end
	local key = resolve_state_key(def, child_id)
	if not key then
		error("definition '" .. tostring(def.def_id) .. "' is missing child '" .. child_id .. "'.")
	end
	return def.states[key], key
end

function state:states_or_throw(ctx)
	local container = ctx or self
	if not container.states or next(container.states) == nil then
		error("state '" .. tostring(container.id) .. "' does not define substates.")
	end
	return container.states
end

function state:current_state_definition()
	local current = self.states and self.states[self.current_id]
	if not current then
		error("current state '" .. tostring(self.current_id) .. "' not found in '" .. tostring(self.id) .. "'.")
	end
	return current.definition
end

function state:find_child(ctx, seg)
	local child, key = resolve_state_instance(ctx, seg)
	return child, key
end

function state:ensure_child(ctx, seg)
	local child, key = self:find_child(ctx, seg)
	if not child then
		if not ctx.states then
			error("state '" .. tostring(ctx.id) .. "' does not define substates.")
		end
		local children = {}
		for id in pairs(ctx.states) do
			children[#children + 1] = id
		end
		error("no state '" .. seg .. "' under '" .. tostring(ctx.id) .. "'. children: " .. table.concat(children, ", "))
		if type(child) ~= "table" then
			error("state '" .. tostring(ctx.id) .. "' has non-state child '" .. tostring(seg) .. "' (type " .. type(child) .. ").")
		end
	end
	return child, key
end

function state:timeline(id)
	local timeline = self.target:get_timeline(id)
	if not timeline then
		error("timeline '" .. tostring(id) .. "' not found for target '" .. tostring(self.target_id) .. "'.")
	end
	return timeline
end

function state:create_timeline_binding(key, config)
	if type(config.create) ~= "function" then
		error("timeline '" .. tostring(key) .. "' is missing a create() factory.")
	end
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
			if not timeline then
				error("timeline factory for '" .. tostring(binding.id) .. "' returned no timeline.")
			end
			if timeline.id ~= binding.id then
				error("timeline factory for '" .. tostring(binding.id) .. "' returned '" .. tostring(timeline.id) .. "'.")
			end
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
	self:activate_timelines()
	local start_state_id = self.definition.initial
	if not start_state_id then
		if not self.states or next(self.states) == nil then
			return
		end
		error("no start state defined for state machine '" .. tostring(self.id) .. "'.")
	end

	local states = self.states
	if not states then
		error("start(): state '" .. tostring(self.id) .. "' has no instantiated substates.")
	end
	local start_instance = states[start_state_id]
	if not start_instance then
		error("start(): start state '" .. tostring(start_state_id) .. "' not found in state machine '" .. tostring(self.id) .. "'.")
	end
	local start_state_def = start_instance.definition

	self:with_critical_section(function()
		start_instance:activate_timelines()
		local enter_start = start_state_def.entering_state
		local start_next = nil
		if type(enter_start) == "function" then
			start_next = enter_start(self.target, start_instance)
		end
		start_instance:transition_to_next_state_if_provided(start_next)
	end)

	start_instance:start()
end

function state:enter_critical_section()
	self.critical_section_counter = self.critical_section_counter + 1
end

function state:leave_critical_section()
	self.critical_section_counter = self.critical_section_counter - 1
	if self.critical_section_counter == 0 then
		if not self.is_processing_queue then
			self:process_transition_queue()
		end
	elseif self.critical_section_counter < 0 then
		error("critical section counter was lower than 0, which is a bug. state: '" .. tostring(self.id) .. "'.")
	end
end

function state:with_critical_section(fn)
	self:enter_critical_section()
	local results = table.pack(pcall(fn))
	self:leave_critical_section()
	if not results[1] then
		error(results[2])
	end
	return table.unpack(results, 2, results.n)
end

	function state:process_transition_queue()
		if self.is_processing_queue then
			return
		end
		self.is_processing_queue = true
		local results = table.pack(pcall(function()
			local i = 1
			while i <= #self.transition_queue do
				local t = self.transition_queue[i]
				if should_trace_transitions() then
					self:run_with_transition_context(
						function()
							return self:hydrate_context(t.diag, "queue-drain", "queued-execution")
						end,
						function()
							self:transition_to_state(t.path, "deferred")
						end
					)
				else
					self:transition_to_state(t.path, "deferred")
				end
				i = i + 1
			end
			self.transition_queue = {}
		end))
		self.is_processing_queue = false
		if not results[1] then
			error(results[2])
		end
	end

function state:run_with_transition_context(factory, fn)
	if not should_trace_transitions() then
		return fn(nil)
	end
	local ctx = factory()
	local stack = self._transition_context_stack
	if not stack then
		stack = {}
		self._transition_context_stack = stack
	end
	stack[#stack + 1] = ctx
	local results = table.pack(pcall(fn, ctx))
	stack[#stack] = nil
	if #stack == 0 then
		self._transition_context_stack = nil
	end
	if not results[1] then
		error(results[2])
	end
	return table.unpack(results, 2, results.n)
end

function state:peek_transition_context()
	local stack = self._transition_context_stack
	if not stack or #stack == 0 then
		return nil
	end
	return stack[#stack]
end

function state:append_action_evaluation(detail)
	if not should_trace_transitions() then
		return
	end
	local ctx = self:peek_transition_context()
	if not ctx then
		return
	end
	if not ctx.action_evaluations then
		ctx.action_evaluations = {}
	end
	ctx.action_evaluations[#ctx.action_evaluations + 1] = detail
end

function state:append_guard_evaluation(detail)
	if not should_trace_transitions() then
		return
	end
	local ctx = self:peek_transition_context()
	if not ctx then
		return
	end
	if not ctx.guard_evaluations then
		ctx.guard_evaluations = {}
	end
	ctx.guard_evaluations[#ctx.guard_evaluations + 1] = detail
end

function state:record_transition_outcome_on_context(outcome)
	if not should_trace_transitions() then
		return
	end
	local ctx = self:peek_transition_context()
	if not ctx then
		return
	end
	ctx.last_transition = outcome
	if not ctx.transitions then
		ctx.transitions = {}
	end
	ctx.transitions[#ctx.transitions + 1] = outcome
end

function state:resolve_context_snapshot(provided)
	if provided then
		return provided
	end
	return clone_snapshot(self:peek_transition_context())
end

function state:format_guard_diagnostics(guard)
	if not guard or not guard.evaluations or #guard.evaluations == 0 then
		return nil
	end
	local parts = {}
	for i = 1, #guard.evaluations do
		local ev = guard.evaluations[i]
		local status = ev.passed and "pass" or "fail"
		local descriptor = ev.descriptor and ev.descriptor ~= "<none>" and "(" .. ev.descriptor .. ")" or ""
		local note = ev.reason and not ev.passed and ("!" .. ev.reason) or nil
		local suffix = note and ("[" .. note .. "]") or ""
		parts[#parts + 1] = ev.side .. ":" .. status .. descriptor .. suffix
	end
	return table.concat(parts, ",")
end

function state:format_action_evaluations(context)
	if not context or not context.action_evaluations or #context.action_evaluations == 0 then
		return nil
	end
	return table.concat(context.action_evaluations, ";")
end

function state:emit_transition_trace(entry)
	if not should_trace_transitions() then
		return
	end
	local context = self:resolve_context_snapshot(entry.context)
	local message = self:compose_transition_trace_message({
		outcome = entry.outcome,
		execution = entry.execution,
		from = entry.from,
		to = entry.to,
		context = context,
		guard = entry.guard,
		queue_size = entry.queue_size,
		reason = entry.reason,
	})
	append_trace_entry(self.id, message)
end

function state:compose_transition_trace_message(entry)
	local parts = { "[transition]" }
	parts[#parts + 1] = "outcome=" .. entry.outcome
	parts[#parts + 1] = "exec=" .. entry.execution
	parts[#parts + 1] = "to='" .. tostring(entry.to) .. "'"
	if entry.from ~= nil then
		parts[#parts + 1] = "from='" .. tostring(entry.from) .. "'"
	end
	if entry.context and entry.context.trigger then
		local trigger = entry.context.event_name and (entry.context.trigger .. "(" .. entry.context.event_name .. ")") or entry.context.trigger
		parts[#parts + 1] = "trigger=" .. trigger
	end
	if entry.context and entry.context.description then
		parts[#parts + 1] = "desc=" .. entry.context.description
	end
	if entry.context and entry.context.handler_name then
		parts[#parts + 1] = "handler=" .. entry.context.handler_name
	end
	if entry.context and entry.context.emitter then
		parts[#parts + 1] = "emitter=" .. tostring(entry.context.emitter)
	end
	if entry.context and entry.context.bubbled then
		parts[#parts + 1] = "bubbled=true"
	end
	if entry.reason then
		parts[#parts + 1] = "reason=" .. entry.reason
	end
	local guard_summary = self:format_guard_diagnostics(entry.guard)
	if guard_summary then
		parts[#parts + 1] = "guards=" .. guard_summary
	end
	local action_summary = self:format_action_evaluations(entry.context)
	if action_summary then
		parts[#parts + 1] = "actions=" .. action_summary
	end
	if entry.context and entry.context.payload_summary then
		parts[#parts + 1] = "payload=" .. entry.context.payload_summary
	end
	if entry.queue_size ~= nil then
		parts[#parts + 1] = "queue=" .. tostring(entry.queue_size)
	end
	if entry.context and entry.context.timestamp then
		parts[#parts + 1] = "ts=" .. tostring(entry.context.timestamp)
	end
	return table.concat(parts, " ")
end

function state:create_fallback_snapshot(trigger, description, payload)
	return {
		trigger = trigger,
		description = description,
		timestamp = $.platform.clock.now(),
		payload_summary = payload ~= nil and describe_payload(payload) or nil,
	}
end

function state:hydrate_context(snapshot, trigger, description)
	if snapshot then
		local action_evaluations = nil
		if snapshot.action_evaluations then
			action_evaluations = {}
			for i = 1, #snapshot.action_evaluations do
				action_evaluations[i] = snapshot.action_evaluations[i]
			end
		end
		local guard_evaluations = nil
		if snapshot.guard_evaluations then
			guard_evaluations = {}
			for i = 1, #snapshot.guard_evaluations do
				guard_evaluations[i] = snapshot.guard_evaluations[i]
			end
		end
		return {
			trigger = snapshot.trigger,
			description = snapshot.description or description,
			event_name = snapshot.event_name,
			emitter = snapshot.emitter,
			handler_name = snapshot.handler_name,
			payload_summary = snapshot.payload_summary,
			timestamp = snapshot.timestamp,
			bubbled = snapshot.bubbled,
			action_evaluations = action_evaluations,
			guard_evaluations = guard_evaluations,
			last_transition = snapshot.last_transition and {
				from = snapshot.last_transition.from,
				to = snapshot.last_transition.to,
				execution = snapshot.last_transition.execution,
				status = snapshot.last_transition.status,
				guard_summary = snapshot.last_transition.guard_summary,
				reason = snapshot.last_transition.reason,
			} or nil,
		}
	end
	return {
		trigger = trigger,
		description = description,
		timestamp = $.platform.clock.now(),
	}
end

function state:create_event_context(event_name, emitter, payload)
	return {
		trigger = "event",
		description = "event:" .. event_name,
		event_name = event_name,
		emitter = emitter,
		timestamp = $.platform.clock.now(),
		payload_summary = payload ~= nil and describe_payload(payload) or nil,
	}
end

function state:create_input_context(pattern, player_index)
	return {
		trigger = "input",
		description = "input:" .. pattern,
		timestamp = $.platform.clock.now(),
		payload_summary = "player=" .. tostring(player_index),
	}
end

function state:create_process_input_context()
	return {
		trigger = "process-input",
		description = "process_input",
		timestamp = $.platform.clock.now(),
	}
end

function state:create_tick_context(handler_name)
	return {
		trigger = "tick",
		description = "tick:" .. handler_name,
		timestamp = $.platform.clock.now(),
	}
end

function state:create_run_check_context(index)
	return {
		trigger = "run-check",
		description = "run_check#" .. tostring(index),
		timestamp = $.platform.clock.now(),
	}
end

function state:create_enter_context(state_id)
	return {
		trigger = "enter",
		description = "enter:" .. tostring(state_id),
		timestamp = $.platform.clock.now(),
	}
end

function state:describe_string_handler(target_state)
	return "transition:" .. target_state
end

function state:describe_action_handler(spec)
	if type(spec) ~= "table" then
		return "handler"
	end
	if type(spec.go) == "function" then
		return "<anonymous>"
	end
	if type(spec.go) == "string" then
		return "do:" .. spec.go
	end
	return "handler"
end

function state:emit_event_dispatch_trace(event_name, emitter, detail, handled, bubbled, depth, context)
	if not should_trace_dispatch() then
		return
	end
	local ctx = context or self:create_fallback_snapshot("event", "event:" .. event_name, detail)
	local transition = ctx.last_transition
	local parts = { "[dispatch]" }
	parts[#parts + 1] = "event=" .. event_name
	parts[#parts + 1] = "handled=" .. tostring(handled)
	parts[#parts + 1] = "bubbled=" .. tostring(bubbled)
	if depth > 0 then
		parts[#parts + 1] = "depth=" .. tostring(depth)
	end
	parts[#parts + 1] = "emitter=" .. tostring(emitter)
	if ctx.handler_name then
		parts[#parts + 1] = "handler=" .. ctx.handler_name
	end
	parts[#parts + 1] = "state=" .. tostring(self.current_id)
	if transition then
		parts[#parts + 1] = "target=" .. tostring(transition.to)
		parts[#parts + 1] = "transition=" .. tostring(transition.execution)
		if transition.guard_summary then
			parts[#parts + 1] = "guards=" .. transition.guard_summary
		end
	else
		parts[#parts + 1] = "target=" .. tostring(self.current_id)
		parts[#parts + 1] = "transition=none"
	end
	local payload_summary = ctx.payload_summary or (detail ~= nil and describe_payload(detail) or nil)
	if payload_summary then
		parts[#parts + 1] = "payload=" .. payload_summary
	end
	if ctx.timestamp then
		parts[#parts + 1] = "ts=" .. tostring(ctx.timestamp)
	end
	append_trace_entry(self.id, table.concat(parts, " "))
end

function state:transition_to_next_state_if_provided(next_state)
	if not next_state then
		return
	end
	if is_no_op_string(next_state) then
		return
	end
	self:transition_to(next_state)
end

function state:handle_state_transition(action, event)
	if not action then
		return false
	end
	local t = type(action)
	if t == "string" then
		if is_no_op_string(action) then
			return true
		end
		self:transition_to(action)
		return true
	end
	if t ~= "table" then
		return false
	end
	local do_handler = action.go
	if not do_handler then
		return false
	end
	local dt = type(do_handler)
	if dt == "string" then
		if is_no_op_string(do_handler) then
			return true
		end
		self:append_action_evaluation("do:string=" .. do_handler)
		self:transition_to(do_handler)
		return true
	end
	if dt == "function" then
		local handler_event = event or EMPTY_GAME_EVENT
		local next_state = do_handler(self.target, self, handler_event)
		local detail = "do:<anonymous>"
		if next_state then
			detail = detail .. "->" .. tostring(next_state)
		end
		self:append_action_evaluation(detail)
		if not next_state then
			return true
		end
		if is_no_op_string(next_state) then
			return true
		end
		self:transition_to(next_state)
		return true
	end
	return false
end

function state:check_state_guard_conditions(target_state_id)
	local allowed = true
	local evaluations = {}

	local cur_def = self:current_state_definition()
	local exit_guard_def = cur_def.transition_guards
	local exit_guard = exit_guard_def and exit_guard_def.can_exit or nil
	if type(exit_guard) == "function" then
		local passed = exit_guard(self.target, self)
		local evaluation = {
			side = "exit",
			descriptor = "<anonymous>",
			passed = passed,
			defined = true,
			type = "function",
			reason = passed and nil or "exit guard returned false",
		}
		self:append_guard_evaluation(evaluation)
		evaluations[#evaluations + 1] = evaluation
		if not passed then
			allowed = false
		end
	else
		local evaluation
		if exit_guard == nil then
			evaluation = { side = "exit", descriptor = "<none>", passed = true, defined = false, type = "missing" }
		else
			evaluation = {
				side = "exit",
				descriptor = tostring(exit_guard),
				passed = true,
				defined = true,
				type = type(exit_guard) == "string" and "string" or "other",
				reason = "non-callable guard ignored",
			}
		end
		self:append_guard_evaluation(evaluation)
		evaluations[#evaluations + 1] = evaluation
	end

	if not allowed then
		local evaluation = {
			side = "enter",
			descriptor = "<not-evaluated>",
			passed = false,
			defined = false,
			type = "missing",
			reason = "enter guard skipped due to exit guard failure",
		}
		self:append_guard_evaluation(evaluation)
		evaluations[#evaluations + 1] = evaluation
		return { allowed = allowed, evaluations = evaluations }
	end

	local states = self:states_or_throw()
	local tgt = states[target_state_id]
	if not tgt then
		error("target state '" .. tostring(target_state_id) .. "' not found under '" .. tostring(self.id) .. "'.")
	end
	local enter_guard_def = self:child_definition_or_throw(target_state_id).transition_guards
	local enter_guard = enter_guard_def and enter_guard_def.can_enter or nil
	if type(enter_guard) == "function" then
		local passed = enter_guard(self.target, tgt)
		local evaluation = {
			side = "enter",
			descriptor = "<anonymous>",
			passed = passed,
			defined = true,
			type = "function",
			reason = passed and nil or "enter guard returned false",
		}
		self:append_guard_evaluation(evaluation)
		evaluations[#evaluations + 1] = evaluation
		if not passed then
			allowed = false
		end
	else
		local evaluation
		if enter_guard == nil then
			evaluation = { side = "enter", descriptor = "<none>", passed = true, defined = false, type = "missing" }
		else
			evaluation = {
				side = "enter",
				descriptor = tostring(enter_guard),
				passed = true,
				defined = true,
				type = type(enter_guard) == "string" and "string" or "other",
				reason = "non-callable guard ignored",
			}
		end
		self:append_guard_evaluation(evaluation)
		evaluations[#evaluations + 1] = evaluation
	end

	return { allowed = allowed, evaluations = evaluations }
end

function state:transition_to_state(state_id, exec_mode)
	if self.in_tick then
		self._transitions_this_tick = self._transitions_this_tick + 1
		if self._transitions_this_tick > MAX_TRANSITIONS_PER_TICK then
			error("transition limit exceeded in one tick for '" .. tostring(self.id) .. "'.")
		end
	end

	local diag_enabled = should_trace_transitions()
	local mode = exec_mode or "immediate"

	if self.critical_section_counter > 0 and mode == "immediate" then
		if diag_enabled then
			local context = self:resolve_context_snapshot(nil) or self:create_fallback_snapshot("manual", "queued-transition")
			local outcome = { from = self.current_id, to = state_id, execution = "queued", status = "queued", reason = "critical-section" }
			self:record_transition_outcome_on_context(outcome)
			self:emit_transition_trace({
				outcome = "queued",
				execution = "queued",
				from = self.current_id,
				to = state_id,
				context = context,
				queue_size = #self.transition_queue + 1,
				reason = "critical-section",
			})
			self.transition_queue[#self.transition_queue + 1] = { path = state_id, diag = context }
		else
			self.transition_queue[#self.transition_queue + 1] = { path = state_id }
		end
		return
	end

	if self.current_id == state_id then
		if diag_enabled then
			local context = self:resolve_context_snapshot(nil) or self:create_fallback_snapshot(mode == "deferred" and "queue-drain" or "manual", "noop-transition")
			self:record_transition_outcome_on_context({
				from = self.current_id,
				to = state_id,
				execution = mode,
				status = "noop",
				reason = "already-current",
			})
			self:emit_transition_trace({
				outcome = "noop",
				execution = mode,
				from = self.current_id,
				to = state_id,
				context = context,
				reason = "already-current",
			})
		end
		return
	end

	local guard_diagnostics = self:check_state_guard_conditions(state_id)
	if not guard_diagnostics.allowed then
		if diag_enabled then
			local context = self:resolve_context_snapshot(nil) or self:create_fallback_snapshot(mode == "deferred" and "queue-drain" or "manual", "guard-blocked")
			local outcome = {
				from = self.current_id,
				to = state_id,
				execution = mode,
				status = "blocked",
				guard_summary = self:format_guard_diagnostics(guard_diagnostics),
			}
			self:record_transition_outcome_on_context(outcome)
			self:emit_transition_trace({
				outcome = "blocked",
				execution = mode,
				from = self.current_id,
				to = state_id,
				context = context,
				guard = guard_diagnostics,
				reason = "guard",
			})
		end
		return
	end

	self:with_critical_section(function()
		local prev_id = self.current_id
		local prev_def = self:current_state_definition()
		local prev_states = self:states_or_throw()
		local prev_instance = prev_states[prev_id]
		if not prev_instance then
			error("previous state '" .. tostring(prev_id) .. "' not found in '" .. tostring(self.id) .. "'.")
		end

		local exit_handler = prev_def.exiting_state
		if type(exit_handler) == "function" then
			exit_handler(self.target, prev_instance)
		end
		prev_instance:deactivate_timelines()
		self:push_history(prev_id)

		self.current_id = state_id
		local cur = self.states[state_id]
		if not cur then
			error("state '" .. tostring(self.id) .. "' transitioned to '" .. tostring(state_id) .. "' but the instance was not created.")
		end
		local cur_def = self:current_state_definition()
		if cur_def.is_concurrent then
			error("cannot transition to parallel state '" .. tostring(state_id) .. "'.")
		end

		cur:activate_timelines()
		local enter_handler = cur_def.entering_state
		local next_state = nil
		if type(enter_handler) == "function" then
			next_state = self:run_with_transition_context(
				function()
					local ctx = self:create_enter_context(state_id)
					ctx.handler_name = "<anonymous>"
					return ctx
				end,
				function()
					return enter_handler(self.target, cur)
				end
			)
		end
		cur:transition_to_next_state_if_provided(next_state)

		if diag_enabled then
			local outcome = {
				from = prev_id,
				to = state_id,
				execution = mode,
				status = "success",
				guard_summary = self:format_guard_diagnostics(guard_diagnostics),
			}
			self:record_transition_outcome_on_context(outcome)
			self:emit_transition_trace({
				outcome = "success",
				execution = mode,
				from = prev_id,
				to = state_id,
				guard = guard_diagnostics,
			})
		end
	end)
end

function state:push_history(to_push)
	local cap = BST_MAX_HISTORY
	local tail_index = (self._hist_head + self._hist_size) % cap
	self._hist[tail_index + 1] = to_push
	if self._hist_size < cap then
		self._hist_size = self._hist_size + 1
	else
		self._hist_head = (self._hist_head + 1) % cap
	end
end

function state:pop_and_transition()
	if self._hist_size <= 0 then
		return
	end
	local cap = BST_MAX_HISTORY
	local tail_index = (self._hist_head + self._hist_size - 1 + cap) % cap
	local popped_state_id = self._hist[tail_index + 1]
	self._hist_size = self._hist_size - 1
	if popped_state_id then
		self:transition_to(popped_state_id)
	end
end

function state:get_history_snapshot()
	local out = {}
	for i = 1, self._hist_size do
		out[#out + 1] = self._hist[(self._hist_head + i - 1) % BST_MAX_HISTORY + 1]
	end
	return out
end

function state:transition_to_path(path)
	if type(path) == "table" then
		if #path == 0 then
			error("empty path is invalid.")
		end
		local ctx = self
		for i = 1, #path do
			local seg = path[i]
			local child, key = self:ensure_child(ctx, seg)
			if not child.definition.is_concurrent and ctx.current_id ~= key then
				ctx:transition_to_state(key)
			end
			ctx = child
		end
		return
	end

	local spec = state.parse_fs_path(path)
	if not spec.abs and spec.up == 0 and #spec.segs == 0 then
		error("empty path is invalid.")
	end
	local ctx = spec.abs and self.root or self
	for i = 1, spec.up do
		if not ctx.parent then
			error("path '" .. path .. "' attempts to go above root.")
		end
		ctx = ctx.parent
	end
	for i = 1, #spec.segs do
		local seg = spec.segs[i]
		local child, key = self:ensure_child(ctx, seg)
		if not child.definition.is_concurrent and ctx.current_id ~= key then
			ctx:transition_to_state(key)
		end
		ctx = child
	end
end

function state:transition_to(state_id)
	self:transition_to_path(state_id)
end

function state:path()
	if self:is_root() then
		return "/"
	end
	local segments = {}
	local node = self
	while node and not node:is_root() do
		segments[#segments + 1] = node.current_id
		node = node.parent
	end
	local path = {}
	for i = #segments, 1, -1 do
		path[#path + 1] = segments[i]
	end
	return "/" .. table.concat(path, "/")
end

state._path_cache = {}

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
	if string.sub(input, i, i) == "/" then
		abs = true
		i = i + 1
	end
	if not abs then
		if string.sub(input, i, i + 1) == "./" then
			i = i + 2
		else
			while string.sub(input, i, i + 2) == "../" do
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
		local c = string.sub(input, i, i)
		if c == "/" then
			i = i + 1
		elseif c == "[" and string.sub(input, i + 1, i + 1) == "\"" then
			i = i + 2
			local seg = ""
			local closed = false
			while i <= len do
				local ch = string.sub(input, i, i)
				i = i + 1
				if ch == "\\" then
					if i <= len then
						local esc = string.sub(input, i, i)
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
					if string.sub(input, i, i) == "]" then
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
			while i <= len and string.sub(input, i, i) ~= "/" do
				i = i + 1
			end
			push_seg(string.sub(input, start, i - 1))
		end
	end

	local cache_size = state.path_config.cache_size
	local cache_count = 0
	for _ in pairs(state._path_cache) do
		cache_count = cache_count + 1
	end
	if cache_count >= cache_size then
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
			local child, key = resolve_state_instance(ctx, seg)
			if not child then
				return false
			end
			if not child.definition.is_concurrent and ctx.current_id ~= key then
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

function state:handle_event(event_name, emitter_id, detail, event)
	if self.paused then
		return { handled = false }
	end
	local captured_context = nil
	local handled = self:with_critical_section(function()
		return self:run_with_transition_context(
			function()
				return self:create_event_context(event_name, emitter_id, detail)
			end,
			function(ctx)
				captured_context = ctx
				local handlers = self.definition.on
				if not handlers then
					return false
				end
				local spec = handlers[event_name]
				if not spec then
					return false
				end
				if type(spec) == "string" then
					ctx.handler_name = self:describe_string_handler(spec)
				else
					ctx.handler_name = self:describe_action_handler(spec)
				end
				return self:handle_state_transition(spec, event)
			end
		)
	end)
	if not should_trace_dispatch() and not should_trace_transitions() then
		return { handled = handled }
	end
	return { handled = handled, context = clone_snapshot(captured_context) }
end

function state:dispatch_event(event_or_name, payload)
	if self.paused then
		return false
	end
	local event_name = event_or_name
	local data = payload
	if type(event_or_name) == "table" then
		event_name = event_or_name.type
		data = event_or_name
	end
	local emitter_id = resolve_emitter_id(data, self.target_id)
	local detail = resolve_event_payload(data)

	if self.states and next(self.states) ~= nil and self.current_id then
		local child = self.states[self.current_id]
		if not child then
			error("current child '" .. tostring(self.current_id) .. "' not found in '" .. tostring(self.id) .. "'.")
		end
		local handled = child:dispatch_event(event_name, data)
		for _, concurrent in pairs(self.states) do
			if concurrent.definition.is_concurrent and concurrent ~= child then
				handled = concurrent:dispatch_event(event_name, data) or handled
			end
		end
		if handled then
			return true
		end
	end

	local current = self
	local depth = 0
	while current do
		local result = current:handle_event(event_name, emitter_id, detail, data)
		local bubbled = depth > 0 or (not result.handled and current.parent ~= nil)
		current:emit_event_dispatch_trace(event_name, emitter_id, detail, result.handled, bubbled, depth, result.context)
		if result.handled then
			return true
		end
		current = current.parent
		depth = depth + 1
	end
	return false
end

function state:dispatch_input_event(event_or_name, payload)
	if self.paused then
		return false
	end
	local event_name = event_or_name
	local data = payload
	if type(event_or_name) == "table" then
		event_name = event_or_name.type
		data = event_or_name
	end
	if self.states and next(self.states) ~= nil and self.current_id then
		local child = self.states[self.current_id]
		if not child then
			error("current child '" .. tostring(self.current_id) .. "' not found in '" .. tostring(self.id) .. "'.")
		end
		local handled = child:dispatch_input_event(event_name, data)
		for _, concurrent in pairs(self.states) do
			if concurrent.definition.is_concurrent and concurrent ~= child then
				handled = concurrent:dispatch_input_event(event_name, data) or handled
			end
		end
		if handled then
			return true
		end
	end

	local current = self
	while current do
		local handlers = current.definition.input_event_handlers
		if handlers then
			local spec = handlers[event_name]
			if current:handle_state_transition(spec, data) then
				return true
			end
		end
		current = current.parent
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
			local handled = self:run_with_transition_context(
				function()
					return self:create_input_context(pattern, player_index)
				end,
				function(ctx)
					if ctx then
						if type(handler) == "string" then
							ctx.handler_name = self:describe_string_handler(handler)
						else
							ctx.handler_name = self:describe_action_handler(handler)
						end
					end
					return self:handle_state_transition(handler)
				end
			)
			if handled and eval_mode == "first" then
				return
			end
		end
	end
end

function state:process_input()
	self:process_input_events()
	local process_input = self.definition.process_input
	local next_state = nil
	if type(process_input) == "function" then
		next_state = self:run_with_transition_context(
			function()
				local ctx = self:create_process_input_context()
				ctx.handler_name = "<anonymous>"
				return ctx
			end,
			function()
				return process_input(self.target, self, EMPTY_GAME_EVENT)
			end
		)
	end
	self:transition_to_next_state_if_provided(next_state)
end

function state:run_current_state()
	local tick_handler = self.definition.tick
	local next_state = nil
	if type(tick_handler) == "function" then
		next_state = self:run_with_transition_context(
			function()
				return self:create_tick_context("<anonymous>")
			end,
			function()
				return tick_handler(self.target, self, EMPTY_GAME_EVENT)
			end
		)
	end
	if next_state then
		self:transition_to_next_state_if_provided(next_state)
	end
end

function state:run_substate_machines()
	if not self.states or not self.current_id then
		return
	end
	local states = self.states
	local cur = states[self.current_id]
	if not cur then
		error("current state '" .. tostring(self.current_id) .. "' not found in '" .. tostring(self.id) .. "'.")
	end
	cur:tick()
	for id, s in pairs(states) do
		if id ~= self.current_id and s.definition.is_concurrent then
			s:tick()
		end
	end
end

function state:do_run_checks()
	if self.paused then
		return
	end
	self:run_checks_for_current_state()
end

function state:run_checks_for_current_state()
	local checks = self.definition.run_checks
	if not checks then
		return
	end
	for i = 1, #checks do
		local rc = checks[i]
		local handled = self:run_with_transition_context(
			function()
				return self:create_run_check_context(i - 1)
			end,
			function(ctx)
				if ctx then
					ctx.handler_name = self:describe_action_handler(rc)
				end
				return self:handle_state_transition(rc)
			end
		)
		if handled then
			break
		end
	end
end

function state:tick()
	if not self.definition or self.paused then
		return
	end
	self._transitions_this_tick = 0
	self:with_critical_section(function()
		self.in_tick = true
		self:run_substate_machines()
		self:process_input()
		self:run_current_state()
		self:do_run_checks()
		self.in_tick = false
	end)
end

function state:populate_states()
	local sdef = self.definition
	if not sdef or not sdef.states then
		self.states = {}
		return
	end
	local state_ids = {}
	for state_id in pairs(sdef.states) do
		state_ids[#state_ids + 1] = state_id
	end
	if #state_ids == 0 then
		self.states = {}
		return
	end
	self.states = {}
	for i = 1, #state_ids do
		local sdef_id = state_ids[i]
		local child_def = sdef.states[sdef_id]
		local child = state.new(child_def, self.target, self)
		self.states[sdef_id] = child
	end
	if not self.current_id then
		self.current_id = state_ids[1]
	end
end

function state:reset(reset_tree)
	local def = self.definition
	self.data = def.data and clone_defaults(def.data) or {}
	if reset_tree ~= false then
		self:reset_submachine(true)
	end
end

function state:reset_submachine(reset_tree)
	local def = self.definition
	self.current_id = def.initial
	self._hist_head = 0
	self._hist_size = 0
	self.paused = false
	self.data = def.data and clone_defaults(def.data) or {}
	if reset_tree ~= false and self.states then
		for _, child in pairs(self.states) do
			child:reset(reset_tree)
		end
	end
end

function state:dispose()
	self:deactivate_timelines()
	if self.states then
		for _, child in pairs(self.states) do
			child:dispose()
		end
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
	self._started = false
	self._event_subscriptions = {}
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

function statemachinecontroller:bind_machine(machine)
	local events = machine.definition.event_list
	if not events or #events == 0 then
		return
	end
	for i = 1, #events do
		local event = events[i]
		local key = machine.localdef_id .. ":" .. event.name
		if self._event_subscriptions[key] then
			goto continue
		end
		local disposer = machine.target.events:on({
			event = event.name,
			handler = function(evt)
				self:auto_dispatch(evt)
			end,
			subscriber = machine.target,
			persistent = true,
		})
		self._event_subscriptions[key] = disposer
		::continue::
	end
end

function statemachinecontroller:bind()
	for _, machine in pairs(self.statemachines) do
		self:bind_machine(machine)
	end
end

function statemachinecontroller:unbind()
	for _, disposer in pairs(self._event_subscriptions) do
		disposer()
	end
	self._event_subscriptions = {}
end

function statemachinecontroller:unsubscribe_events_for(machine, event_names)
	for i = 1, #event_names do
		local name = event_names[i]
		local key = machine.localdef_id .. ":" .. name
		local disposer = self._event_subscriptions[key]
		if disposer then
			disposer()
			self._event_subscriptions[key] = nil
		end
	end
end

function statemachinecontroller:auto_dispatch(event)
	if self.target.eventhandling_enabled == false then
		return
	end
	if not event.emitter then
		event.emitter = self.target
	end
	self:dispatch(event)
end

function statemachinecontroller:start()
	if self._started then
		return
	end
	self:bind()
	for _, machine in pairs(self.statemachines) do
		machine:start()
	end
	self._started = true
	self:resume()
end

function statemachinecontroller:tick()
	if not self.tick_enabled then
		return
	end
	for _, machine in pairs(self.statemachines) do
		machine:tick()
	end
end

function statemachinecontroller:dispatch(event_or_name, payload)
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

function statemachinecontroller:transition_to(path)
	local machine_id, state_path = string.match(path, "^(.-):/(.+)$")
	if not machine_id then
		machine_id = path
		state_path = path
	end
	local machine = self.statemachines[machine_id]
	if not machine then
		error("no machine with id '" .. tostring(machine_id) .. "'")
	end
	machine:transition_to_path(state_path)
end

function statemachinecontroller:matches_state_path(path)
	local machine_id, state_path = string.match(path, "^(.-):/(.+)$")
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

function statemachinecontroller:run_statemachine(id)
	local machine = self.statemachines[id]
	if not machine then
		error("no machine with id '" .. tostring(id) .. "'")
	end
	machine:tick()
end

function statemachinecontroller:run_all_statemachines()
	for id in pairs(self.statemachines) do
		self:run_statemachine(id)
	end
end

function statemachinecontroller:reset_statemachine(id)
	local machine = self.statemachines[id]
	if not machine then
		error("no machine with id '" .. tostring(id) .. "'")
	end
	machine:reset()
end

function statemachinecontroller:reset_all_statemachines()
	for id in pairs(self.statemachines) do
		self:reset_statemachine(id)
	end
end

function statemachinecontroller:pop_statemachine(id)
	local machine = self.statemachines[id]
	if not machine then
		error("no machine with id '" .. tostring(id) .. "'")
	end
	machine:pop_and_transition()
end

function statemachinecontroller:pop_all_statemachines()
	for id in pairs(self.statemachines) do
		self:pop_statemachine(id)
	end
end

function statemachinecontroller:switch_state(id, path)
	local machine = self.statemachines[id]
	if not machine then
		error("no machine with id '" .. tostring(id) .. "'")
	end
	machine:transition_to(path)
end

function statemachinecontroller:pause_statemachine(id)
	local machine = self.statemachines[id]
	if not machine then
		error("no machine with id '" .. tostring(id) .. "'")
	end
	machine.paused = true
end

function statemachinecontroller:resume_statemachine(id)
	local machine = self.statemachines[id]
	if not machine then
		error("no machine with id '" .. tostring(id) .. "'")
	end
	machine.paused = false
end

function statemachinecontroller:pause_all_statemachines()
	for id in pairs(self.statemachines) do
		self:pause_statemachine(id)
	end
end

function statemachinecontroller:pause_all_except(to_exclude_id)
	for id in pairs(self.statemachines) do
		if id ~= to_exclude_id then
			self:pause_statemachine(id)
		end
	end
end

function statemachinecontroller:resume_all_statemachines()
	for id in pairs(self.statemachines) do
		self:resume_statemachine(id)
	end
end

function statemachinecontroller:pause()
	self.tick_enabled = false
end

function statemachinecontroller:resume()
	self.tick_enabled = true
end

function statemachinecontroller:dispose()
	self:pause()
	self._started = false
	for _, machine in pairs(self.statemachines) do
		machine:dispose()
	end
	self:unbind()
	self.statemachines = {}
end

return {
	statedefinition = statedefinition,
	state = state,
	statemachinecontroller = statemachinecontroller,
}
