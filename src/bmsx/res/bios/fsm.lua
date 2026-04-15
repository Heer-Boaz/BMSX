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
--
-- RUNTIME MECHANICS — how the FSM runtime works under the hood.
--
-- 6. COMPOUND STATE AUTO-ENTRY (enter_initial_substate_chain).
--    When a state with substates is entered (either on transition or on
--    machine start), the runtime calls enter_initial_substate_chain() which
--    recursively enters the active child tree: the current main child plus
--    any concurrent siblings.  It activates timelines and calls
--    entering_state before descending into each active child.  This ensures
--    that entering a compound state like /shrine always also enters
--    /shrine/entering, and that concurrent regions are initialized before the
--    first update/draw.
--
-- 7. CONCURRENT REGIONS (is_concurrent = true).
--    A state marked is_concurrent runs in parallel with the main (non-concurrent)
--    substate.  It has its own state machine lifecycle (entry, update, event
--    dispatch) but shares the same target object.  When the parent state
--    becomes active, the runtime enters the current main child first and then
--    enters all concurrent siblings.  During dispatch_event, the current main
--    child is dispatched first, then all concurrent siblings.  During
--    update(), the main child runs first, then concurrent siblings.
--    Example: player's sword region runs alongside the movement states.
--
-- 8. TAG DERIVATIONS.
--    Tag derivations declared in the FSM root definition are evaluated after
--    every state transition via sync_target_state_tags().  The runtime:
--    (a) collects all active state tags from the current state tree (including
--        concurrent regions, recursively), then
--    (b) runs the derivation rules to compute derived tags, and
--    (c) diffs against previously applied tags to add/remove tags on the
--        target object via add_tag/remove_tag.
--    Derivation rules support: any (array = any-of), all, and none operators.
--    Rules can chain — derived tags can reference other derived tags.
--
-- 9. CRITICAL SECTIONS AND TRANSITION QUEUES.
--    During entering_state and exiting_state callbacks, the FSM is in a
--    critical section.  Any transition request during a critical section is
--    queued and processed after the section ends.  This prevents re-entrant
--    state changes that would corrupt the state tree.
--
-- 10. POP_AND_TRANSITION (history stack).
--     Each state maintains a bounded history stack (max 10 entries).  When a
--     state transitions away, the previous state_id is pushed.  Calling
--     pop_and_transition() restores the most recent state — used for temporary
--     interruptions like player freeze (seal dissolution → pop back to
--     previous movement state).  If the local stack is empty, it delegates
--     to the parent state.
--
-- 11. EVENT DISPATCH AND BUBBLING.
--     dispatch_event() delivers an event depth-first: current child first,
--     then concurrent siblings.  If no child handles it, the event bubbles
--     up to the parent, then grandparent, etc.  Root-level `on` handlers
--     catch events that no substate claimed.  The `emitter` field in `on`
--     entries provides per-handler emitter filtering, so a handler can
--     restrict to events from a specific source object.

local fsm_trace<const> = require('fsm_trace')
local clear_map<const> = require('clear_map')
local timeline_module<const> = require('timeline')

local statedefinition<const> = {}
statedefinition.__index = statedefinition

local start_state_prefixes<const> = { ['_'] = true, ['#'] = true }
local no_op_aliases<const> = { ['no-op'] = true, ['noop'] = true, ['no_op'] = true }
local ignored_relative_segments<const> = { [''] = true, ['.'] = true }
local input_eval_modes<const> = { ['first'] = true, ['all'] = true }
local build_input_event_handler_list<const> = function(handlers)
	local list<const> = {}
	for pattern, handler in pairs(handlers) do
		list[#list + 1] = { pattern = pattern, handler = handler }
	end
	return list
end

local make_def_id<const> = function(id, parent)
	if not parent then
		return id
	end
	local separator<const> = parent.parent and '/' or ':/'
	return parent.def_id .. separator .. id
end

local collect_event_list<const> = function(def, list, seen)
	for name, action in pairs(def.on or {}) do
		local emitter = nil
		if type(action) == 'table' and action.emitter ~= nil then
			emitter = action.emitter
			if type(emitter) == 'table' and emitter.id ~= nil then
				emitter = emitter.id
			end
		end
		local key<const> = name .. ':' .. tostring(emitter)
		if not seen[key] then
			list[#list + 1] = { name = name, emitter = emitter }
			seen[key] = true
		end
	end
	for _, child in pairs(def.states or {}) do
		collect_event_list(child, list, seen)
	end
end

local validate_tag_list<const> = function(values, owner_tag, field_name)
	if type(values) ~= 'table' then
		error('tag derivation "' .. tostring(owner_tag) .. '" field "' .. tostring(field_name) .. '" must be an array of tags.')
	end
	for i = 1, #values do
		local source_tag<const> = values[i]
		if type(source_tag) ~= 'string' then
			error('tag derivation "' .. tostring(owner_tag) .. '" field "' .. tostring(field_name) .. '" contains non-string value at index ' .. tostring(i) .. '.')
		end
	end
	if #values == 0 then
		error('tag derivation "' .. tostring(owner_tag) .. '" field "' .. tostring(field_name) .. '" cannot be empty.')
	end
	return values
end

-- compile_tag_derivations: parses the raw tag_derivations table from the FSM
-- definition into an ordered array of compiled rules.  Each rule has:
--   derived_tag (string): the tag to add/remove on the target.
--   any (array|nil): derived_tag is true if ANY of these source tags is active.
--   all (array|nil): derived_tag requires ALL of these to be active.
--   none (array|nil): derived_tag requires NONE of these to be active.
-- Short-form: if spec is a plain array, it is treated as an any-of rule.
-- Full-form: spec is { any = [...], all = [...], none = [...] }.
-- Rules are sorted by derived_tag name for deterministic evaluation order.
-- The runtime evaluates rules in a fixed-point loop to resolve chains.
local compile_tag_derivations<const> = function(raw)
	if raw == nil then
		return nil
	end
	if type(raw) ~= 'table' then
		error('fsm.tag_derivations must be a table.')
	end
	local derived_tags<const> = {}
	for derived_tag in pairs(raw) do
		derived_tags[#derived_tags + 1] = derived_tag
	end
	if #derived_tags == 0 then
		return nil
	end
	table.sort(derived_tags)
	local compiled<const> = {}
	for i = 1, #derived_tags do
		local derived_tag<const> = derived_tags[i]
		if type(derived_tag) ~= 'string' then
			error('fsm.tag_derivations contains non-string derived tag key.')
		end
		local spec<const> = raw[derived_tag]
		local rule<const> = {
			derived_tag = derived_tag,
			any = nil,
			all = nil,
			none = nil,
		}
		if type(spec) ~= 'table' then
			error('tag derivation "' .. tostring(derived_tag) .. '" must be an array or table.')
		end
		if spec[1] ~= nil then
			rule.any = validate_tag_list(spec, derived_tag, 'any')
		else
			if spec.any ~= nil then
				rule.any = validate_tag_list(spec.any, derived_tag, 'any')
			end
			if spec.all ~= nil then
				rule.all = validate_tag_list(spec.all, derived_tag, 'all')
			end
			if spec.none ~= nil then
				rule.none = validate_tag_list(spec.none, derived_tag, 'none')
			end
		end
		if rule.any == nil and rule.all == nil and rule.none == nil then
			error('tag derivation "' .. tostring(derived_tag) .. '" must define an array, or an "any"/"all"/"none" array.')
		end
		compiled[#compiled + 1] = rule
	end
	return compiled
end

local validate_optional_state_function<const> = function(def_id, field_name, value)
	if value ~= nil and type(value) ~= 'function' then
		error(
			'state definition "' .. tostring(def_id)
				.. '" field "' .. tostring(field_name)
				.. '" must be a function, but got ' .. type(value) .. '.'
		)
	end
end

local validate_no_op_alias_value<const> = function(def_id, field_name, value)
	if type(value) ~= 'string' then
		return
	end
	if no_op_aliases[value] then
		return
	end
	local lowered<const> = string.lower(value)
	if no_op_aliases[lowered] then
		error(
			'state definition "' .. tostring(def_id)
				.. '" field "' .. tostring(field_name)
				.. '" uses invalid no-op alias "' .. tostring(value)
				.. '". use lowercase "' .. lowered .. '".'
		)
	end
end

local validate_transition_spec<const> = function(def_id, field_name, spec)
	if spec == nil then
		return
	end
	local kind<const> = type(spec)
	if kind == 'string' then
		validate_no_op_alias_value(def_id, field_name, spec)
		return
	end
	if kind == 'function' then
		return
	end
	if kind ~= 'table' then
		error(
			'state definition "' .. tostring(def_id)
				.. '" field "' .. tostring(field_name)
				.. '" must be a string, function, or transition table, but got ' .. kind .. '.'
		)
	end
	local go<const> = spec.go
	if go == nil then
		return
	end
	local go_kind<const> = type(go)
	if go_kind == 'string' then
		validate_no_op_alias_value(def_id, field_name .. '.go', go)
		return
	end
	if go_kind ~= 'function' then
		error(
			'state definition "' .. tostring(def_id)
				.. '" field "' .. tostring(field_name)
				.. '.go" must be a string or function, but got ' .. go_kind .. '.'
		)
	end
end

local validate_transition_spec_map<const> = function(def_id, field_name, map)
	if map == nil then
		return
	end
	if type(map) ~= 'table' then
		error(
			'state definition "' .. tostring(def_id)
				.. '" field "' .. tostring(field_name)
				.. '" must be a table, but got ' .. type(map) .. '.'
		)
	end
	for key, spec in pairs(map) do
		validate_transition_spec(def_id, field_name .. '[' .. tostring(key) .. ']', spec)
	end
end

function statedefinition.new(id, def, root, parent)
	local self<const> = setmetatable({}, statedefinition)
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
				local key<const> = 'timeline.end.' .. tl_id
				if self.on[key] ~= nil then
					error('state "' .. tostring(self.def_id) .. '": "on_end" for timeline "' .. tl_id .. '" conflicts with an existing "on" entry')
				end
				self.on[key] = tl_def.on_end
			end
			if tl_def.on_frame ~= nil then
				local key<const> = 'timeline.frame.' .. tl_id
				if self.on[key] ~= nil then
					error('state "' .. tostring(self.def_id) .. '": "on_frame" for timeline "' .. tl_id .. '" conflicts with an existing "on" entry')
				end
				self.on[key] = tl_def.on_frame
			end
		end
	end
	if def and def.tick ~= nil then
		error('state definition "' .. tostring(self.def_id) .. '" field "tick" is not supported. Use "update".')
	end
	if def and def.process_input ~= nil then
		error('state definition "' .. tostring(self.def_id) .. '" field "process_input" is not supported.')
	end
	if def and def.run_checks ~= nil then
		error('state definition "' .. tostring(self.def_id) .. '" field "run_checks" is not supported.')
	end
	self.update = def and def.update
	self.entering_state = def and def.entering_state
	self.exiting_state = def and (def.exiting_state or def.leaving_state)
	self.input_event_handlers = def and def.input_event_handlers or {}
	self.is_concurrent = def and def.is_concurrent or false
	self.input_eval = def and def.input_eval
	if self.input_eval ~= nil and not input_eval_modes[self.input_eval] then
		error(
			'state definition "' .. tostring(self.def_id)
				.. '" has invalid input_eval "' .. tostring(self.input_eval)
				.. '". expected "first" or "all", but got ' .. type(self.input_eval) .. '.'
		)
	end
	if self.input_eval ~= nil then
		self.effective_input_eval = self.input_eval
	elseif parent then
		self.effective_input_eval = parent.effective_input_eval
	else
		self.effective_input_eval = 'all'
	end
	validate_optional_state_function(self.def_id, 'update', self.update)
	validate_optional_state_function(self.def_id, 'entering_state', self.entering_state)
	validate_optional_state_function(self.def_id, 'exiting_state', self.exiting_state)
	validate_transition_spec_map(self.def_id, 'on', self.on)
	validate_transition_spec_map(self.def_id, 'input_event_handlers', self.input_event_handlers)
	self.input_event_handler_list = build_input_event_handler_list(self.input_event_handlers)
	self.event_list = def and def.event_list
	self.timelines = def and def.timelines
	self.transition_guards = def and def.transition_guards
	self.tags = def and def.tags
	self.tag_derivations = nil
	if self.root == self then
		local raw_tag_derivations<const> = def and (def.tag_derivations or def.derived_tags or def.tag_groups)
		self.tag_derivations = compile_tag_derivations(raw_tag_derivations)
	end

	if def and def.states then
		for state_id, state_def in pairs(def.states) do
			local child<const> = statedefinition.new(state_id, state_def, self.root, self)
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
	self.has_local_frame_work = self.update ~= nil or #self.input_event_handler_list ~= 0
	self.has_subtree_frame_work = self.has_local_frame_work
	if not self.has_subtree_frame_work then
		for _, child in pairs(self.states) do
			if child.has_subtree_frame_work then
				self.has_subtree_frame_work = true
				break
			end
		end
	end
	if self.root == self then
		self._resolved_path_cache = {}
		self._resolved_path_cache_count = 0
		self._event_handler_chain_cache = {}
		self._event_handler_chain_cache_count = 0
		local list<const> = {}
		local seen<const> = {}
		collect_event_list(self, list, seen)
		self.event_list = list
	end
	return self
end

local state<const> = {}
state.__index = state

state.trace_map = {}
state.path_config = { cache_size = 256 }
state._path_cache_count = 0
state.event_handler_chain_cache_size = 256
state.diagnostics = {
	trace_transitions = false,
	trace_dispatch = false,
	mirror_to_vm = false,
	max_entries_per_machine = 512,
}

local bst_max_history<const> = 10
local max_transitions_per_update<const> = 1000
local empty_game_event<const> = { type = '__fsm.synthetic__', emitter = nil, timestamp = 0 }
local target_state_tag_refs<const> = setmetatable({}, { __mode = 'k' })

local get_target_state_tag_refs<const> = function(target)
	local refs = target_state_tag_refs[target]
	if refs then
		return refs
	end
	refs = {}
	target_state_tag_refs[target] = refs
	return refs
end

local increment_target_state_tag_ref<const> = function(target, tag)
	local refs<const> = get_target_state_tag_refs(target)
	local count<const> = refs[tag]
	if count then
		refs[tag] = count + 1
		return
	end
	refs[tag] = 1
	target:add_tag(tag)
end

local decrement_target_state_tag_ref<const> = function(target, tag)
	local refs<const> = target_state_tag_refs[target]
	if not refs then
		error('missing state-tag reference map for target while removing "' .. tostring(tag) .. '".')
	end
	local count<const> = refs[tag]
	if not count then
		error('missing state-tag reference for "' .. tostring(tag) .. '".')
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

local clone_defaults<const> = function(source)
	local out<const> = {}
	for k, v in pairs(source) do
		out[k] = v
	end
	return out
end

local should_trace_transitions<const> = function()
	local diag<const> = state.diagnostics
	return diag and (diag.trace_transitions)
end

local should_trace_dispatch<const> = function()
	local diag<const> = state.diagnostics
	return diag and (diag.trace_dispatch)
end

local append_trace_entry<const> = function(id, message)
	local diag<const> = state.diagnostics
	if not diag then
		return
	end
	local list = state.trace_map[id]
	if not list then
		list = {}
		state.trace_map[id] = list
	end
	list[#list + 1] = message
	local limit<const> = diag.max_entries_per_machine or 0
	if limit > 0 and #list > limit then
		local overflow<const> = #list - limit
		for i = 1, overflow do
			table.remove(list, 1)
		end
	end
end

local resolve_emitter_id<const> = function(event, default_emitter_id)
	if not event or event.emitter == nil then
		return default_emitter_id
	end
	if not event.emitter then
		return false
	end
	local emitter<const> = event.emitter
	if type(emitter) == 'table' and emitter.id ~= nil then
		return emitter.id
	end
	return emitter
end

local is_no_op_string<const> = function(value)
	return type(value) == 'string' and no_op_aliases[value] ~= nil
end

local resolve_state_key<const> = function(definition, state_id)
	local states<const> = definition.states
	if not states then
		error('state "' .. definition.id .. '" does not define substates.')
	end
	if states[state_id] then
		return state_id
	end
	local underscore<const> = '_' .. state_id
	if states[underscore] then
		return underscore
	end
	local hash<const> = '#' .. state_id
	if states[hash] then
		return hash
	end
	return nil
end

local resolve_state_instance<const> = function(parent, state_id)
	local child = parent.states[state_id]
	if child then
		return child, state_id
	end
	local underscore<const> = '_' .. state_id
	child = parent.states[underscore]
	if child then
		return child, underscore
	end
	local hash<const> = '#' .. state_id
	child = parent.states[hash]
	if child then
		return child, hash
	end
	return nil, nil
end

local build_state_tag_lookup<const> = function(tags)
	if not tags then
		return nil
	end
	local lookup<const> = {}
	for i = 1, #tags do
		lookup[tags[i]] = true
	end
	return lookup
end

function state.new(definition, target, parent)
	local self<const> = setmetatable({}, state)
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
	self.state_ids = {}
	self.concurrent_states = {}
	self.state_count = 0
	self.concurrent_state_count = 0
	self.current_id = nil
	-- Current child state is cached directly so the frame hot path does not keep
	-- reloading states[self.current_id] from the state map on every recursive step.
	self.current_state = nil
	self.timeline_bindings = nil
	-- Queued transitions are stored as compact parallel arrays instead of
	-- per-entry tables. That keeps the deferred-transition path closer to a
	-- scheduler request queue and avoids record allocation in a hot framework path.
	self.transition_queue_paths = {}
	self.transition_queue_diags = {}
	self.transition_queue_count = 0
	self.critical_section_counter = 0
	self.is_processing_queue = false
	self._transition_context_stack = nil
	self._hist = {}
	self._hist_head = 0
	self._hist_size = 0
	self.in_update = false
	self._transitions_this_update = 0
	self.paused = false
	-- active_frame_work tracks whether the currently active subtree can do any
	-- per-frame FSM work. That lets the hot path skip dormant/event-only
	-- machines instead of re-entering them every frame.
	self.active_frame_work = false
	self.tag_list = definition.tags
	self.tag_lookup = build_state_tag_lookup(definition.tags)
	self._applied_state_tags = nil
	self._tag_sync_scratch = nil
	self._tag_remove_scratch = nil
	self._active_state_tag_refs = nil
	self._active_state_tags = nil
	self:populate_states()
	self:reset(true)
	return self
end

function state:is_root()
	return not self.parent
end

function state:is_active()
	if self:is_root() then
		return true
	end
	local parent<const> = self.parent
	if not parent:is_active() then
		return false
	end
	if parent.current_id == self.localdef_id then
		return true
	end
	return self.definition.is_concurrent and parent.states[self.localdef_id] == self
end

function state:make_id()
	if self:is_root() then
		return self.target_id .. '.' .. self.localdef_id
	end
	local separator<const> = self.parent.parent and '/' or ':/'
	return self.parent.id .. separator .. self.localdef_id
end

function state:definition_or_throw()
	local def<const> = self.definition
	if not def then
		error('state "' .. tostring(self.localdef_id) .. '" missing definition.')
	end
	return def
end

function state:child_definition_or_throw(child_id)
	local def<const> = self:definition_or_throw()
	if not def.states then
		error('definition "' .. tostring(def.def_id) .. '" has no substates while resolving "' .. child_id .. '".')
	end
	local key<const> = resolve_state_key(def, child_id)
	if not key then
		error('definition "' .. tostring(def.def_id) .. '" is missing child "' .. child_id .. '".')
	end
	return def.states[key], key
end

function state:states_or_throw(ctx)
	local container<const> = ctx or self
	if container.state_count == 0 then
		error('state "' .. tostring(container.id) .. '" does not define substates.')
	end
	return container.states
end

function state:find_child(ctx, seg)
	local child<const>, key<const> = resolve_state_instance(ctx, seg)
	return child, key
end

function state:ensure_child(ctx, seg)
	local child<const>, key<const> = self:find_child(ctx, seg)
	if not child then
		if ctx.state_count == 0 then
			error('state "' .. tostring(ctx.id) .. '" does not define substates.')
		end
		local children<const> = {}
		local child_ids<const> = ctx.state_ids
		for i = 1, ctx.state_count do
			children[i] = child_ids[i]
		end
		error('no state "' .. seg .. '" under "' .. tostring(ctx.id) .. '". children: ' .. table.concat(children, ', '))
	end
	return child, key
end

function state:timeline(id)
	local timeline<const> = self.target:get_timeline(id)
	if not timeline then
		error('timeline "' .. tostring(id) .. '" not found for target "' .. tostring(self.target_id) .. '".')
	end
	return timeline
end

function state:create_timeline_binding(key, config)
	if config.def ~= nil and type(config.def) ~= 'table' then
		error('timeline "' .. tostring(key) .. '" field "def" must be a table.')
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
		local defs<const> = self.definition.timelines or {}
		local bindings<const> = {}
		for key, config in pairs(defs) do
			bindings[#bindings + 1] = self:create_timeline_binding(key, config)
		end
		self.timeline_bindings = bindings
	end
	local bindings<const> = self.timeline_bindings
	for i = 1, #bindings do
		local binding<const> = bindings[i]
		if not binding.defined then
			if binding.def then
				local def<const> = binding.def
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
	local bindings<const> = self:ensure_timeline_definitions()
	for i = 1, #bindings do
		local binding<const> = bindings[i]
		if binding.autoplay then
			self.target:play_timeline(binding.id, binding.play_options)
		end
	end
end

function state:deactivate_timelines()
	local bindings<const> = self.timeline_bindings
	if not bindings then
		return
	end
	for i = 1, #bindings do
		local binding<const> = bindings[i]
		if binding.stop_on_exit then
			self.target:stop_timeline(binding.id)
		end
	end
end

function state:enter_child_state(child)
	local child_def<const> = child.definition
	self:with_critical_section(function()
		child:activate_timelines()
		local enter_child<const> = child_def.entering_state
		local next_state
		if enter_child then
			next_state = enter_child(self.target, child)
		end
		child:transition_to_next_state_if_provided(next_state)
	end)
end

function state:start()
	self:activate_timelines()
	self:enter_initial_substate_chain()
	self.root:refresh_active_frame_work()
end

-- enter_initial_substate_chain: recursively enters the active child tree
-- after a compound state is entered.  Called from start() (machine boot) and
-- transition_to_state() (on transition into a state that has substates).
-- The current main child is entered first, followed by concurrent siblings.
-- After each active child is entered, the runtime descends into that child's
-- own active substate tree.  Finally syncs target state tags.
function state:enter_initial_substate_chain()
	if not self:is_active() then
		return
	end
	if self.state_count == 0 then
		return
	end
	local current<const> = self.current_state
	if current == nil then
		return
	end
	self:enter_child_state(current)
	current:enter_initial_substate_chain()
	local concurrent_states<const> = self.concurrent_states
	for i = 1, self.concurrent_state_count do
		if not self:is_active() then
			return
		end
		local child<const> = concurrent_states[i]
		self:enter_child_state(child)
		child:enter_initial_substate_chain()
	end
	self.root:sync_target_state_tags()
end

function state:enter_critical_section()
	self.critical_section_counter = self.critical_section_counter + 1
end

function state:leave_critical_section()
	self.critical_section_counter = self.critical_section_counter - 1
	if self.critical_section_counter == 0 then
		if self.transition_queue_count ~= 0 and not self.is_processing_queue then
			self:process_transition_queue()
		end
	elseif self.critical_section_counter < 0 then
		error('critical section counter was lower than 0, which is a bug. state: "' .. tostring(self.id) .. '".')
	end
end

function state:with_critical_section(fn)
	self:enter_critical_section()
	local r1<const>, r2<const>, r3<const>, r4<const>, r5<const>, r6<const>, r7<const>, r8<const> = fn()
	self:leave_critical_section()
	return r1, r2, r3, r4, r5, r6, r7, r8
end

local run_queued_transition_with_context<const> = function(self, path, snapshot)
	local ctx<const> = self:hydrate_context(snapshot, 'queue-drain', 'queued-execution')
	local stack = self._transition_context_stack
	if stack == nil then
		stack = {}
		self._transition_context_stack = stack
	end
	local stack_index<const> = #stack + 1
	stack[stack_index] = ctx
	local ok<const>, err<const> = pcall(self.transition_to, self, path)
	stack[stack_index] = nil
	if stack_index == 1 then
		self._transition_context_stack = nil
	end
	if not ok then
		error(err)
	end
end

local drain_transition_queue<const> = function(self)
	local queued_paths<const> = self.transition_queue_paths
	local queued_diags<const> = self.transition_queue_diags
	local trace_transitions<const> = should_trace_transitions()
	local i = 1
	while i <= self.transition_queue_count do
		local path<const> = queued_paths[i]
		local diag<const> = queued_diags[i]
		queued_paths[i] = nil
		queued_diags[i] = nil
		if trace_transitions then
			run_queued_transition_with_context(self, path, diag)
		else
			self:transition_to(path)
		end
		i = i + 1
	end
	self.transition_queue_count = 0
end

function state:process_transition_queue()
	if self.is_processing_queue or self.transition_queue_count == 0 then
		return
	end
	self.is_processing_queue = true
	local ok<const>, err<const> = pcall(drain_transition_queue, self)
	self.is_processing_queue = false
	if not ok then
		error(err)
	end
end

function state:run_with_transition_context(factory, fn)
	if not should_trace_transitions() then
		return fn(nil)
	end
	local ctx<const> = factory()
	local stack = self._transition_context_stack
	if not stack then
		stack = {}
		self._transition_context_stack = stack
	end
	stack[#stack + 1] = ctx
	local ok<const>, r1<const>, r2<const>, r3<const>, r4<const>, r5<const>, r6<const>, r7<const>, r8<const> = pcall(fn, ctx)
	stack[#stack] = nil
	if #stack == 0 then
		self._transition_context_stack = nil
	end
	if not ok then
		error(r1)
	end
	return r1, r2, r3, r4, r5, r6, r7, r8
end

function state:transition_context()
	local stack<const> = self._transition_context_stack
	if not stack or #stack == 0 then
		return nil
	end
	return stack[#stack]
end

function state:append_action_evaluation(detail)
	if not should_trace_transitions() then
		return
	end
	local ctx<const> = self:transition_context()
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
	local ctx<const> = self:transition_context()
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
	local ctx<const> = self:transition_context()
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
	return self:transition_context()
end

function state:emit_transition_trace(entry)
	if not should_trace_transitions() then
		return
	end
	local context<const> = self:resolve_context_snapshot(entry.context)
	local message<const> = fsm_trace.compose_transition_trace_message({
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
		timestamp = clock_now(),
	}
end

function state:emit_event_dispatch_trace(event_name, emitter, detail, handled, bubbled, depth, context)
	if not should_trace_dispatch() then
		return
	end
	local message<const> = fsm_trace.compose_event_dispatch_trace_message({
		event_name = event_name,
		emitter = emitter,
		detail = detail,
		handled = handled,
		bubbled = bubbled,
		depth = depth,
		context = context,
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
	local t<const> = type(action)
	if t == 'string' then
		if is_no_op_string(action) then
			return true
		end
		self:transition_to(action)
		return true
	end
	if t == 'function' then
		local handler_event<const> = event or empty_game_event
		local next_state<const> = action(self.target, self, handler_event)
		local detail = 'do:<anonymous>'
		if next_state then
			detail = detail .. '->' .. tostring(next_state)
		end
		self:append_action_evaluation(detail)
		if next_state and not is_no_op_string(next_state) then
			self:transition_to(next_state)
		end
		return true
	end
	if t ~= 'table' then
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
	local do_handler<const> = action.go
	if not do_handler then
		return false
	end
	local dt<const> = type(do_handler)
	if dt == 'string' then
		if is_no_op_string(do_handler) then
			return true
		end
		self:append_action_evaluation('do:string=' .. do_handler)
		self:transition_to(do_handler)
		return true
	end
	if dt == 'function' then
		local handler_event<const> = event or empty_game_event
		local next_state<const> = do_handler(self.target, self, handler_event)
		local detail = 'do:<anonymous>'
		if next_state then
			detail = detail .. '->' .. tostring(next_state)
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
	local evaluations<const> = {}

	local cur_def<const> = self.current_state.definition
	local exit_guard_def<const> = cur_def.transition_guards
	local exit_guard<const> = exit_guard_def and exit_guard_def.can_exit
	if type(exit_guard) == 'function' then
		local passed<const> = exit_guard(self.target, self)
		local evaluation<const> = {
			side = 'exit',
			descriptor = '<anonymous>',
			passed = passed,
			defined = true,
			type = 'function',
			reason = passed and nil or 'exit guard returned false',
		}
		self:append_guard_evaluation(evaluation)
		evaluations[#evaluations + 1] = evaluation
		allowed = passed
	else
		local evaluation
		if exit_guard == nil then
			evaluation = { side = 'exit', descriptor = '<none>', passed = true, defined = false, type = 'missing' }
		else
			evaluation = {
				side = 'exit',
				descriptor = tostring(exit_guard),
				passed = true,
				defined = true,
				type = type(exit_guard) == 'string' and 'string' or 'other',
				reason = 'non-callable guard ignored',
			}
		end
		self:append_guard_evaluation(evaluation)
		evaluations[#evaluations + 1] = evaluation
		allowed = true
	end

	if not allowed then
		local evaluation<const> = {
			side = 'enter',
			descriptor = '<not-evaluated>',
			passed = false,
			defined = false,
			type = 'missing',
			reason = 'enter guard skipped due to exit guard failure',
		}
		self:append_guard_evaluation(evaluation)
		evaluations[#evaluations + 1] = evaluation
		return { allowed = allowed, evaluations = evaluations }
	end

	local states<const> = self:states_or_throw()
	local tgt<const> = states[target_state_id]
	if not tgt then
		error('target state "' .. tostring(target_state_id) .. '" not found under "' .. tostring(self.id) .. '".')
	end
	local enter_guard_def<const> = self:child_definition_or_throw(target_state_id).transition_guards
	local enter_guard<const> = enter_guard_def and enter_guard_def.can_enter
	if type(enter_guard) == 'function' then
		local passed<const> = enter_guard(self.target, tgt)
		local evaluation<const> = {
			side = 'enter',
			descriptor = '<anonymous>',
			passed = passed,
			defined = true,
			type = 'function',
			reason = passed and nil or 'enter guard returned false',
		}
		self:append_guard_evaluation(evaluation)
		evaluations[#evaluations + 1] = evaluation
		if not passed then
			allowed = false
		end
	else
		local evaluation
		if enter_guard == nil then
			evaluation = { side = 'enter', descriptor = '<none>', passed = true, defined = false, type = 'missing' }
		else
			evaluation = {
				side = 'enter',
				descriptor = tostring(enter_guard),
				passed = true,
				defined = true,
				type = type(enter_guard) == 'string' and 'string' or 'other',
				reason = 'non-callable guard ignored',
			}
		end
		self:append_guard_evaluation(evaluation)
		evaluations[#evaluations + 1] = evaluation
	end

	return { allowed = allowed, evaluations = evaluations }
end

-- transition_to_state: the core state transition operation.
-- If in a critical section, the transition is queued (see CRITICAL SECTIONS
-- in the header).  Guards are evaluated before transitioning.
-- Sequence: exit current state → deactivate timelines → push history →
-- set new current_id → activate timelines → call entering_state →
-- if entered state has substates, reset_submachine + enter_initial_substate_chain.
function state:transition_to_state(state_id)
	if self.in_update then
		self._transitions_this_update = self._transitions_this_update + 1
		if self._transitions_this_update > max_transitions_per_update then
			error('transition limit exceeded in one tick for "' .. tostring(self.id) .. '".')
		end
	end

	local diag_enabled<const> = should_trace_transitions()
	local execution<const> = self.is_processing_queue and 'deferred' or 'manual'

	if self.critical_section_counter > 0 then
		local queue_index<const> = self.transition_queue_count + 1
		self.transition_queue_count = queue_index
		self.transition_queue_paths[queue_index] = state_id
		if diag_enabled then
			local context<const> = self:resolve_context_snapshot(nil)
			self.transition_queue_diags[queue_index] = context
			local outcome<const> = { from = self.current_id, to = state_id, execution = 'queued', status = 'queued', reason = 'critical-section' }
			self:record_transition_outcome_on_context(outcome)
			self:emit_transition_trace({
				outcome = 'queued',
				execution = 'queued',
				from = self.current_id,
				to = state_id,
				context = context,
				queue_size = queue_index,
				reason = 'critical-section',
			})
		else
			self.transition_queue_diags[queue_index] = nil
		end
		return
	end

	if self.current_id == state_id then
		if diag_enabled then
			local context<const> = self:resolve_context_snapshot(nil)
			self:record_transition_outcome_on_context({
				from = self.current_id,
				to = state_id,
				execution = execution,
				status = 'noop',
				reason = 'already-current',
			})
			self:emit_transition_trace({
				outcome = 'noop',
				execution = execution,
				from = self.current_id,
				to = state_id,
				context = context,
				reason = 'already-current',
			})
		end
		return
	end

	local guard_diagnostics<const> = self:check_state_guard_conditions(state_id)
	if not guard_diagnostics.allowed then
		if diag_enabled then
			local context<const> = self:resolve_context_snapshot(nil)
			local outcome<const> = {
				from = self.current_id,
				to = state_id,
				execution = execution,
				status = 'blocked',
				guard_summary = fsm_trace.format_guard_diagnostics(guard_diagnostics),
			}
			self:record_transition_outcome_on_context(outcome)
			self:emit_transition_trace({
				outcome = 'blocked',
				execution = execution,
				from = self.current_id,
				to = state_id,
				context = context,
				guard = guard_diagnostics,
				reason = 'guard',
			})
		end
		return
	end

	self:with_critical_section(function()
		local prev_id<const> = self.current_id
		local prev_instance<const> = self.current_state
		local prev_def<const> = prev_instance.definition

		local exit_handler<const> = prev_def.exiting_state
		if type(exit_handler) == 'function' then
			exit_handler(self.target, prev_instance)
		end
		prev_instance:deactivate_timelines()
		self:push_history(prev_id)
		prev_instance:remove_active_subtree_tags()

		self.current_id = state_id
		local cur<const> = self.states[state_id]
		if not cur then
			error('state "' .. tostring(self.id) .. '" transitioned to "' .. tostring(state_id) .. '" but the instance was not created.')
		end
		self.current_state = cur
		local cur_def<const> = cur.definition
		if cur_def.is_concurrent then
			error('cannot transition to parallel state "' .. tostring(state_id) .. '".')
		end
		cur:add_active_subtree_tags()

		cur:activate_timelines()
		local enter_handler<const> = cur_def.entering_state
		local next_state
		if enter_handler then
			if should_trace_transitions() then
				next_state = self:run_with_transition_context(
					function()
						local ctx<const> = fsm_trace.create_enter_context(state_id)
						ctx.handler_name = '<anonymous>'
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
			local outcome<const> = {
				from = prev_id,
				to = state_id,
				execution = execution,
				status = 'success',
				guard_summary = fsm_trace.format_guard_diagnostics(guard_diagnostics),
			}
			self:record_transition_outcome_on_context(outcome)
			self:emit_transition_trace({
				outcome = 'success',
				execution = execution,
				from = prev_id,
				to = state_id,
				guard = guard_diagnostics,
			})
		end
	end)

	local entered<const> = self.states[state_id]
	if entered.definition.initial then
		entered:remove_active_subtree_tags()
		entered:reset_submachine(true)
		entered:add_active_subtree_tags()
		entered:enter_initial_substate_chain()
	end
	self.root:refresh_active_frame_work()
end

function state:push_history(to_push)
	local cap<const> = bst_max_history
	local tail_index<const> = (self._hist_head + self._hist_size) % cap
	self._hist[tail_index + 1] = to_push
	if self._hist_size < cap then
		self._hist_size = self._hist_size + 1
	else
		self._hist_head = (self._hist_head + 1) % cap
	end
end

-- pop_and_transition: pops the most recent state_id from the bounded history
-- stack and transitions to it.  Used for temporary states like /freeze that
-- should return to wherever the FSM was before.  If the local stack is empty,
-- delegates to the parent state (allowing bubbling up the hierarchy).
function state:pop_and_transition()
	if self._hist_size <= 0 then
		if self.parent ~= nil then
			self.parent:pop_and_transition()
		end
		return
	end
	local cap<const> = bst_max_history
	local tail_index<const> = (self._hist_head + self._hist_size - 1 + cap) % cap
	local popped_state_id<const> = self._hist[tail_index + 1]
	self._hist_size = self._hist_size - 1
	if popped_state_id then
		self:transition_to(popped_state_id)
	end
end

function state:get_history_snapshot()
	local out<const> = {}
	for i = 1, self._hist_size do
		out[#out + 1] = self._hist[(self._hist_head + i - 1) % bst_max_history + 1]
	end
	return out
end

local compile_definition_path_plan<const> = function(origin_definition, path)
	local spec<const> = state.parse_fs_path(path)
	if not spec.abs and spec.up == 0 and #spec.segs == 0 then
		error('empty path is invalid.')
	end
	local ctx = spec.abs and origin_definition.root or origin_definition
	for i = 1, spec.up do
		if not ctx.parent then
			error('path "' .. path .. '" attempts to go above root.')
		end
		ctx = ctx.parent
	end
	local count<const> = #spec.segs
	local keys<const> = {}
	local concurrent<const> = {}
	for i = 1, count do
		local seg<const> = spec.segs[i]
		local key<const> = resolve_state_key(ctx, seg)
		if not key then
			local states<const> = ctx.states
			if not states then
				error('state "' .. tostring(ctx.id) .. '" does not define substates.')
			end
			local children<const> = {}
			for child_id in pairs(states) do
				children[#children + 1] = child_id
			end
			error('no state "' .. seg .. '" under "' .. tostring(ctx.def_id) .. '". children: ' .. table.concat(children, ', '))
		end
		local child<const> = ctx.states[key]
		keys[i] = key
		concurrent[i] = child.is_concurrent
		ctx = child
	end
	return {
		abs = spec.abs,
		up = spec.up,
		count = count,
		keys = keys,
		concurrent = concurrent,
	}
end

local get_cached_definition_path_plan<const> = function(origin_definition, path)
	local root<const> = origin_definition.root
	local cache_key<const> = origin_definition.def_id .. '\n' .. path
	local cache<const> = root._resolved_path_cache
	local cached<const> = cache[cache_key]
	if cached then
		return cached
	end
	local cache_size<const> = state.path_config.cache_size
	if root._resolved_path_cache_count >= cache_size then
		for key in pairs(cache) do
			cache[key] = nil
			root._resolved_path_cache_count = root._resolved_path_cache_count - 1
			break
		end
	end
	local plan<const> = compile_definition_path_plan(origin_definition, path)
	cache[cache_key] = plan
	root._resolved_path_cache_count = root._resolved_path_cache_count + 1
	return plan
end

local apply_cached_path_plan<const> = function(start_state, plan)
	local ctx = plan.abs and start_state.root or start_state
	for i = 1, plan.up do
		ctx = ctx.parent
	end
	local keys<const> = plan.keys
	local concurrent<const> = plan.concurrent
	for i = 1, plan.count do
		local key<const> = keys[i]
		local child<const> = ctx.states[key]
		if not concurrent[i] and ctx.current_id ~= key then
			ctx:transition_to_state(key)
		end
		ctx = child
	end
end

local matches_cached_path_plan<const> = function(start_state, plan)
	if plan.count == 0 then
		return false
	end
	local ctx = plan.abs and start_state.root or start_state
	for i = 1, plan.up do
		ctx = ctx.parent
	end
	local keys<const> = plan.keys
	local concurrent<const> = plan.concurrent
	for i = 1, plan.count do
		local key<const> = keys[i]
		if not concurrent[i] and ctx.current_id ~= key then
			return false
		end
		ctx = ctx.states[key]
	end
	return true
end

local compile_definition_event_handler_chain<const> = function(origin_definition, event_name)
	local depths<const> = {}
	local count = 0
	local definition = origin_definition
	local depth = 0
	while definition do
		if definition.on[event_name] ~= nil then
			count = count + 1
			depths[count] = depth
		end
		definition = definition.parent
		depth = depth + 1
	end
	return { count = count, depths = depths }
end

local get_cached_definition_event_handler_chain<const> = function(origin_definition, event_name)
	local root<const> = origin_definition.root
	local cache_key<const> = origin_definition.def_id .. '\n' .. event_name
	local cache<const> = root._event_handler_chain_cache
	local cached<const> = cache[cache_key]
	if cached then
		return cached
	end
	local cache_size<const> = state.event_handler_chain_cache_size
	if root._event_handler_chain_cache_count >= cache_size then
		for key in pairs(cache) do
			cache[key] = nil
			root._event_handler_chain_cache_count = root._event_handler_chain_cache_count - 1
			break
		end
	end
	local chain<const> = compile_definition_event_handler_chain(origin_definition, event_name)
	cache[cache_key] = chain
	root._event_handler_chain_cache_count = root._event_handler_chain_cache_count + 1
	return chain
end

function state:transition_to_path(path)
	if type(path) == 'table' then
		if #path == 0 then
			error('empty path is invalid.')
		end
		local ctx = self
		for i = 1, #path do
			local seg<const> = path[i]
			local child<const>, key<const> = self:ensure_child(ctx, seg)
			if not child.definition.is_concurrent and ctx.current_id ~= key then
				ctx:transition_to_state(key)
			end
			ctx = child
		end
		return
	end
	apply_cached_path_plan(self, get_cached_definition_path_plan(self.definition, path))
end

function state:transition_to(state_id)
	self:transition_to_path(state_id)
	self.root:sync_target_state_tags()
end

function state:path()
	if self:is_root() then
		return '/'
	end
	local segments<const> = {}
	local node = self
	while node and not node:is_root() do
		segments[#segments + 1] = node.current_id
		node = node.parent
	end
	local path<const> = {}
	for i = #segments, 1, -1 do
		path[#path + 1] = segments[i]
	end
	return '/' .. table.concat(path, '/')
end

state._path_cache = {}

function state.parse_fs_path(input)
	local cached<const> = state._path_cache[input]
	if cached then
		return cached
	end
	local len<const> = #input
	local i = 1
	local abs
	local up = 0
	local segs<const> = {}
	if len == 0 then
		return { abs = false, up = 0, segs = {} }
	end
	if string.sub(input, i, i) == '/' then
		abs = true
		i = i + 1
	end
	if not abs then
		if string.sub(input, i, i + 1) == './' then
			i = i + 2
		else
			while string.sub(input, i, i + 2) == '../' do
				up = up + 1
				i = i + 3
			end
		end
	end

	local push_seg<const> = function(seg)
		if ignored_relative_segments[seg] then
			return
		end
		if seg == '..' then
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
		local c<const> = string.sub(input, i, i)
		if c == '/' then
			i = i + 1
		elseif c == '[' and string.sub(input, i + 1, i + 1) == '\'' then
			i = i + 2
			local seg = ''
			local closed
			while i <= len do
				local ch<const> = string.sub(input, i, i)
				i = i + 1
				if ch == '\\' then
					if i <= len then
						local esc<const> = string.sub(input, i, i)
						i = i + 1
						if esc == '\'' then
							seg = seg .. '\''
						elseif esc == '/' then
							seg = seg .. '/'
						else
							seg = seg .. esc
						end
					end
				elseif ch == '\'' then
					if string.sub(input, i, i) == ']' then
						i = i + 1
						closed = true
						break
					else
						error('unterminated quoted segment in path "' .. input .. '".')
					end
				else
					seg = seg .. ch
				end
			end
			if not closed then
				error('unterminated quoted segment in path "' .. input .. '".')
			end
			push_seg(seg)
		else
			local start<const> = i
			while i <= len and string.sub(input, i, i) ~= '/' do
				i = i + 1
			end
			push_seg(string.sub(input, start, i - 1))
		end
	end

	local cache_size<const> = state.path_config.cache_size
	if state._path_cache_count >= cache_size then
		for key in pairs(state._path_cache) do
			state._path_cache[key] = nil
			state._path_cache_count = state._path_cache_count - 1
			break
		end
	end
	local rec<const> = { abs = abs, up = up, segs = segs }
	state._path_cache[input] = rec
	state._path_cache_count = state._path_cache_count + 1
	return rec
end

function state:matches_state_path(path)
	local match_segments<const> = function(start, segments)
		if #segments == 0 then
			return false
		end
		local ctx = start
		for i = 1, #segments do
			local seg<const> = segments[i]
			local child<const>, key<const> = resolve_state_instance(ctx, seg)
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

	if type(path) == 'table' then
		return match_segments(self, path)
	end
	return matches_cached_path_plan(self, get_cached_definition_path_plan(self.definition, path))
end

function state:matches_state_tag(tag)
	local tags<const> = self.tag_lookup
	if tags and tags[tag] then
		return true
	end

	local child<const> = self.current_state
	if child ~= nil then
		if child:matches_state_tag(tag) then
			return true
		end
		local concurrent_states<const> = self.concurrent_states
		for i = 1, self.concurrent_state_count do
			if concurrent_states[i]:matches_state_tag(tag) then
				return true
			end
		end
	end
	return false
end

-- collect_active_state_tags: walk the current state tree (including concurrent
-- regions) and collect all tags from active states into the output table.
function state:collect_active_state_tags(out)
	local tags<const> = self.tag_list
	if tags then
		for i = 1, #tags do
			out[tags[i]] = true
		end
	end
	local child<const> = self.current_state
	if child ~= nil then
		child:collect_active_state_tags(out)
		local concurrent_states<const> = self.concurrent_states
		for i = 1, self.concurrent_state_count do
			concurrent_states[i]:collect_active_state_tags(out)
		end
	end
end

local increment_active_state_tag_ref<const> = function(root, tag)
	local refs<const> = root._active_state_tag_refs
	local count<const> = refs[tag]
	if count then
		refs[tag] = count + 1
		return
	end
	refs[tag] = 1
	root._active_state_tags[tag] = true
end

local decrement_active_state_tag_ref<const> = function(root, tag)
	local refs<const> = root._active_state_tag_refs
	local count<const> = refs[tag]
	if count == 1 then
		refs[tag] = nil
		root._active_state_tags[tag] = nil
		return
	end
	refs[tag] = count - 1
end

function state:add_active_subtree_tags()
	local root<const> = self.root
	local tags<const> = self.tag_list
	if tags then
		for i = 1, #tags do
			increment_active_state_tag_ref(root, tags[i])
		end
	end
	local child<const> = self.current_state
	if child ~= nil then
		child:add_active_subtree_tags()
		local concurrent_states<const> = self.concurrent_states
		for i = 1, self.concurrent_state_count do
			concurrent_states[i]:add_active_subtree_tags()
		end
	end
end

function state:remove_active_subtree_tags()
	local root<const> = self.root
	local tags<const> = self.tag_list
	if tags then
		for i = 1, #tags do
			decrement_active_state_tag_ref(root, tags[i])
		end
	end
	local child<const> = self.current_state
	if child ~= nil then
		child:remove_active_subtree_tags()
		local concurrent_states<const> = self.concurrent_states
		for i = 1, self.concurrent_state_count do
			concurrent_states[i]:remove_active_subtree_tags()
		end
	end
end

function state:rebuild_active_subtree_tags()
	local refs = self._active_state_tag_refs
	if not refs then
		refs = {}
		self._active_state_tag_refs = refs
	else
		clear_map(refs)
	end
	local tags = self._active_state_tags
	if not tags then
		tags = {}
		self._active_state_tags = tags
	else
		clear_map(tags)
	end
	self:add_active_subtree_tags()
end

-- matches_tag_derivation_rule: evaluate a single derivation rule against the
-- current set of active tags.  all → every listed tag must be present.
-- none → no listed tag may be present.  any → at least one listed tag must
-- be present (returns false if none match, even when all/none pass).
local matches_tag_derivation_rule<const> = function(rule, tags)
	local all<const> = rule.all
	if all then
		for i = 1, #all do
			if not tags[all[i]] then
				return false
			end
		end
	end
	local none<const> = rule.none
	if none then
		for i = 1, #none do
			if tags[none[i]] then
				return false
			end
		end
	end
	local any<const> = rule.any
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

-- collect_derived_state_tags: evaluate tag derivation rules against currently
-- active tags.  Uses a fixed-point loop to resolve chains (derived tags that
-- reference other derived tags).
function state:collect_derived_state_tags(out)
	local root<const> = self:is_root() and self or self.root
	local derivations<const> = root.definition.tag_derivations
	if derivations == nil then
		return
	end
	local unresolved = #derivations
	while unresolved > 0 do
		local changed
		for i = 1, #derivations do
			local rule<const> = derivations[i]
			local derived_tag<const> = rule.derived_tag
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

-- sync_target_state_tags: diffs active state tags (including derived tags)
-- against previously applied tags on the target object.  Adds new tags and
-- removes stale ones via add_tag/remove_tag.  Called after every transition.
function state:sync_target_state_tags()
	local root<const> = self:is_root() and self or self.root
	local target<const> = root.target
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
	local active_tags<const> = root._active_state_tags
	for tag in pairs(active_tags) do
		next_tags[tag] = true
	end
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
		return false
	end
	local handlers<const> = self.definition.on
	local spec<const> = handlers[event_name]
	if not spec then
		return false
	end
	if should_trace_transitions() then
		return self:with_critical_section(function()
			return self:run_with_transition_context(
				function()
					return fsm_trace.create_event_context(event_name, emitter_id, detail)
				end,
				function(ctx)
					ctx.handler_name = fsm_trace.describe_transition_handler(spec)
					return self:handle_state_transition(spec, event)
				end
			)
		end)
	end
	return self:with_critical_section(function()
		return self:handle_state_transition(spec, event)
	end)
end

function state:handle_event_with_dispatch_context(event_name, emitter_id, detail, event)
	if self.paused then
		return false, nil
	end
	local handlers<const> = self.definition.on
	local spec<const> = handlers[event_name]
	if not spec then
		return false, nil
	end
	local captured_context = nil
	if should_trace_transitions() then
		return self:with_critical_section(function()
			local handled<const> = self:run_with_transition_context(
				function()
					return fsm_trace.create_event_context(event_name, emitter_id, detail)
				end,
				function(ctx)
					captured_context = ctx
					ctx.handler_name = fsm_trace.describe_transition_handler(spec)
					return self:handle_state_transition(spec, event)
				end
			)
			return handled
		end), captured_context
	end
	return self:with_critical_section(function()
		return self:handle_state_transition(spec, event)
	end), nil
end

-- dispatch_event: delivers an event through the state hierarchy.
-- Dispatch order: current child (depth-first) → concurrent siblings →
-- if unhandled, bubble to parent → grandparent → root.  Root-level `on`
-- handlers are the catch-all.  Returns true if any handler consumed the event.
function state:dispatch_event(event_or_name, payload)
	if self.paused then
		return false
	end
	local event_name
	local data
	if type(event_or_name) == 'table' then
		event_name = event_or_name.type
		data = event_or_name
	else
		event_name = event_or_name
		data = payload
	end
	local trace_dispatch<const> = should_trace_dispatch()
	local trace_transitions<const> = trace_dispatch or should_trace_transitions()
	local emitter_id
	local detail
	local dispatch_context
	if trace_dispatch or trace_transitions then
		emitter_id = resolve_emitter_id(data, self.target_id)
		if type(event_or_name) == 'table' then
			detail = data.payload
		else
			detail = data
		end
		if trace_dispatch then
			dispatch_context = fsm_trace.create_event_context(event_name, emitter_id, detail)
		end
	else
		detail = nil
	end

	local child<const> = self.current_state
	if child ~= nil then
		local handled = child:dispatch_event(event_name, data)
		local concurrent_states<const> = self.concurrent_states
		for i = 1, self.concurrent_state_count do
			handled = concurrent_states[i]:dispatch_event(event_name, data) or handled
		end
		if handled then
			return true
		end
	end

	if not trace_dispatch then
		local chain<const> = get_cached_definition_event_handler_chain(self.definition, event_name)
		if chain.count == 0 then
			return false
		end
		local current = self
		local depth = 0
		local depths<const> = chain.depths
		for i = 1, chain.count do
			local target_depth<const> = depths[i]
			while depth < target_depth do
				current = current.parent
				depth = depth + 1
			end
			if current:handle_event(event_name, emitter_id, detail, data) then
				return true
			end
		end
		return false
	end

	local current = self
	local depth = 0
	while current do
		local handled<const>, context<const> = current:handle_event_with_dispatch_context(event_name, emitter_id, detail, data)
		local bubbled<const> = depth > 0 or (not handled and current.parent ~= nil)
		current:emit_event_dispatch_trace(event_name, emitter_id, detail, handled, bubbled, depth, context or dispatch_context)
		if handled then
			return true
		end
		current = current.parent
		depth = depth + 1
	end
	return false
end

function state:update()
	if self.paused then
		return
	end
	self._transitions_this_update = 0
	-- update() runs on every active machine every frame, so the whole frame path
	-- stays open-coded. Keeping child updates, input scanning and current-state
	-- execution in one direct loop cuts method-call churn and repeated definition
	-- lookups that do not help gameplay work on a low-end machine.
	self.critical_section_counter = self.critical_section_counter + 1
	self.in_update = true
	local current<const> = self.current_state
	if current ~= nil and current.active_frame_work then
		current:update()
	end
	local concurrent_states<const> = self.concurrent_states
	for i = 1, self.concurrent_state_count do
		local child<const> = concurrent_states[i]
		if child.active_frame_work then
			child:update()
		end
	end

	local definition<const> = self.definition
	local target<const> = self.target
	local diagnostics<const> = state.diagnostics
	local trace_transitions<const> = diagnostics and diagnostics.trace_transitions
	local handlers<const> = definition.input_event_handler_list
	if #handlers ~= 0 then
		local player_index<const> = target.player_index or 1
		local eval_mode<const> = definition.effective_input_eval
		for i = 1, #handlers do
			local entry<const> = handlers[i]
			local pattern<const> = entry.pattern
			local handler<const> = entry.handler
			mem[sys_inp_player] = player_index
			mem[sys_inp_query] = pattern
			if mem[sys_inp_status] ~= 0 then
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
				if handled and eval_mode == 'first' then
					break
				end
			end
		end
	end

	local update_handler<const> = definition.update
	if update_handler ~= nil then
		local next_state
		if trace_transitions then
			next_state = self:run_with_transition_context(
				function()
					return fsm_trace.create_update_context('<anonymous>')
				end,
				function()
					return update_handler(target, self, empty_game_event)
				end
			)
		else
			next_state = update_handler(target, self, empty_game_event)
		end
		if next_state and not is_no_op_string(next_state) then
			self:transition_to(next_state)
		end
	end
	self.in_update = false
	self.critical_section_counter = self.critical_section_counter - 1
	if self.critical_section_counter == 0 then
		if self.transition_queue_count ~= 0 and not self.is_processing_queue then
			self:process_transition_queue()
		end
	elseif self.critical_section_counter < 0 then
		error('critical section counter was lower than 0, which is a bug. state: "' .. tostring(self.id) .. '".')
	end
end

function state:refresh_active_frame_work()
	local definition<const> = self.definition
	if not definition.has_subtree_frame_work then
		self.active_frame_work = false
		return false
	end
	local active<const> = definition.has_local_frame_work
	local subtree_active = active
	local current<const> = self.current_state
	if current ~= nil and current:refresh_active_frame_work() then
		subtree_active = true
	end
	local concurrent_states<const> = self.concurrent_states
	for i = 1, self.concurrent_state_count do
		if concurrent_states[i]:refresh_active_frame_work() then
			subtree_active = true
		end
	end
	self.active_frame_work = subtree_active
	return subtree_active
end

function state:populate_states()
	local sdef<const> = self.definition
	if not sdef or not sdef.states then
		self.states = {}
		self.state_ids = {}
		self.concurrent_states = {}
		self.state_count = 0
		self.concurrent_state_count = 0
		return
	end
	local state_ids<const> = {}
	for state_id in pairs(sdef.states) do
		state_ids[#state_ids + 1] = state_id
	end
	if #state_ids == 0 then
		self.states = {}
		self.state_ids = {}
		self.concurrent_states = {}
		self.state_count = 0
		self.concurrent_state_count = 0
		return
	end
	self.states = {}
	self.state_ids = {}
	self.concurrent_states = {}
	self.state_count = 0
	self.concurrent_state_count = 0
	for i = 1, #state_ids do
		local sdef_id<const> = state_ids[i]
		local child_def<const> = sdef.states[sdef_id]
		local child<const> = state.new(child_def, self.target, self)
		self.states[sdef_id] = child
		self.state_ids[i] = sdef_id
		self.state_count = i
		if child.definition.is_concurrent then
			local concurrent_index<const> = self.concurrent_state_count + 1
			self.concurrent_state_count = concurrent_index
			self.concurrent_states[concurrent_index] = child
		end
	end
	if not self.current_id then
		self.current_id = state_ids[1]
	end
	if self.current_id then
		self.current_state = self.states[self.current_id]
	else
		self.current_state = nil
	end
end

function state:reset(reset_tree)
	local def<const> = self.definition
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
	local def<const> = self.definition
	self.current_id = def.initial
	if self.current_id then
		self.current_state = self.states[self.current_id]
	else
		self.current_state = nil
	end
	self._hist_head = 0
	self._hist_size = 0
	local queued_paths<const> = self.transition_queue_paths
	local queued_diags<const> = self.transition_queue_diags
	for i = 1, self.transition_queue_count do
		queued_paths[i] = nil
		queued_diags[i] = nil
	end
	self.transition_queue_count = 0
	self.is_processing_queue = false
	self.paused = false
	self.data = def.data and clone_defaults(def.data) or {}
	if reset_tree == nil or reset_tree then
		local states<const> = self.states
		local state_ids<const> = self.state_ids
		for i = 1, self.state_count do
			states[state_ids[i]]:reset(reset_tree)
		end
	end
	if self:is_root() then
		self:refresh_active_frame_work()
		self:rebuild_active_subtree_tags()
		self:sync_target_state_tags()
	end
end

function state:dispose()
	self:deactivate_timelines()
		if self:is_root() then
			local applied<const> = self._applied_state_tags
			if applied then
				for tag in pairs(applied) do
					decrement_target_state_tag_ref(self.target, tag)
				end
			end
			self._applied_state_tags = nil
			self._tag_sync_scratch = nil
			self._tag_remove_scratch = nil
			self._active_state_tag_refs = nil
			self._active_state_tags = nil
		end
	if self.states then
		local states<const> = self.states
		local state_ids<const> = self.state_ids
		for i = 1, self.state_count do
			states[state_ids[i]]:dispose()
		end
	end
	self.states = {}
	self.state_ids = {}
	self.concurrent_states = {}
	self.state_count = 0
	self.concurrent_state_count = 0
	self.current_id = nil
	self.current_state = nil
	self.active_frame_work = false
	self.transition_queue_paths = {}
	self.transition_queue_diags = {}
	self.transition_queue_count = 0
end

local statemachinecontroller<const> = {}
statemachinecontroller.__index = statemachinecontroller

function statemachinecontroller.new(opts)
	local self<const> = setmetatable({}, statemachinecontroller)
	opts = opts or {}
	self.target = opts.target
	self.statemachines = {}
	self.statemachine_ids = {}
	self.statemachine_keys = {}
	self.statemachine_list = {}
	self.statemachine_count = 0
	self.update_enabled = true
	if opts.update_enabled ~= nil then
		self.update_enabled = opts.update_enabled
	end
	self._started = false
	self._event_subscriptions = {}
	if opts.definition then
		local def<const> = opts.definition
		local id<const> = def.id or opts.fsm_id or 'master'
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
	local machine<const> = state.new(def, self.target)
	local existing_index<const> = self.statemachine_ids[id]
	if existing_index then
		self.statemachine_keys[existing_index] = id
		self.statemachine_list[existing_index] = machine
	else
		local index<const> = self.statemachine_count + 1
		self.statemachine_count = index
		self.statemachine_ids[id] = index
		self.statemachine_keys[index] = id
		self.statemachine_list[index] = machine
	end
	self.statemachines[id] = machine
	return machine
end

function statemachinecontroller:bind_machine(machine)
	local events<const> = machine.definition.event_list
	if not events or #events == 0 then
		return
	end
	for i = 1, #events do
		local event<const> = events[i]
		local key<const> = machine.localdef_id .. ':' .. event.name .. ':' .. tostring(event.emitter)
		if self._event_subscriptions[key] then
			goto continue
		end
		local disposer<const> = machine.target.events:on({
			event = event.name,
			emitter = event.emitter,
			handler = function(evt)
				self:auto_dispatch(evt)
			end,
			subscriber = machine.target,
		})
		self._event_subscriptions[key] = disposer
		::continue::
	end
end

function statemachinecontroller:bind()
	local list<const> = self.statemachine_list
	for i = 1, self.statemachine_count do
		self:bind_machine(list[i])
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
		local name<const> = event_names[i]
		local key<const> = machine.localdef_id .. ':' .. name
		local disposer<const> = self._event_subscriptions[key]
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
	local list<const> = self.statemachine_list
	for i = 1, self.statemachine_count do
		list[i]:start()
	end
	self._started = true
	self:resume()
end

function statemachinecontroller:update()
	if not self.update_enabled then
		return
	end
	local list<const> = self.statemachine_list
	-- Controllers only tick machines whose active subtree can actually do frame
	-- work. That keeps event-only and dormant FSMs out of the per-frame loop.
	for i = 1, self.statemachine_count do
		local machine<const> = list[i]
		if machine.active_frame_work then
			machine:update()
		end
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
	if type(event_or_name) == 'table' then
		event_name = event_or_name.type
		data = event_or_name
	else
		event_name = event_or_name
		data = payload
	end
	local handled
	local list<const> = self.statemachine_list
	for i = 1, self.statemachine_count do
		if list[i]:dispatch_event(event_name, data) then
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
	local machine_id, state_path = string.match(path, '^(.-):/(.+)$')
	if not machine_id then
		machine_id = path
		state_path = path
	end
	local machine<const> = self.statemachines[machine_id]
	if not machine then
		error('no machine with id "' .. tostring(machine_id) .. '"')
	end
	machine:transition_to(state_path)
end

-- statemachinecontroller:matches_state_path(path): returns true if ANY managed
-- FSM is currently at the given path.  Useful for conditional logic outside
-- the FSM (e.g. an ECS system that changes behaviour based on active state).
-- Use tag-based queries (matches_state_tag) when possible — they are cheaper
-- and do not depend on internal state naming.
function statemachinecontroller:matches_state_path(path)
	local machine_id<const>, state_path<const> = string.match(path, '^(.-):/(.+)$')
	if machine_id then
		local machine<const> = self.statemachines[machine_id]
		if not machine then
			return false
		end
		return machine:matches_state_path(state_path)
	end
	local list<const> = self.statemachine_list
	for i = 1, self.statemachine_count do
		if list[i]:matches_state_path(path) then
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
	local machine<const> = self.statemachines[id]
	if not machine then
		error('no machine with id "' .. tostring(id) .. '"')
	end
	machine:update()
end

function statemachinecontroller:run_all_statemachines()
	local list<const> = self.statemachine_list
	for i = 1, self.statemachine_count do
		list[i]:update()
	end
end

function statemachinecontroller:reset_statemachine(id)
	local machine<const> = self.statemachines[id]
	if not machine then
		error('no machine with id "' .. tostring(id) .. '"')
	end
	machine:reset()
end

function statemachinecontroller:reset_all_statemachines()
	local list<const> = self.statemachine_list
	for i = 1, self.statemachine_count do
		list[i]:reset()
	end
end

function statemachinecontroller:pop_statemachine(id)
	local machine<const> = self.statemachines[id]
	if not machine then
		error('no machine with id "' .. tostring(id) .. '"')
	end
	machine:pop_and_transition()
end

function statemachinecontroller:pop_all_statemachines()
	local list<const> = self.statemachine_list
	for i = 1, self.statemachine_count do
		list[i]:pop_and_transition()
	end
end

function statemachinecontroller:switch_state(id, path)
	local machine<const> = self.statemachines[id]
	if not machine then
		error('no machine with id "' .. tostring(id) .. '"')
	end
	machine:transition_to(path)
end

function statemachinecontroller:pause_statemachine(id)
	local machine<const> = self.statemachines[id]
	if not machine then
		error('no machine with id "' .. tostring(id) .. '"')
	end
	machine.paused = true
end

function statemachinecontroller:resume_statemachine(id)
	local machine<const> = self.statemachines[id]
	if not machine then
		error('no machine with id "' .. tostring(id) .. '"')
	end
	machine.paused = false
end

function statemachinecontroller:pause_all_statemachines()
	local list<const> = self.statemachine_list
	for i = 1, self.statemachine_count do
		list[i].paused = true
	end
end

function statemachinecontroller:pause_all_except(to_exclude_id)
	local list<const> = self.statemachine_list
	local keys<const> = self.statemachine_keys
	for i = 1, self.statemachine_count do
		if keys[i] ~= to_exclude_id then
			list[i].paused = true
		end
	end
end

function statemachinecontroller:resume_all_statemachines()
	local list<const> = self.statemachine_list
	for i = 1, self.statemachine_count do
		list[i].paused = false
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
	local list<const> = self.statemachine_list
	for i = 1, self.statemachine_count do
		list[i]:dispose()
	end
	self:unbind()
	self.statemachines = {}
	self.statemachine_ids = {}
	self.statemachine_keys = {}
	self.statemachine_list = {}
	self.statemachine_count = 0
end

return {
	statedefinition = statedefinition,
	state = state,
	statemachinecontroller = statemachinecontroller,
}
