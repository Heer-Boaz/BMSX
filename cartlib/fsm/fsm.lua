-- fsm.lua
-- Finite state machine runtime for carts.
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
--    block using a `def` sub-table. The owner's timeline component constructs
--    the runtime — no manual timeline.new() call is needed in cart code.
--
--    Timeline shared by multiple states: declare once in the root-level
--    `timelines` block of the FSM (before `states`) with `autoplay = false`
--    (registration only).  Each state adds only the behaviour config
--    (autoplay, stop_on_exit, on_finished, …) without repeating `def`.
--
--    WRONG — duplicate def copied into every state that uses the timeline:
--      state_a = { timelines = { [id] = { def = { frames = ..., playback_mode = 'once' }, autoplay = true } } }
--      state_b = { timelines = { [id] = { def = { frames = ..., playback_mode = 'once' }, autoplay = true } } }
--    RIGHT — def at FSM root once, behaviour-only config in each state:
--      (root) timelines = { [id] = { def = { frames = ..., playback_mode = 'once' }, autoplay = false } }
--      state_a = { timelines = { [id] = { autoplay = true, stop_on_exit = true } } }
--      state_b = { timelines = { [id] = { autoplay = true, stop_on_exit = true, on_finished = '/other' } } }
--
-- 4. TIMELINE OUTPUTS AND COMPLETION.
--    Sampled output belongs to the timeline definition itself: use `apply` for
--    a frame value or value/sample tracks for bound properties. This runs in
--    the compiled evaluation program without routing every sample through the
--    event emitter and FSM. Use explicit event tracks only for announcements.
--    Declare state transitions on terminal completion as `on_finished` in the
--    state timeline binding. The timeline component invokes that retained
--    binding after its final evaluation and removal from the active set.
--
--    The event-emitter is not part of this transport path. Bind completion
--    directly to the state timeline:
--      timelines = { [my_id] = { ..., on_finished = '/next' } }
--      timelines = { [my_id] = { ..., on_finished = function(self) ... end } }
--
-- 5. SCOPED ACTION EFFECTS.
--    A state's `actioneffects` list retains active effects for exactly that
--    state's lifetime. Periodic effects therefore enter the scheduler once on
--    state entry and leave once on exit; do not poll state from an update
--    callback merely to trigger a cooldown-backed action.
--
-- 6. FORBIDDEN LEGACY FIELDS.
--    The cart builder rejects obsolete FSM fields rather than carrying a
--    compatibility path into runtime definitions:
--      'leaving_state' — use exiting_state
--      'derived_tags' and 'tag_groups' — use tag_derivations
--      'on_frame'     — use timeline apply/value/sample output
--      'tick'         — use update
--      'process_input' and 'run_checks' — use input handlers/transitions
--
-- RUNTIME MECHANICS — how the FSM runtime works under the hood.
--
-- 7. COMPOUND STATE AUTO-ENTRY (enter_initial_substate_chain).
--    When a state with substates is entered (either on transition or on
--    machine start), the runtime calls enter_initial_substate_chain() which
--    recursively enters the active child tree: the current main child plus
--    any concurrent siblings.  It activates timelines and calls
--    entering_state before descending into each active child.  This ensures
--    that entering a compound state like /shrine always also enters
--    /shrine/entering, and that concurrent regions are initialized before the
--    first update/draw.
--
-- 8. CONCURRENT REGIONS (is_concurrent = true).
--    A state marked is_concurrent runs in parallel with the main (non-concurrent)
--    substate.  It has its own state machine lifecycle (entry, update, event
--    dispatch) but shares the same target object.  When the parent state
--    becomes active, the runtime enters the current main child first and then
--    enters all concurrent siblings.  During dispatch_event, the current main
--    child is dispatched first, then all concurrent siblings.  During
--    update(), the main child runs first, then concurrent siblings.
--    Example: player's sword region runs alongside the movement states.
--
-- 9. TAG DERIVATIONS.
--    Tag derivations declared in the FSM root definition are evaluated after
--    every state transition via sync_target_state_tags().  The runtime:
--    (a) collects all active state tags from the current state tree (including
--        concurrent regions, recursively), then
--    (b) runs the derivation rules to compute derived tags, and
--    (c) diffs against previously applied tags to retain/release the FSM's
--        contribution in the target object's aggregate tag state.
--    Derivation rules support: any (array = any-of), all, and none operators.
--    Rules can chain — derived tags can reference other derived tags.
--
-- 10. CRITICAL SECTIONS AND TRANSITION QUEUES.
--    During entering_state and exiting_state callbacks, the FSM is in a
--    critical section.  Any transition request during a critical section is
--    queued and processed after the section ends.  This prevents re-entrant
--    state changes that would corrupt the state tree.
--
-- 11. POP_AND_TRANSITION (history stack).
--     Each state maintains a bounded history stack (max 10 entries).  When a
--     state transitions away, the previous state_id is pushed.  Calling
--     pop_and_transition() restores the most recent state — used for temporary
--     interruptions like player freeze (seal dissolution → pop back to
--     previous movement state).  If the local stack is empty, it delegates
--     to the parent state.
--
-- 12. EVENT DISPATCH AND BUBBLING.
--     dispatch_event() delivers an event depth-first: current child first,
--     then concurrent siblings.  If no child handles it, the event bubbles
--     up to the parent, then grandparent, etc.  Root-level `on` handlers
--     catch events that no substate claimed.  The `emitter` field in `on`
--     entries provides per-handler emitter filtering, so a handler can
--     restrict to events from a specific source object.

local clear_map<const> = require('cartlib/util/clear_map')
local clock<const> = require('cartlib/clock')
local frame_program<const> = require('cartlib/fsm/frame_program')
local input<const> = require('cartlib/input/input')

local state_definition<const> = {}
state_definition.__index = state_definition

local start_state_prefixes<const> = { ['_'] = true, ['#'] = true }
local no_op<const> = 'no_op'
local ignored_relative_segments<const> = { [''] = true, ['.'] = true }
local default_event_filter<const> = {}
local unfiltered_event_filter<const> = {}
local transition_no_op<const> = 0
local transition_path<const> = 1
local transition_callback<const> = 2
local compile_definition_transitions
local compile_definition_frame_evaluators
local transition_cached_path

local assert_rebind_compatible

local make_def_id<const> = function(id, parent)
	if not parent then
		return id
	end
	local separator<const> = parent.parent and '/' or ':/'
	return parent.def_id .. separator .. id
end

local compile_event_handlers<const> = function(actions)
	for name, action in pairs(actions) do
		local emitter
		local unfiltered
		if type(action) == 'table' and action.emitter ~= nil then
			if action.emitter then
				emitter = action.emitter
				if type(emitter) == 'table' and emitter.id ~= nil then
					emitter = emitter.id
				end
			else
				unfiltered = true
			end
		end
		actions[name] = { source = action, emitter = emitter, unfiltered = unfiltered }
	end
	return actions
end

local collect_event_list<const> = function(def, list, seen)
	for name, handler in pairs(def.on) do
		local emitter<const> = handler.emitter
		local unfiltered<const> = handler.unfiltered
		local filters = seen[name]
		if not filters then
			filters = {}
			seen[name] = filters
		end
		local key<const> = unfiltered and unfiltered_event_filter or emitter or default_event_filter
		if not filters[key] then
			list[#list + 1] = { name = name, emitter = emitter, unfiltered = unfiltered }
			filters[key] = true
		end
	end
	local states<const> = def.states
	local state_ids<const> = def.state_ids
	for i = 1, def.state_count do
		collect_event_list(states[state_ids[i]], list, seen)
	end
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
	local derived_tags<const> = {}
	for derived_tag in pairs(raw) do
		derived_tags[#derived_tags + 1] = derived_tag
	end
	table.sort(derived_tags)
	local compiled<const> = {}
	for i = 1, #derived_tags do
		local derived_tag<const> = derived_tags[i]
		local spec<const> = raw[derived_tag]
		local rule
		if spec[1] ~= nil then
			rule = {
				derived_tag = derived_tag,
				any = spec,
			}
		else
			rule = {
				derived_tag = derived_tag,
				any = spec.any,
				all = spec.all,
				none = spec.none,
			}
		end
		compiled[#compiled + 1] = rule
	end
	return compiled
end

local compile_timeline_definitions<const> = function(definitions)
	if definitions == nil then
		return nil
	end
	local compiled<const> = {}
	for id, definition in pairs(definitions) do
		compiled[id] = {
			id = definition.id,
			def = definition.def,
			autoplay = definition.autoplay,
			stop_on_exit = definition.stop_on_exit,
			target_path = definition.target_path,
			play_options = definition.play_options,
			on_finished = definition.on_finished,
		}
	end
	return compiled
end

function state_definition.new(id, def, root, parent)
	local self<const> = setmetatable({}, state_definition)
	self.__is_state_definition = true
	self.id = id
	self.parent = parent
	self.root = root or self
	if self.root == self then
		-- Machine input/update work follows its root clock. Event dispatch remains
		-- immediate, while timelines retain their own independently authored clock.
		self.clock_source = def.clock_source or clock.gameplay
	end
	self.def_id = def.def_id or make_def_id(id, parent)
	self.data = def.data or {}
	self.states = {}
	self.initial = def.initial
	self.on = {}
	if def.on then
		for k, v in pairs(def.on) do
			self.on[k] = v
		end
	end
	self.update = def.update
	self.entering_state = def.entering_state
	self.exiting_state = def.exiting_state
	local input_event_handlers<const> = def.input_event_handlers or {}
	self.is_concurrent = def.is_concurrent or false
	local input_eval<const> = def.input_eval
	if input_eval ~= nil then
		self.input_eval_first = input_eval == 'first'
	elseif parent then
		self.input_eval_first = parent.input_eval_first
	else
		self.input_eval_first = false
	end
	self.on = compile_event_handlers(self.on)
	self.input_event_handlers = input_event_handlers
	self.input_handler_count = #input_event_handlers
	self.input_patterns = nil
	self.input_player_indices = nil
	self.input_transition_kinds = nil
	self.input_transitions = nil
	self.event_list = def.event_list
	self.timelines = compile_timeline_definitions(def.timelines)
	self.actioneffects = def.actioneffects
	local transition_guards<const> = def.transition_guards
	self.can_enter = transition_guards and transition_guards.can_enter
	self.can_exit = transition_guards and transition_guards.can_exit
	local tags<const> = def.tags
	self.tags = tags
	if tags ~= nil then
		local tag_lookup<const> = {}
		for i = 1, #tags do
			tag_lookup[tags[i]] = true
		end
		self.tag_lookup = tag_lookup
	end
	self.path_plans = nil
	self.direct_child_plans = nil
	self.tag_derivations = nil
	if self.root == self then
		self.tag_derivations = compile_tag_derivations(def.tag_derivations)
	end

	if def.states then
		for state_id, state_def in pairs(def.states) do
			local child<const> = state_definition.new(state_id, state_def, self.root, self)
			self.states[state_id] = child
			if not self.initial and start_state_prefixes[string.sub(state_id, 1, 1)] then
				self.initial = state_id
			end
		end
	end

	-- Compiled definitions own immutable traversal order, tag membership and the
	-- dense concurrent lane that can execute frame work. Runtime trees bind these
	-- retained plans instead of rediscovering topology every frame.
	local states<const> = self.states
	local state_ids<const> = {}
	local state_count = 0
	local concurrent_state_ids
	local concurrent_state_count = 0
	local frame_concurrent_state_ids
	local frame_concurrent_state_count = 0
	local has_current_frame_work = false
	for state_id, child in pairs(states) do
		state_count = state_count + 1
		state_ids[state_count] = state_id
		if child.has_subtree_frame_work then
			has_current_frame_work = true
		end
		if child.is_concurrent then
			if concurrent_state_ids == nil then
				concurrent_state_ids = {}
			end
			concurrent_state_count = concurrent_state_count + 1
			concurrent_state_ids[concurrent_state_count] = state_id
			if child.has_subtree_frame_work then
				if frame_concurrent_state_ids == nil then
					frame_concurrent_state_ids = {}
				end
				frame_concurrent_state_count = frame_concurrent_state_count + 1
				frame_concurrent_state_ids[frame_concurrent_state_count] = state_id
			end
		end
	end
	self.state_ids = state_ids
	self.state_count = state_count
	self.concurrent_state_ids = concurrent_state_ids
	self.concurrent_state_count = concurrent_state_count
	self.frame_concurrent_state_ids = frame_concurrent_state_ids
	self.frame_concurrent_state_count = frame_concurrent_state_count
	self.has_current_frame_work = has_current_frame_work
	if not self.initial then
		self.initial = state_ids[1]
	end
	self.has_local_frame_work = self.update ~= nil or #self.input_event_handlers ~= 0
	self.has_subtree_frame_work = self.has_local_frame_work
	if not self.has_subtree_frame_work then
		for i = 1, self.state_count do
			local child<const> = states[state_ids[i]]
			if child.has_subtree_frame_work then
				self.has_subtree_frame_work = true
				break
			end
		end
	end
	if self.root == self then
		compile_definition_transitions(self)
		compile_definition_frame_evaluators(self)
		local list<const> = {}
		local seen<const> = {}
		collect_event_list(self, list, seen)
		self.event_list = list
	end
	return self
end

assert_rebind_compatible = function(previous, replacement)
	if previous.clock_source ~= replacement.clock_source then
		error('cannot rebind state definition "' .. previous.def_id .. '": clock source changed.')
	end
	local previous_states<const> = previous.states
	local previous_state_ids<const> = previous.state_ids
	for i = 1, previous.state_count do
		local state_id<const> = previous_state_ids[i]
		local previous_child<const> = previous_states[state_id]
		local replacement_child<const> = replacement.states[state_id]
		if replacement_child == nil then
			error('cannot rebind state definition "' .. previous.def_id .. '": state "' .. state_id .. '" was removed.')
		end
		if previous_child.is_concurrent ~= replacement_child.is_concurrent then
			error('cannot rebind state definition "' .. previous_child.def_id .. '": concurrent role changed.')
		end
		assert_rebind_compatible(previous_child, replacement_child)
	end
	local replacement_states<const> = replacement.states
	local replacement_state_ids<const> = replacement.state_ids
	for i = 1, replacement.state_count do
		local state_id<const> = replacement_state_ids[i]
		if previous_states[state_id] == nil and replacement_states[state_id].is_concurrent then
			error('cannot rebind state definition "' .. previous.def_id .. '": concurrent state "' .. state_id .. '" was added.')
		end
	end
end

local state<const> = {}
state.__index = state

local bst_max_history<const> = 10

local reset_state_data<const> = function(data, defaults)
	for key in pairs(data) do
		data[key] = nil
	end
	if defaults then
		for key, value in pairs(defaults) do
			data[key] = value
		end
	end
end

local is_no_op_string<const> = function(value)
	return value == no_op
end

local resolve_state_key<const> = function(definition, state_id)
	local states<const> = definition.states
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

local build_timeline_bindings<const> = function(owner, definitions)
	if not definitions then
		return nil
	end
	local bindings<const> = {}
	for key, config in pairs(definitions) do
		local id<const> = config.id or key
		local definition<const> = config.def
		if definition then
			owner.timelines:define(id, definition)
		end
		local play_options = config.play_options
		local target_path<const> = config.target_path
		if target_path ~= nil then
			local bound_options<const> = {}
			if play_options ~= nil then
				for option, value in pairs(play_options) do
					bound_options[option] = value
				end
			end
			play_options = bound_options
		end
		local binding<const> = {
			id = id,
			autoplay = config.autoplay == nil or config.autoplay,
			stop_on_exit = config.stop_on_exit == nil or config.stop_on_exit,
			play_options = play_options,
			target_path = target_path,
			finished_kind = config.finished_kind,
			finished_transition = config.finished_transition,
		}
		if binding.finished_kind ~= nil then
			binding.on_finished = state.finish_timeline
		end
		bindings[#bindings + 1] = binding
	end
	return bindings
end

local build_input_bindings<const> = function(target, definition)
	local input_patterns<const> = definition.input_patterns
	if not input_patterns then
		return nil
	end
	local player_index<const> = target.player_index
	local clock_source<const> = definition.root.clock_source
	local input_player_indices<const> = definition.input_player_indices
	local bindings<const> = {}
	for i = 1, #input_patterns do
		local binding_player_index<const> = input_player_indices and input_player_indices[i]
			or player_index
		bindings[i] = input.bind(binding_player_index, clock_source, input_patterns[i])
	end
	return bindings
end

function state.new(definition, target, parent, frame_work_owner, frame_work_changed)
	local self<const> = setmetatable({}, state)
	self.definition = definition
	self.target = target
	self.target_id = target.id
	self.localdef_id = definition.id
	self.def_id = definition.def_id
	self.parent = parent
	self.root = parent and parent.root or self
	if self.root == self then
		self.frame_work_owner = frame_work_owner
		self.frame_work_changed = frame_work_changed
	end
	self.id = self:make_id()
	self.data = {}
	reset_state_data(self.data, definition.data)
	self.states = {}
	-- Runtime nodes own mutable child instances; their traversal shape remains
	-- the definition's retained, immutable representation.
	self.state_ids = definition.state_ids
	self.state_count = definition.state_count
	self.concurrent_state_count = definition.concurrent_state_count
	if self.concurrent_state_count ~= 0 then
		self.concurrent_states = {}
	end
	self.frame_evaluator = definition.frame_evaluator
	self.current_id = nil
	-- Current child state is cached directly so the frame hot path does not keep
	-- reloading states[self.current_id] from the state map on every recursive step.
	self.current_state = nil
	self.timeline_bindings = build_timeline_bindings(target, definition.timelines)
	local timeline_bindings<const> = self.timeline_bindings
	if timeline_bindings ~= nil then
		for i = 1, #timeline_bindings do
			timeline_bindings[i].state = self
		end
	end
	self.actioneffect_ids = definition.actioneffects
	self.actioneffects_active = false
	if self.root == self then
		-- The machine root owns whole compiled transition requests. Queuing a
		-- path plan rather than individual state ids keeps hierarchical paths
		-- atomic across nested handlers without allocating in the frame path.
		self.transition_queue_origins = { false }
		self.transition_queue_plans = { false }
		self.transition_queue_count = 0
		self.critical_section_counter = 0
	end
	self._hist = {}
	self._hist_head = 0
	self._hist_size = 0
	-- active_frame_work tracks whether the currently active subtree can do any
	-- per-frame FSM work. That lets the hot path skip dormant/event-only
	-- machines instead of re-entering them every frame.
	self.active_frame_work = false
	self.tag_list = definition.tags
	self.tag_lookup = definition.tag_lookup
	self._applied_state_tags = nil
	self._tag_sync_scratch = nil
	self._tag_remove_scratch = nil
	self._active_state_tag_refs = nil
	self._active_state_tags = nil
	self.input_bindings = build_input_bindings(target, definition)
	local states<const> = self.states
	local state_ids<const> = self.state_ids
	for i = 1, self.state_count do
		local state_id<const> = state_ids[i]
		states[state_id] = state.new(definition.states[state_id], target, self, nil, nil)
	end
	local concurrent_states<const> = self.concurrent_states
	local concurrent_state_ids<const> = definition.concurrent_state_ids
	for i = 1, self.concurrent_state_count do
		concurrent_states[i] = states[concurrent_state_ids[i]]
	end
	local frame_concurrent_state_count<const> = definition.frame_concurrent_state_count
	if frame_concurrent_state_count ~= 0 then
		local frame_concurrent_states<const> = {}
		self.frame_concurrent_states = frame_concurrent_states
		local frame_concurrent_state_ids<const> = definition.frame_concurrent_state_ids
		for i = 1, frame_concurrent_state_count do
			frame_concurrent_states[i] = states[frame_concurrent_state_ids[i]]
		end
	end
	self:reset(true)
	return self
end

-- Timeline object bindings are resolved once after the prefab constructor has
-- published its component aliases and before any state can autoplay. Runtime
-- play/seek therefore consumes a retained target directly instead of walking
-- authored paths in the frame path.
function state:resolve_timeline_targets()
	local bindings<const> = self.timeline_bindings
	if bindings ~= nil then
		for binding_index = 1, #bindings do
			local binding<const> = bindings[binding_index]
			local path<const> = binding.target_path
			if path ~= nil then
				local target = self.target
				for path_index = 1, #path do
					target = target[path[path_index]]
				end
				binding.play_options.target = target
				binding.target_path = nil
			end
		end
	end
	local states<const> = self.states
	local state_ids<const> = self.state_ids
	for state_index = 1, self.state_count do
		states[state_ids[state_index]]:resolve_timeline_targets()
	end
end

local rebind_definition_tree
rebind_definition_tree = function(self, definition)
	local active<const> = self:is_active()
	local actioneffects_active<const> = self.actioneffects_active
	local previous_state_ids<const> = self.state_ids
	local previous_state_count<const> = self.state_count
	if active then
		local previous_bindings<const> = self.timeline_bindings
		if previous_bindings ~= nil then
			for i = 1, #previous_bindings do
				self.target.timelines:bind_finished(previous_bindings[i].id, nil, nil)
			end
		end
	end
	self.definition = definition
	self.frame_evaluator = definition.frame_evaluator
	self.def_id = definition.def_id
	if actioneffects_active then
		self:deactivate_actioneffects()
	end
	self.actioneffect_ids = definition.actioneffects
	if actioneffects_active then
		self:activate_actioneffects()
	end
	self.timeline_bindings = build_timeline_bindings(self.target, definition.timelines)
	local timeline_bindings<const> = self.timeline_bindings
	if timeline_bindings ~= nil then
		for i = 1, #timeline_bindings do
			timeline_bindings[i].state = self
		end
		if active then
			for i = 1, #timeline_bindings do
				local binding<const> = timeline_bindings[i]
				self.target.timelines:bind_finished(binding.id, binding.on_finished, binding)
			end
		end
	end
	self.tag_list = definition.tags
	self.tag_lookup = definition.tag_lookup
	self.input_bindings = build_input_bindings(self.target, definition)
	local states<const> = self.states
	for i = 1, previous_state_count do
		local state_id<const> = previous_state_ids[i]
		rebind_definition_tree(states[state_id], definition.states[state_id])
	end
	local state_ids<const> = definition.state_ids
	for i = 1, definition.state_count do
		local state_id<const> = state_ids[i]
		if states[state_id] == nil then
			states[state_id] = state.new(definition.states[state_id], self.target, self, nil, nil)
		end
	end
	self.state_ids = state_ids
	self.state_count = definition.state_count
	self.concurrent_state_count = definition.concurrent_state_count
	local concurrent_states<const> = self.concurrent_states
	local concurrent_state_ids<const> = definition.concurrent_state_ids
	for i = 1, self.concurrent_state_count do
		concurrent_states[i] = states[concurrent_state_ids[i]]
	end
	local frame_concurrent_state_count<const> = definition.frame_concurrent_state_count
	if frame_concurrent_state_count == 0 then
		self.frame_concurrent_states = nil
	else
		local frame_concurrent_states = self.frame_concurrent_states
		if frame_concurrent_states == nil then
			frame_concurrent_states = {}
			self.frame_concurrent_states = frame_concurrent_states
		end
		local frame_concurrent_state_ids<const> = definition.frame_concurrent_state_ids
		for i = 1, frame_concurrent_state_count do
			frame_concurrent_states[i] = states[frame_concurrent_state_ids[i]]
		end
		for i = frame_concurrent_state_count + 1, #frame_concurrent_states do
			frame_concurrent_states[i] = nil
		end
	end
end

-- Rebind a retained runtime tree to a freshly compiled definition tree. Hot
-- reload requires retained state ids and their concurrent roles to remain
-- stable. New non-concurrent branches receive fresh runtime nodes; retained
-- nodes are never reset or reconstructed to rescue incompatible graph edits.
function state:rebind_definition(definition)
	rebind_definition_tree(self, definition)
	self:resolve_timeline_targets()
	self:refresh_active_frame_work()
	self:rebuild_active_subtree_tags()
	self:sync_target_state_tags()
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

function state:timeline(id)
	local timeline<const> = self.target.timelines:get(id)
	if not timeline then
		error('timeline "' .. tostring(id) .. '" not found for target "' .. tostring(self.target_id) .. '".')
	end
	return timeline
end

function state:activate_actioneffects()
	local ids<const> = self.actioneffect_ids
	if ids == nil then
		return
	end
	self.actioneffects_active = true
	local actioneffects<const> = self.target.actioneffects
	for i = 1, #ids do
		actioneffects:activate(ids[i])
	end
end

function state:deactivate_actioneffects()
	if not self.actioneffects_active then
		return
	end
	local ids<const> = self.actioneffect_ids
	local actioneffects<const> = self.target.actioneffects
	for i = 1, #ids do
		actioneffects:deactivate(ids[i])
	end
	self.actioneffects_active = false
end

function state:activate_timelines()
	local bindings<const> = self.timeline_bindings
	if not bindings then
		return
	end
	for i = 1, #bindings do
		local binding<const> = bindings[i]
		self.target.timelines:bind_finished(binding.id, binding.on_finished, binding)
		if binding.autoplay then
			self.target.timelines:play(binding.id, binding.play_options)
		end
	end
end

function state.finish_timeline(_target, binding)
	local self<const> = binding.state
	self:enter_critical_section()
	self:execute_transition(binding.finished_kind, binding.finished_transition)
	self:leave_critical_section()
end

function state:deactivate_timelines()
	local bindings<const> = self.timeline_bindings
	if not bindings then
		return
	end
	for i = 1, #bindings do
		local binding<const> = bindings[i]
		if binding.stop_on_exit then
			self.target.timelines:stop(binding.id)
		end
		self.target.timelines:bind_finished(binding.id, nil, nil)
	end
end

function state:enter_child_state(child)
	local child_def<const> = child.definition
	child:activate_actioneffects()
	child:activate_timelines()
	local enter_child<const> = child_def.entering_state
	local next_state
	if enter_child then
		next_state = enter_child(self.target, child)
	end
	child:transition_to_next_state_if_provided(next_state)
end

function state:start()
	self:enter_critical_section()
	self:activate_actioneffects()
	self:activate_timelines()
	self:enter_initial_substate_chain()
	local queue_published<const> = self:leave_critical_section()
	if not queue_published then
		self.root:refresh_active_frame_work()
		self.root:sync_target_state_tags()
	end
end

-- enter_initial_substate_chain: recursively enters the active child tree
-- after a compound state is entered.  Called from start() (machine boot) and
-- transition_to_state() (on transition into a state that has substates).
-- The current main child is entered first, followed by concurrent siblings.
-- After each active child is entered, the runtime descends into that child's
-- own active substate tree.
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
end

function state:enter_critical_section()
	local root<const> = self.root
	root.critical_section_counter = root.critical_section_counter + 1
end

function state:leave_critical_section()
	local root<const> = self.root
	root.critical_section_counter = root.critical_section_counter - 1
	if root.critical_section_counter == 0 then
		if root.transition_queue_count ~= 0 then
			return root:process_transition_queue()
		end
	end
end

function state:transition_to_next_state_if_provided(next_state)
	if not next_state or is_no_op_string(next_state) then
		return
	end
	self:transition_to(next_state)
end

function state:execute_transition(kind, transition, payload, emitter, event_type)
	if kind == transition_path then
		transition_cached_path(self, transition)
	elseif kind == transition_callback then
		self:transition_to_next_state_if_provided(transition(self.target, self, payload, emitter, event_type))
	end
	return true
end

function state:check_state_guard_conditions(target_state)
	local exit_guard<const> = self.current_state.definition.can_exit
	if exit_guard and not exit_guard(self.target, self) then
		return false
	end
	local enter_guard<const> = target_state.definition.can_enter
	return not enter_guard or enter_guard(self.target, target_state)
end

-- transition_to_state: the core state transition operation.
-- Compiled path requests are queued at the root before reaching this method;
-- guards are evaluated here before changing the active child.
-- Sequence: exit current state → release scoped work → push history →
-- set new current_id → activate scoped work → call entering_state →
-- if entered state has substates, reset_submachine + enter_initial_substate_chain.
function state:transition_to_state(state_id)
	if self.current_id == state_id then
		return true
	end

	local cur<const> = self.states[state_id]
	if not self:check_state_guard_conditions(cur) then
		return false
	end

	self:enter_critical_section()
	local prev_id<const> = self.current_id
	local prev_instance<const> = self.current_state
	prev_instance:exit_active_subtree()
	self:push_history(prev_id)
	prev_instance:remove_active_subtree_tags()

	self.current_id = state_id
	self.current_state = cur
	local cur_def<const> = cur.definition
	cur:add_active_subtree_tags()

	cur:activate_actioneffects()
	cur:activate_timelines()
	local enter_handler<const> = cur_def.entering_state
	local next_state
	if enter_handler then
		next_state = enter_handler(self.target, cur)
	end
	cur:transition_to_next_state_if_provided(next_state)

	if cur_def.initial then
		cur:remove_active_subtree_tags()
		cur:reset_submachine(true)
		cur:add_active_subtree_tags()
		cur:enter_initial_substate_chain()
	end
	self:leave_critical_section()
	return true
end

function state:exit_active_subtree()
	local concurrent_states<const> = self.concurrent_states
	for i = self.concurrent_state_count, 1, -1 do
		concurrent_states[i]:exit_active_subtree()
	end
	local current<const> = self.current_state
	if current ~= nil then
		current:exit_active_subtree()
	end
	local exit_handler<const> = self.definition.exiting_state
	if exit_handler then
		exit_handler(self.target, self)
	end
	self:deactivate_actioneffects()
	self:deactivate_timelines()
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
		transition_cached_path(self, self.definition.direct_child_plans[popped_state_id])
	end
end

function state:get_history_snapshot()
	local out<const> = {}
	for i = 1, self._hist_size do
		out[#out + 1] = self._hist[(self._hist_head + i - 1) % bst_max_history + 1]
	end
	return out
end

local append_definition_path_segment<const> = function(plan, ctx, segment, path)
	if ignored_relative_segments[segment] then
		return ctx
	end
	if segment == '..' then
		local count<const> = plan.count
		if count > 0 then
			plan[count * 2 - 1] = nil
			plan[count * 2] = nil
			plan.count = count - 1
			return ctx.parent
		end
		if not ctx.parent then
			error('path "' .. path .. '" attempts to go above root.')
		end
		plan.up = plan.up + 1
		return ctx.parent
	end
	local key<const> = resolve_state_key(ctx, segment)
	if not key then
		local states<const> = ctx.states
		if not states then
			error('state "' .. tostring(ctx.id) .. '" does not define substates.')
		end
		local children<const> = {}
		for child_id in pairs(states) do
			children[#children + 1] = child_id
		end
		error('no state "' .. segment .. '" under "' .. tostring(ctx.def_id) .. '". children: ' .. table.concat(children, ', '))
	end
	local child<const> = ctx.states[key]
	local count<const> = plan.count + 1
	plan.count = count
	plan[count * 2 - 1] = key
	plan[count * 2] = child.is_concurrent
	return child
end

local compile_definition_path_plan<const> = function(origin_definition, path)
	local len<const> = #path
	if len == 0 then
		error('empty path is invalid.')
	end
	local i = 1
	local absolute<const> = string.byte(path, 1) == 47
	local plan<const> = { abs = absolute, up = 0, count = 0 }
	local ctx = absolute and origin_definition.root or origin_definition
	if absolute then
		i = 2
	elseif string.byte(path, 1) == 46 and string.byte(path, 2) == 47 then
		i = 3
	else
		while string.byte(path, i) == 46 and string.byte(path, i + 1) == 46 and string.byte(path, i + 2) == 47 do
			if not ctx.parent then
				error('path "' .. path .. '" attempts to go above root.')
			end
			plan.up = plan.up + 1
			ctx = ctx.parent
			i = i + 3
		end
	end
	while i <= len do
		local byte<const> = string.byte(path, i)
		if byte == 47 then
			i = i + 1
		elseif byte == 91 and string.byte(path, i + 1) == 39 then
			i = i + 2
			local segment = ''
			local closed
			while i <= len do
				local character<const> = string.byte(path, i)
				i = i + 1
				if character == 92 then
					if i <= len then
						segment = segment .. string.char(string.byte(path, i))
						i = i + 1
					end
				elseif character == 39 then
					if string.byte(path, i) ~= 93 then
						error('unterminated quoted segment in path "' .. path .. '".')
					end
					i = i + 1
					closed = true
					break
				else
					segment = segment .. string.char(character)
				end
			end
			if not closed then
				error('unterminated quoted segment in path "' .. path .. '".')
			end
			ctx = append_definition_path_segment(plan, ctx, segment, path)
		else
			local start<const> = i
			while i <= len and string.byte(path, i) ~= 47 do
				i = i + 1
			end
			ctx = append_definition_path_segment(plan, ctx, string.sub(path, start, i - 1), path)
		end
	end
	if not absolute and plan.up == 0 and plan.count == 0 then
		error('empty path is invalid.')
	end
	return plan
end

local get_definition_path_plan<const> = function(origin_definition, path)
	local cache = origin_definition.path_plans
	if cache then
		local cached<const> = cache[path]
		if cached then
			return cached
		end
	else
		cache = {}
		origin_definition.path_plans = cache
	end
	local plan<const> = compile_definition_path_plan(origin_definition, path)
	cache[path] = plan
	return plan
end

local apply_cached_path_plan<const> = function(start_state, plan)
	local ctx = plan.abs and start_state.root or start_state
	for i = 1, plan.up do
		ctx = ctx.parent
	end
	for i = 1, plan.count do
		local key<const> = plan[i * 2 - 1]
		local child<const> = ctx.states[key]
		if not plan[i * 2] and ctx.current_id ~= key then
			if not ctx:transition_to_state(key) then
				return false
			end
		end
		ctx = child
	end
	return true
end

transition_cached_path = function(start_state, plan)
	local root<const> = start_state.root
	local index<const> = root.transition_queue_count + 1
	root.transition_queue_count = index
	root.transition_queue_origins[index] = start_state
	root.transition_queue_plans[index] = plan
	if root.critical_section_counter == 0 then
		root:process_transition_queue()
	end
end

function state:process_transition_queue()
	local root<const> = self.root
	root.critical_section_counter = root.critical_section_counter + 1
	local origins<const> = root.transition_queue_origins
	local plans<const> = root.transition_queue_plans
	local i = 1
	while i <= root.transition_queue_count do
		local origin<const> = origins[i]
		local plan<const> = plans[i]
		origins[i] = false
		plans[i] = false
		apply_cached_path_plan(origin, plan)
		i = i + 1
	end
	root.transition_queue_count = 0
	root.critical_section_counter = root.critical_section_counter - 1
	root:refresh_active_frame_work()
	root:sync_target_state_tags()
	return true
end

local matches_cached_path_plan<const> = function(start_state, plan)
	if plan.count == 0 then
		return false
	end
	local ctx = plan.abs and start_state.root or start_state
	for i = 1, plan.up do
		ctx = ctx.parent
	end
	for i = 1, plan.count do
		local key<const> = plan[i * 2 - 1]
		if not plan[i * 2] and ctx.current_id ~= key then
			return false
		end
		ctx = ctx.states[key]
	end
	return true
end

function state:transition_to(state_id)
	transition_cached_path(self, get_definition_path_plan(self.definition, state_id))
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

local compile_transition<const> = function(definition, spec)
	local action = spec
	if type(action) == 'table' then
		action = action.go
	end
	if type(action) == 'string' then
		if is_no_op_string(action) then
			return transition_no_op
		end
		return transition_path, get_definition_path_plan(definition, action)
	end
	return transition_callback, action
end

compile_definition_transitions = function(definition)
	for _, handler in pairs(definition.on) do
		handler.kind, handler.transition = compile_transition(definition, handler.source)
		handler.source = nil
	end
	local timelines<const> = definition.timelines
	if timelines ~= nil then
		for _, config in pairs(timelines) do
			local on_finished<const> = config.on_finished
			if on_finished ~= nil then
				config.finished_kind, config.finished_transition = compile_transition(definition, on_finished)
			end
		end
	end
	local input_handlers<const> = definition.input_event_handlers
	local input_count<const> = definition.input_handler_count
	if input_count ~= 0 then
		local patterns<const> = {}
		local player_indices
		local kinds<const> = {}
		local transitions<const> = {}
		for i = 1, input_count do
			local entry<const> = input_handlers[i]
			patterns[i] = entry.pattern
			local entry_player_index<const> = entry.player_index
			if entry_player_index ~= nil then
				if player_indices == nil then
					player_indices = {}
				end
				player_indices[i] = entry_player_index
			end
			kinds[i], transitions[i] = compile_transition(definition, entry)
		end
		definition.input_patterns = patterns
		definition.input_player_indices = player_indices
		definition.input_transition_kinds = kinds
		definition.input_transitions = transitions
	end
	definition.input_event_handlers = nil
	local direct_child_plans
	local states<const> = definition.states
	local state_ids<const> = definition.state_ids
	for i = 1, definition.state_count do
		local state_id<const> = state_ids[i]
		local child<const> = states[state_id]
		if direct_child_plans == nil then
			direct_child_plans = {}
		end
		direct_child_plans[state_id] = {
			abs = false,
			up = 0,
			count = 1,
			state_id,
			child.is_concurrent,
		}
	end
	definition.direct_child_plans = direct_child_plans
	for i = 1, definition.state_count do
		compile_definition_transitions(states[state_ids[i]])
	end
end

compile_definition_frame_evaluators = function(definition)
	local states<const> = definition.states
	local state_ids<const> = definition.state_ids
	for i = 1, definition.state_count do
		compile_definition_frame_evaluators(states[state_ids[i]])
	end
	if definition.has_subtree_frame_work then
		definition.frame_evaluator = frame_program.compile_state_evaluator(definition, no_op)
	end
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
-- against this machine's previously applied tags on the target object. Called
-- after every transition; the target aggregates contributions from all FSMs,
-- timelines and explicit cart state.
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
		target:_release_tag(tag)
		prev_tags[tag] = nil
	end

	for tag in pairs(next_tags) do
		if not prev_tags[tag] then
			target:_retain_tag(tag)
			prev_tags[tag] = true
		end
	end
end

function state:handle_event(event_name, payload, emitter, emitter_id)
	local handler<const> = self.definition.on[event_name]
	if not handler then
		return false
	end
	if not handler.unfiltered then
		local expected_emitter<const> = handler.emitter or self.target_id
		if emitter_id ~= expected_emitter then
			return false
		end
	end
	self:enter_critical_section()
	local handled<const> = self:execute_transition(handler.kind, handler.transition, payload, emitter, event_name)
	self:leave_critical_section()
	return handled
end

local dispatch_resolved_event

dispatch_resolved_event = function(self, event_name, payload, emitter, emitter_id)
	local handled
	local child<const> = self.current_state
	if child ~= nil then
		handled = dispatch_resolved_event(child, event_name, payload, emitter, emitter_id)
		local concurrent_states<const> = self.concurrent_states
		for i = 1, self.concurrent_state_count do
			if dispatch_resolved_event(concurrent_states[i], event_name, payload, emitter, emitter_id) then
				handled = true
			end
		end
		if handled then
			return true
		end
	end
	return self:handle_event(event_name, payload, emitter, emitter_id)
end

-- dispatch_event: delivers an event through the state hierarchy.
-- Dispatch order: current child (depth-first) → concurrent siblings →
-- if unhandled, bubble to parent → grandparent → root.  Root-level `on`
-- handlers are the catch-all.  Returns true if any handler consumed the event.
function state:dispatch_event(event_name, payload, emitter, emitter_id)
	return dispatch_resolved_event(self, event_name, payload, emitter, emitter_id)
end

-- FSM components call update only on machine roots; child states are traversed
-- by their definition-owned evaluator inside this single critical scope.
function state:update()
	self.critical_section_counter = 1
	self:frame_evaluator()
	self.critical_section_counter = 0
	if self.transition_queue_count ~= 0 then
		self:process_transition_queue()
	end
end

local refresh_active_subtree_frame_work
refresh_active_subtree_frame_work = function(self)
	local definition<const> = self.definition
	if not definition.has_subtree_frame_work then
		self.active_frame_work = false
		return false
	end
	local active<const> = definition.has_local_frame_work
	local subtree_active = active
	local current<const> = self.current_state
	if current ~= nil and refresh_active_subtree_frame_work(current) then
		subtree_active = true
	end
	local concurrent_states<const> = self.concurrent_states
	for i = 1, self.concurrent_state_count do
		if refresh_active_subtree_frame_work(concurrent_states[i]) then
			subtree_active = true
		end
	end
	self.active_frame_work = subtree_active
	return subtree_active
end

function state:refresh_active_frame_work()
	local previous<const> = self.active_frame_work
	local active<const> = refresh_active_subtree_frame_work(self)
	if previous ~= active then
		self.frame_work_changed(self.frame_work_owner, self, active)
	end
	return active
end

function state:reset(reset_tree)
	local should_reset = reset_tree
	if should_reset == nil then
		should_reset = true
	end
	if should_reset then
		self:reset_submachine(true)
	else
		reset_state_data(self.data, self.definition.data)
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
	if self:is_root() then
		local origins<const> = self.transition_queue_origins
		local plans<const> = self.transition_queue_plans
		for i = 1, self.transition_queue_count do
			origins[i] = false
			plans[i] = false
		end
		self.transition_queue_count = 0
	end
	reset_state_data(self.data, def.data)
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
	self:deactivate_actioneffects()
	self:deactivate_timelines()
	if self:is_root() then
		local applied<const> = self._applied_state_tags
		if applied then
			for tag in pairs(applied) do
				self.target:_release_tag(tag)
			end
		end
	end
	local states<const> = self.states
	local state_ids<const> = self.state_ids
	for i = 1, self.state_count do
		states[state_ids[i]]:dispose()
	end
end

return {
	assert_rebind_compatible = assert_rebind_compatible,
	bind_state_path = get_definition_path_plan,
	matches_state_path = matches_cached_path_plan,
	state_definition = state_definition,
	state = state,
	transition_state_path = transition_cached_path,
}
