-- fsm.lua
-- finite state machine runtime for system rom
--
-- DESIGN PRINCIPLES — FSM authoring rules
--
-- 1. NO CROSS-STATE FLAGS ON SELF.
--    Fields on self persist across state transitions.  A boolean set in one
--    state's entering_state and read in a different state invisibly couples
--    states that should be independent, hides the real control flow, and is a
--    subtle bug waiting to happen.
--    Instead: create two distinct FSM states and navigate to the correct one
--    from the decision point.  Share setup logic in a method on the object.
--
--    WRONG — cross-state boolean flag:
--      state_a = { entering_state = function(self) self.mode_flag = true end }
--      state_b = { entering_state = function(self)
--          if self.mode_flag then ... end  -- invisible cross-state coupling!
--      end }
--    RIGHT — two explicit states, shared helper method:
--      variant_normal   = { entering_state = function(self) self:setup(false) end }
--      variant_extended = { entering_state = function(self) self:setup(true)  end }
--      -- decision state navigates to the right variant:
--      on = { ['result'] = function(self, _s, e)
--          return e.extended and '/variant_extended' or '/variant_normal'
--      end }
--
-- 2. REQUEST / REPLY WITHIN STATES.
--    A state starts an async operation by emitting a request event in
--    entering_state, then waits for the reply purely via on = { ... }.
--    No polling, no pending flag, no sub-state boolean — the FSM state IS
--    the waiting mechanism.
--
--      waiting_for_answer = {
--        entering_state = function(self)
--            self.events:emit('query.requested')
--        end,
--        on = { ['query.answered'] = function(self, _s, e)
--            return e.success and '/state_success' or '/state_failure'
--        end },
--      }
--
-- 3. SHARED TIMELINE DEFINITIONS.
--    Timeline private to one state: declare inside that state's `timelines`
--    block using a `def` sub-table.  The runtime calls timeline.new(def)
--    automatically — no manual timeline.new() call is needed in cart code.
--
--    Timeline shared by multiple states: declare once in the root-level
--    `timelines` block of the FSM (before `states`) with `autoplay = false`
--    (registration only).  Each state adds only the behaviour config
--    (autoplay, stop_on_exit, on_end, …) without repeating `def`.
--
--    WRONG — duplicate def copied into every state that uses the timeline:
--      state_a = { timelines = { [id] = { def = { frames = ..., playback_mode = 'once' }, autoplay = true } } }
--      state_b = { timelines = { [id] = { def = { frames = ..., playback_mode = 'once' }, autoplay = true } } }
--    RIGHT — def at FSM root once, behaviour-only config in each state:
--      (root) timelines = { [id] = { def = { frames = ..., playback_mode = 'once' }, autoplay = false } }
--      state_a = { timelines = { [id] = { autoplay = true, stop_on_exit = true } } }
--      state_b = { timelines = { [id] = { autoplay = true, stop_on_exit = true, on_end = '/other' } } }
--
-- 4. on_end AND on_frame CALLBACKS IN TIMELINE CONFIG.
--    Declare timeline end/frame callbacks directly inside the state's timeline
--    config using on_end / on_frame.  Do NOT register them manually under
--    'on' using the internal 'timeline.end.<id>' / 'timeline.frame.<id>' keys
--    — those are implementation details.  The runtime maps on_end/on_frame to
--    the correct 'on' keys automatically.
--
--    WRONG — manual internal event key:
--      on = { ['timeline.end.my_id'] = function(self) return '/next' end }
--    RIGHT — on_end directly in the timeline binding:
--      timelines = { [my_id] = { ..., on_end = '/next' } }
--      timelines = { [my_id] = { ..., on_end = function(self) ... end } }
--      timelines = { [my_id] = { ..., on_frame = function(self, _s, e) ... end } }
--
-- 5. FORBIDDEN LEGACY FIELDS.
--    The following field names are rejected at runtime (and caught by the
--    Lua linter) and must never appear in FSM state definitions:
--      'tick'   — use 'update'  (the FSM calls update(), not tick())
--    Using these names silently does nothing on older runtimes and errors on
--    current ones.  Keep state definitions clean.

local fsm_trace = require("fsm_trace")
local clear_map = require("clear_map")
local timeline_module = require("timeline")

local statedefinition = {}
statedefinition.__index = statedefinition

local start_state_prefixes = { ["_"] = true, ["#"] = true }
local no_op_aliases = { ["no-op"] = true, ["noop"] = true, ["no_op"] = true }
local ignored_relative_segments = { [""] = true, ["."] = true }
local input_eval_modes = { ["first"] = true, ["all"] = true }

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

local function validate_tag_list(values, owner_tag, field_name)
	if type(values) ~= "table" then
		error("tag derivation '" .. tostring(owner_tag) .. "' field '" .. tostring(field_name) .. "' must be an array of tags.")
	end
	for i = 1, #values do
		local source_tag = values[i]
		if type(source_tag) ~= "string" then
			error("tag derivation '" .. tostring(owner_tag) .. "' field '" .. tostring(field_name) .. "' contains non-string value at index " .. tostring(i) .. ".")
		end
	end
	if #values == 0 then
		error("tag derivation '" .. tostring(owner_tag) .. "' field '" .. tostring(field_name) .. "' cannot be empty.")
	end
	return values
end

local function compile_tag_derivations(raw)
	if raw == nil then
		return nil
	end
	if type(raw) ~= "table" then
		error("fsm.tag_derivations must be a table.")
	end
	local derived_tags = {}
	for derived_tag in pairs(raw) do
		derived_tags[#derived_tags + 1] = derived_tag
	end
	if #derived_tags == 0 then
		return nil
	end
	table.sort(derived_tags)
	local compiled = {}
	for i = 1, #derived_tags do
		local derived_tag = derived_tags[i]
		if type(derived_tag) ~= "string" then
			error("fsm.tag_derivations contains non-string derived tag key.")
		end
		local spec = raw[derived_tag]
		local rule = {
			derived_tag = derived_tag,
			any = nil,
			all = nil,
		}
		if type(spec) ~= "table" then
			error("tag derivation '" .. tostring(derived_tag) .. "' must be an array or table.")
		end
		if spec[1] ~= nil then
			rule.any = validate_tag_list(spec, derived_tag, "any")
		else
			if spec.any ~= nil then
				rule.any = validate_tag_list(spec.any, derived_tag, "any")
			end
			if spec.all ~= nil then
				rule.all = validate_tag_list(spec.all, derived_tag, "all")
			end
		end
		if rule.any == nil and rule.all == nil then
			error("tag derivation '" .. tostring(derived_tag) .. "' must define an array, or an 'any'/'all' array.")
		end
		compiled[#compiled + 1] = rule
	end
	return compiled
end

local function validate_optional_state_function(def_id, field_name, value)
	if value ~= nil and type(value) ~= "function" then
		error(
			"state definition '" .. tostring(def_id)
				.. "' field '" .. tostring(field_name)
				.. "' must be a function, but got " .. type(value) .. "."
		)
	end
end

local function validate_no_op_alias_value(def_id, field_name, value)
	if type(value) ~= "string" then
		return
	end
	if no_op_aliases[value] then
		return
	end
	local lowered = string.lower(value)
	if no_op_aliases[lowered] then
		error(
			"state definition '" .. tostring(def_id)
				.. "' field '" .. tostring(field_name)
				.. "' uses invalid no-op alias '" .. tostring(value)
				.. "'. use lowercase '" .. lowered .. "'."
		)
	end
end

local function validate_transition_spec(def_id, field_name, spec)
	if spec == nil then
		return
	end
	local kind = type(spec)
	if kind == "string" then
		validate_no_op_alias_value(def_id, field_name, spec)
		return
	end
	if kind == "function" then
		return
	end
	if kind ~= "table" then
		error(
			"state definition '" .. tostring(def_id)
				.. "' field '" .. tostring(field_name)
				.. "' must be a string, function, or transition table, but got " .. kind .. "."
		)
	end
	local go = spec.go
	if go == nil then
		return
	end
	local go_kind = type(go)
	if go_kind == "string" then
		validate_no_op_alias_value(def_id, field_name .. ".go", go)
		return
	end
	if go_kind ~= "function" then
		error(
			"state definition '" .. tostring(def_id)
				.. "' field '" .. tostring(field_name)
				.. ".go' must be a string or function, but got " .. go_kind .. "."
		)
	end
end

local function validate_transition_spec_map(def_id, field_name, map)
	if map == nil then
		return
	end
	if type(map) ~= "table" then
		error(
			"state definition '" .. tostring(def_id)
				.. "' field '" .. tostring(field_name)
				.. "' must be a table, but got " .. type(map) .. "."
		)
	end
	for key, spec in pairs(map) do
		validate_transition_spec(def_id, field_name .. "[" .. tostring(key) .. "]", spec)
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
	self.initial = def and def.initial
	self.on = {}
	if def and def.on then
		for k, v in pairs(def.on) do
			self.on[k] = v
		end
	end
	if def and def.timelines then
		for tl_id, tl_def in pairs(def.timelines) do
			if tl_def.on_end ~= nil then
				local key = 'timeline.end.' .. tl_id
				if self.on[key] ~= nil then
					error("state '" .. tostring(self.def_id) .. "': 'on_end' for timeline '" .. tl_id .. "' conflicts with an existing 'on' entry")
				end
				self.on[key] = tl_def.on_end
			end
			if tl_def.on_frame ~= nil then
				local key = 'timeline.frame.' .. tl_id
				if self.on[key] ~= nil then
					error("state '" .. tostring(self.def_id) .. "': 'on_frame' for timeline '" .. tl_id .. "' conflicts with an existing 'on' entry")
				end
				self.on[key] = tl_def.on_frame
			end
		end
	end
	if def and def.tick ~= nil then
		error("state definition '" .. tostring(self.def_id) .. "' field 'tick' is not supported. Use 'update'.")
	end
	if def and def.process_input ~= nil then
		error("state definition '" .. tostring(self.def_id) .. "' field 'process_input' is not supported.")
	end
	if def and def.run_checks ~= nil then
		error("state definition '" .. tostring(self.def_id) .. "' field 'run_checks' is not supported.")
	end
	self.update = def and def.update
	self.entering_state = def and def.entering_state
	self.exiting_state = def and (def.exiting_state or def.leaving_state)
	self.input_event_handlers = def and def.input_event_handlers or {}
	self.is_concurrent = def and def.is_concurrent or false
	self.input_eval = def and def.input_eval
	if self.input_eval ~= nil and not input_eval_modes[self.input_eval] then
		error(
			"state definition '" .. tostring(self.def_id)
				.. "' has invalid input_eval '" .. tostring(self.input_eval)
				.. "'. expected 'first' or 'all', but got " .. type(self.input_eval) .. "."
		)
	end
	validate_optional_state_function(self.def_id, "update", self.update)
	validate_optional_state_function(self.def_id, "entering_state", self.entering_state)
	validate_optional_state_function(self.def_id, "exiting_state", self.exiting_state)
	validate_transition_spec_map(self.def_id, "on", self.on)
	validate_transition_spec_map(self.def_id, "input_event_handlers", self.input_event_handlers)
	self.event_list = def and def.event_list
	self.timelines = def and def.timelines
	self.transition_guards = def and def.transition_guards
	self.tags = def and def.tags
	self.tag_derivations = nil
	if self.root == self then
		local raw_tag_derivations = def and (def.tag_derivations or def.derived_tags or def.tag_groups)
		self.tag_derivations = compile_tag_derivations(raw_tag_derivations)
	end

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
	trace_transitions = false,
	trace_dispatch = false,
	mirror_to_vm = false,
	max_entries_per_machine = 512,
}

local bst_max_history = 10
local max_transitions_per_update = 1000
local empty_game_event = { type = "__fsm.synthetic__", emitter = nil, timestamp = 0 }
local target_state_tag_refs = setmetatable({}, { __mode = "k" })

local function get_target_state_tag_refs(target)
	local refs = target_state_tag_refs[target]
	if refs then
		return refs
	end
	refs = {}
	target_state_tag_refs[target] = refs
	return refs
end

local function increment_target_state_tag_ref(target, tag)
	local refs = get_target_state_tag_refs(target)
	local count = refs[tag]
	if count then
		refs[tag] = count + 1
		return
	end
	refs[tag] = 1
	target:add_tag(tag)
end

local function decrement_target_state_tag_ref(target, tag)
	local refs = target_state_tag_refs[target]
	if not refs then
		error("missing state-tag reference map for target while removing '" .. tostring(tag) .. "'.")
	end
	local count = refs[tag]
	if not count then
		error("missing state-tag reference for '" .. tostring(tag) .. "'.")
	end
	if count == 1 then
		refs[tag] = nil
		target:remove_tag(tag)
		if next(refs) == nil then
			target_state_tag_refs[target] = nil
		end
		return
	end
	refs[tag] = count - 1
end

local function clone_defaults(source)
	local out = {}
	for k, v in pairs(source) do
		out[k] = v
	end
	return out
end

local function should_trace_transitions()
	local diag = state.diagnostics
	return diag and (diag.trace_transitions)
end

local function should_trace_dispatch()
	local diag = state.diagnostics
	return diag and (diag.trace_dispatch)
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
		if k ~= "type" and k ~= "emitter" and k ~= "timestamp" and k ~= "timestamp" and k ~= "target" then
			if not payload then
				payload = {}
			end
			payload[k] = v
		end
	end
	return payload
end

local function is_no_op_string(value)
	return type(value) == "string" and no_op_aliases[value] ~= nil
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

local function build_state_tag_lookup(tags)
	if not tags then
		return nil
	end
	local lookup = {}
	for i = 1, #tags do
		lookup[tags[i]] = true
	end
	return lookup
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
	self.in_update = false
	self._transitions_this_update = 0
	self.paused = false
	self.tag_lookup = build_state_tag_lookup(definition.tags)
	self._applied_state_tags = nil
	self._tag_sync_scratch = nil
	self._tag_remove_scratch = nil
	self:populate_states()
	self:reset(true)
	return self
end

function state:is_root()
	return not self.parent
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
	if config.def ~= nil and type(config.def) ~= "table" then
		error("timeline '" .. tostring(key) .. "' field 'def' must be a table.")
	end
	local autoplay
	if config.autoplay ~= nil then
		autoplay = config.autoplay
	else
		autoplay = true
	end
	local stop_on_exit
	if config.stop_on_exit ~= nil then
		stop_on_exit = config.stop_on_exit
	else
		stop_on_exit = true
	end
	return {
		id = config.id or key,
		def = config.def,
		autoplay = autoplay,
		stop_on_exit = stop_on_exit,
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
			if binding.def then
				local def = binding.def
				if def.id == nil then
					def.id = binding.id
				end
				self.target:define_timeline(timeline_module.new(def))
			end
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
		local start_next
		if enter_start then
			start_next = enter_start(self.target, start_instance)
		end
		start_instance:transition_to_next_state_if_provided(start_next)
	end)

	start_instance:start()
	self.root:sync_target_state_tags()
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
	local ok, r1, r2, r3, r4, r5, r6, r7, r8 = pcall(fn)
	self:leave_critical_section()
	if not ok then
		error(r1)
	end
	return r1, r2, r3, r4, r5, r6, r7, r8
end

	function state:process_transition_queue()
		if self.is_processing_queue then
			return
		end
		self.is_processing_queue = true
		local ok, err = pcall(function()
			local i = 1
			while i <= #self.transition_queue do
				local t = self.transition_queue[i]
				if should_trace_transitions() then
					self:run_with_transition_context(
						function()
							return self:hydrate_context(t.diag, "queue-drain", "queued-execution")
						end,
						function()
							self:transition_to(t.path)
						end
					)
				else
					self:transition_to(t.path)
				end
				i = i + 1
			end
			self.transition_queue = {}
		end)
		self.is_processing_queue = false
		if not ok then
			error(err)
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
	local ok, r1, r2, r3, r4, r5, r6, r7, r8 = pcall(fn, ctx)
	stack[#stack] = nil
	if #stack == 0 then
		self._transition_context_stack = nil
	end
	if not ok then
		error(r1)
	end
	return r1, r2, r3, r4, r5, r6, r7, r8
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
	return self:peek_transition_context()
end

function state:emit_transition_trace(entry)
	if not should_trace_transitions() then
		return
	end
	local context = self:resolve_context_snapshot(entry.context)
	local message = fsm_trace.compose_transition_trace_message({
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

function state:create_fallback_snapshot(trigger, description, payload)
	return {
		trigger = trigger,
		description = description,
		timestamp = $.platform.clock.now(),
		payload_summary = payload ~= nil and fsm_trace.describe_payload(payload),
	}
end

function state:hydrate_context(snapshot, trigger, description)
	if snapshot then
		local action_evaluations
		if snapshot.action_evaluations then
			action_evaluations = {}
			for i = 1, #snapshot.action_evaluations do
				action_evaluations[i] = snapshot.action_evaluations[i]
			end
		else
			action_evaluations = nil
		end
		local guard_evaluations
		if snapshot.guard_evaluations then
			guard_evaluations = {}
			for i = 1, #snapshot.guard_evaluations do
				guard_evaluations[i] = snapshot.guard_evaluations[i]
			end
		else
			guard_evaluations = nil
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
				},
		}
	end
	return {
		trigger = trigger,
		description = description,
		timestamp = $.platform.clock.now(),
	}
end

function state:emit_event_dispatch_trace(event_name, emitter, detail, handled, bubbled, depth, context)
	if not should_trace_dispatch() then
		return
	end
	local ctx = context or self:create_fallback_snapshot("event", "event:" .. event_name, detail)
	local message = fsm_trace.compose_event_dispatch_trace_message({
		event_name = event_name,
		emitter = emitter,
		detail = detail,
		handled = handled,
		bubbled = bubbled,
		depth = depth,
		context = ctx,
		current_id = self.current_id,
	})
	append_trace_entry(self.id, message)
end

function state:transition_to_next_state_if_provided(next_state)
	if not next_state or is_no_op_string(next_state) then
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
	if t == "function" then
		local handler_event = event or empty_game_event
		local next_state = action(self.target, self, handler_event)
		local detail = "do:<anonymous>"
		if next_state then
			detail = detail .. "->" .. tostring(next_state)
		end
		self:append_action_evaluation(detail)
		if next_state and not is_no_op_string(next_state) then
			self:transition_to(next_state)
		end
		return true
	end
	if t ~= "table" then
		return false
	end
	-- Optional emitter filter: { emitter = 'some_id', go = handler_or_path }
	-- When set, the handler only fires when the event came from an emitter
	-- whose ID matches action.emitter.  Any other emitter leaves the event
	-- unhandled (returns false), allowing it to bubble normally.
	if action.emitter then
		if resolve_emitter_id(event, nil) ~= action.emitter then
			return false
		end
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
		local handler_event = event or empty_game_event
		local next_state = do_handler(self.target, self, handler_event)
		local detail = "do:<anonymous>"
		if next_state then
			detail = detail .. "->" .. tostring(next_state)
		end
		self:append_action_evaluation(detail)
		if next_state and not is_no_op_string(next_state) then
			self:transition_to(next_state)
		end
		return true
	end
	return false
end

function state:check_state_guard_conditions(target_state_id)
	local allowed
	local evaluations = {}

	local cur_def = self:current_state_definition()
	local exit_guard_def = cur_def.transition_guards
	local exit_guard = exit_guard_def and exit_guard_def.can_exit
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
		allowed = passed
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
		allowed = true
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
	local enter_guard = enter_guard_def and enter_guard_def.can_enter
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

function state:transition_to_state(state_id)
	if self.in_update then
		self._transitions_this_update = self._transitions_this_update + 1
		if self._transitions_this_update > max_transitions_per_update then
			error("transition limit exceeded in one tick for '" .. tostring(self.id) .. "'.")
		end
	end

	local diag_enabled = should_trace_transitions()
	local execution = self.is_processing_queue and "deferred" or "manual"

	if self.critical_section_counter > 0 then
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
			local context = self:resolve_context_snapshot(nil) or self:create_fallback_snapshot(execution == "deferred" and "queue-drain" or "manual", "noop-transition")
			self:record_transition_outcome_on_context({
				from = self.current_id,
				to = state_id,
				execution = execution,
				status = "noop",
				reason = "already-current",
			})
			self:emit_transition_trace({
				outcome = "noop",
				execution = execution,
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
			local context = self:resolve_context_snapshot(nil) or self:create_fallback_snapshot(execution == "deferred" and "queue-drain" or "manual", "guard-blocked")
			local outcome = {
				from = self.current_id,
				to = state_id,
				execution = execution,
				status = "blocked",
				guard_summary = fsm_trace.format_guard_diagnostics(guard_diagnostics),
			}
			self:record_transition_outcome_on_context(outcome)
			self:emit_transition_trace({
				outcome = "blocked",
				execution = execution,
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
		local next_state
		if enter_handler then
			if should_trace_transitions() then
				next_state = self:run_with_transition_context(
					function()
						local ctx = fsm_trace.create_enter_context(state_id)
						ctx.handler_name = "<anonymous>"
						return ctx
					end,
					function()
						return enter_handler(self.target, cur)
					end
				)
			else
				next_state = enter_handler(self.target, cur)
			end
		end
		cur:transition_to_next_state_if_provided(next_state)

		if diag_enabled then
			local outcome = {
				from = prev_id,
				to = state_id,
				execution = execution,
				status = "success",
				guard_summary = fsm_trace.format_guard_diagnostics(guard_diagnostics),
			}
			self:record_transition_outcome_on_context(outcome)
			self:emit_transition_trace({
				outcome = "success",
				execution = execution,
				from = prev_id,
				to = state_id,
				guard = guard_diagnostics,
			})
		end
	end)
end

function state:push_history(to_push)
	local cap = bst_max_history
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
		if self.parent ~= nil then
			self.parent:pop_and_transition()
		end
		return
	end
	local cap = bst_max_history
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
		out[#out + 1] = self._hist[(self._hist_head + i - 1) % bst_max_history + 1]
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
	self.root:sync_target_state_tags()
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
	local abs
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
		if ignored_relative_segments[seg] then
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
			local closed
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

function state:matches_state_tag(tag)
	local tags = self.tag_lookup
	if tags and tags[tag] then
		return true
	end

	if self.current_id then
		local child = self.states[self.current_id]
		if not child then
			error("current child '" .. tostring(self.current_id) .. "' not found in '" .. tostring(self.id) .. "'.")
		end
		if child:matches_state_tag(tag) then
			return true
		end
		for id, concurrent in pairs(self.states) do
			if concurrent.definition.is_concurrent and id ~= self.current_id then
				if concurrent:matches_state_tag(tag) then
					return true
				end
			end
		end
	end
	return false
end

function state:collect_active_state_tags(out)
	local tags = self.tag_lookup
	if tags then
		for tag in pairs(tags) do
			out[tag] = true
		end
	end
	if self.current_id then
		local child = self.states[self.current_id]
		if not child then
			error("current child '" .. tostring(self.current_id) .. "' not found in '" .. tostring(self.id) .. "'.")
		end
		child:collect_active_state_tags(out)
		for id, concurrent in pairs(self.states) do
			if concurrent.definition.is_concurrent and id ~= self.current_id then
				concurrent:collect_active_state_tags(out)
			end
		end
	end
end

local function matches_tag_derivation_rule(rule, tags)
	local all = rule.all
	if all then
		for i = 1, #all do
			if not tags[all[i]] then
				return false
			end
		end
	end
	local any = rule.any
	if any then
		for i = 1, #any do
			if tags[any[i]] then
				return true
			end
		end
		return false
	end
	return true
end

function state:collect_derived_state_tags(out)
	local root = self:is_root() and self or self.root
	local derivations = root.definition.tag_derivations
	if derivations == nil then
		return
	end
	local unresolved = #derivations
	while unresolved > 0 do
		local changed
		for i = 1, #derivations do
			local rule = derivations[i]
			local derived_tag = rule.derived_tag
			if not out[derived_tag] and matches_tag_derivation_rule(rule, out) then
				out[derived_tag] = true
				unresolved = unresolved - 1
				changed = true
			end
		end
		if not changed then
			break
		end
	end
end

function state:sync_target_state_tags()
	local root = self:is_root() and self or self.root
	local target = root.target
	if target == nil then
		return
	end
	local next_tags = root._tag_sync_scratch
	if not next_tags then
		next_tags = {}
		root._tag_sync_scratch = next_tags
	else
		clear_map(next_tags)
	end
	root:collect_active_state_tags(next_tags)
	root:collect_derived_state_tags(next_tags)
	local prev_tags = root._applied_state_tags
	if not prev_tags then
		prev_tags = {}
		root._applied_state_tags = prev_tags
	end
	local remove_tags = root._tag_remove_scratch
	if not remove_tags then
		remove_tags = {}
		root._tag_remove_scratch = remove_tags
	else
		clear_map(remove_tags)
	end
	for tag in pairs(prev_tags) do
		if not next_tags[tag] then
			remove_tags[tag] = true
		end
	end
	for tag in pairs(remove_tags) do
		decrement_target_state_tag_ref(target, tag)
		prev_tags[tag] = nil
	end

	for tag in pairs(next_tags) do
		if not prev_tags[tag] then
			increment_target_state_tag_ref(target, tag)
			prev_tags[tag] = true
		end
	end
end

function state:handle_event(event_name, emitter_id, detail, event)
	if self.paused then
		return { handled = false }
	end
	local trace_transitions = should_trace_transitions()
	local captured_context = nil
	local handled
	if trace_transitions then
		handled = self:with_critical_section(function()
			return self:run_with_transition_context(
				function()
					return fsm_trace.create_event_context(event_name, emitter_id, detail)
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
					ctx.handler_name = fsm_trace.describe_transition_handler(spec)
					return self:handle_state_transition(spec, event)
				end
			)
		end)
	else
		handled = self:with_critical_section(function()
			local handlers = self.definition.on
			if not handlers then
				return false
			end
			local spec = handlers[event_name]
			if not spec then
				return false
			end
			return self:handle_state_transition(spec, event)
		end)
	end
	if not should_trace_dispatch() and not trace_transitions then
		return { handled = handled }
	end
	return { handled = handled, context = captured_context }
end

function state:dispatch_event(event_or_name, payload)
	if self.paused then
		return false
	end
	local event_name
	local data
	if type(event_or_name) == "table" then
		event_name = event_or_name.type
		data = event_or_name
	else
		event_name = event_or_name
		data = payload
	end
	local trace_dispatch = should_trace_dispatch()
	local trace_transitions = should_trace_transitions()
	local emitter_id
	local detail
	if trace_dispatch or trace_transitions then
		emitter_id = resolve_emitter_id(data, self.target_id)
		detail = resolve_event_payload(data)
	else
		detail = nil
	end

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

function state:resolve_input_eval_mode()
	local node = self
	while node do
		local mode = node.definition.input_eval
		if mode and input_eval_modes[mode] then
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
	local trace_transitions = should_trace_transitions()
	local player_index = self.target.player_index or 1
	local eval_mode = self:resolve_input_eval_mode()
	for pattern, handler in pairs(handlers) do
		if action_triggered(pattern, player_index) then
			local handled
			if trace_transitions then
				handled = self:run_with_transition_context(
					function()
						return fsm_trace.create_input_context(pattern, player_index)
					end,
					function(ctx)
						ctx.handler_name = fsm_trace.describe_transition_handler(handler)
						return self:handle_state_transition(handler)
					end
				)
			else
				handled = self:handle_state_transition(handler)
			end
			if handled and eval_mode == "first" then
				return
			end
		end
	end
end

function state:run_current_state()
	local update_handler = self.definition.update
	if not update_handler then
		return
	end
	local next_state
	if should_trace_transitions() then
		next_state = self:run_with_transition_context(
			function()
				return fsm_trace.create_update_context("<anonymous>")
			end,
			function()
				return update_handler(self.target, self, empty_game_event)
			end
		)
	else
		next_state = update_handler(self.target, self, empty_game_event)
	end
	self:transition_to_next_state_if_provided(next_state)
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
	cur:update()
	for id, s in pairs(states) do
		if id ~= self.current_id and s.definition.is_concurrent then
			s:update()
		end
	end
end

function state:update()
	if self.paused then
		return
	end
	self._transitions_this_update = 0
	self:with_critical_section(function()
		self.in_update = true
		self:run_substate_machines()
		self:process_input_events()
		self:run_current_state()
		self.in_update = false
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
	local should_reset = reset_tree
	if should_reset == nil then
		should_reset = true
	end
	if should_reset then
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
	if (reset_tree == nil or reset_tree) and self.states then
		for _, child in pairs(self.states) do
			child:reset(reset_tree)
		end
	end
	if self:is_root() then
		self:sync_target_state_tags()
	end
end

function state:dispose()
	self:deactivate_timelines()
		if self:is_root() then
			local applied = self._applied_state_tags
			if applied then
				for tag in pairs(applied) do
					decrement_target_state_tag_ref(self.target, tag)
				end
			end
			self._applied_state_tags = nil
			self._tag_sync_scratch = nil
			self._tag_remove_scratch = nil
		end
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
	self.update_enabled = true
	if opts.update_enabled ~= nil then
		self.update_enabled = opts.update_enabled
	end
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
	local def
	if definition and definition.__is_state_definition then
		def = definition
	else
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
	if not self.target.fsm_dispatch_enabled then
		return
	end
	if not event.emitter then
		event.emitter = self.target
	end
	self:dispatch(event)
end

-- statemachinecontroller:start(): start all managed FSMs from their initial
-- state.  Called automatically by worldobject:activate(); do not call
-- manually in normal cart code.
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

function statemachinecontroller:update()
	if not self.update_enabled then
		return
	end
	for _, machine in pairs(self.statemachines) do
		machine:update()
	end
end

-- statemachinecontroller:dispatch(event_or_name, payload): deliver an event
-- to all FSMs managed by this controller.  The active state's `on` table and
-- `input_event_handlers` are consulted.  Returns true if any state handled it.
-- In cart code, call self.sc:dispatch() (via self:dispatch_state_event()) or
-- use the FSM `on` table instead of raw dispatch where possible.
function statemachinecontroller:dispatch(event_or_name, payload)
	local event_name
	local data
	if type(event_or_name) == "table" then
		event_name = event_or_name.type
		data = event_or_name
	else
		event_name = event_or_name
		data = payload
	end
	local handled
	for _, machine in pairs(self.statemachines) do
		if machine:dispatch_event(event_name, data) then
			handled = true
		end
	end
	return handled
end

-- statemachinecontroller:transition_to(path): directly navigate to a state
-- by absolute path, bypassing guard conditions and without requiring an event.
-- In cart code, prefer returning a path string from an `on`-handler or
-- `entering_state`; only call transition_to() for imperative external control
-- (e.g. a debug command or test harness).
-- Path format: 'machine_id:/state/substate' or just '/state' for the default
-- machine.
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
	machine:transition_to(state_path)
end

-- statemachinecontroller:matches_state_path(path): returns true if ANY managed
-- FSM is currently at the given path.  Useful for conditional logic outside
-- the FSM (e.g. an ECS system that changes behaviour based on active state).
-- Use tag-based queries (matches_state_tag) when possible — they are cheaper
-- and do not depend on internal state naming.
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

-- statemachinecontroller:matches_state_tag(tag): returns true if the target
-- object currently carries the given tag.  Prefer this over matches_state_path
-- for feature queries — tags are maintained automatically by FSM `tags`
-- declarations and timeline windows, and are cheaper to test than path strings.
function statemachinecontroller:matches_state_tag(tag)
	return self.target:has_tag(tag)
end

function statemachinecontroller:run_statemachine(id)
	local machine = self.statemachines[id]
	if not machine then
		error("no machine with id '" .. tostring(id) .. "'")
	end
	machine:update()
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

-- statemachinecontroller:pause() / resume(): suspend / resume FSM updates
-- (entering_state, update, on-handlers still fire but the update loop stops).
-- Called by worldobject:deactivate() / activate().  Use pause_statemachine(id)
-- to pause a single named machine while leaving others running.
function statemachinecontroller:pause()
	self.update_enabled = false
end

function statemachinecontroller:resume()
	self.update_enabled = true
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
