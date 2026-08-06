-- progression.lua
-- singleton event-driven progression state router
--
-- DESIGN PRINCIPLES — progression state rules
--
-- 1. WHAT IS progression?
--    A rules layer that listens to the specific global events referenced by
--    mounted programs and updates one or more
--    'state programs' (key/value maps) based on declarative rules.  It is used
--    to track persistent world state that evolves as gameplay events fire
--    (e.g. 'has_sword' and 'room_2_cleared').
--
-- 2. USAGE PATTERN.
--
--    STEP 1 — compile the cart-owned rules and query filters, then mount that
--    program onto a context:
--      local program = progression.compile_program({
--          rules = {
--              { id = 'record_kill', on = 'enemy.defeated',
--                set = {{ key = 'kills', value = true }} },
--          },
--          filters = { bonus_filter },
--          handlers = {},
--      })
--      progression.mount(castle, program)
--    Unmount it from the context's unbind() teardown.
--
--    STEP 2 — events flow through automatically (no manual dispatch needed
--    for events emitted to the global eventemitter; progression subscribes to
--    the exact event names referenced by mounted programs).
--
--    STEP 3 — query state:
--      if progression.get(castle, 'bonus_active') then ... end
--      progression.matches(castle, bonus_filter)
--
-- 3. RULE ANATOMY.
--    Each rule is a table with these fields:
--      on          — event name (required); the event that can fire this rule
--      when_all    — array of conditions ({key, equals}) that must
--                    all be true on the state for the rule to fire
--      when_event  — event-matcher spec (see eventmatcher.lua) filtering event
--                    payload fields
--      set         — array of {key, value} assignments applied when fired
--      apply       — array of custom commands forwarded to program.handlers
--      apply_once  — if true, this rule will only fire once per mounted runtime
--
-- 4. CONDITIONS.
--    Conditions have one representation: { key = 'key_name', equals = true }.
--    Query filters must be listed in compile_program().filters so key interning
--    and predicate compilation finish before the runtime is mounted.
--
-- 5. DO NOT USE progression FOR FRAME-BY-FRAME GAME LOGIC.
--    Progression is for persistent cross-room world-state transitions
--    driven by named gameplay events.  Transient per-frame state belongs in the
--    object FSM or in worldobject fields directly.

local eventemitter<const> = require('cartlib/eventemitter')
local eventmatcher<const> = require('cartlib/eventmatcher')

local progression<const> = {}
local runtime_by_ctx<const> = {}
local runtimes_by_event<const> = {}

local progression_state<const> = {}
progression_state.__index = progression_state

local empty_list<const> = {}

local intern_key<const> = function(program, key)
	local key_idx = program.key2idx[key]
	if key_idx ~= nil then
		return key_idx
	end
	key_idx = program.key_count + 1
	program.key_count = key_idx
	program.key2idx[key] = key_idx
	return key_idx
end

local compile_predicates<const> = function(program, source)
	if source == nil then
		return empty_list
	end
	for i = #source, 1, -1 do
		local condition<const> = source[i]
		local out_index<const> = i * 2
		source[out_index - 1] = intern_key(program, condition.key)
		source[out_index] = condition.equals
	end
	return source
end

local eval_predicates<const> = function(values, predicates)
	for i = 1, #predicates, 2 do
		local left = values[predicates[i]]
		if left == nil then
			left = false
		end
		if left ~= predicates[i + 1] then
			return false
		end
	end
	return true
end

function progression_state.new(program)
	return setmetatable({
		program = program,
		values = {},
		revision = 0,
	}, progression_state)
end

function progression_state:set_index(key_idx, value)
	if self.values[key_idx] == value then
		return false
	end
	self.values[key_idx] = value
	self.revision = self.revision + 1
	return true
end

function progression_state:get(key)
	return self.values[self.program.key2idx[key]]
end

function progression_state:matches_filter(filter)
	return eval_predicates(self.values, filter)
end

local compile_set_actions<const> = function(state_program, actions)
	if actions == nil then
		return empty_list
	end
	for i = #actions, 1, -1 do
		local action<const> = actions[i]
		local out_index<const> = i * 2
		actions[out_index - 1] = intern_key(state_program, action.key)
		actions[out_index] = action.value
	end
	return actions
end

local compile_commands<const> = function(handlers, commands)
	if commands == nil then
		return empty_list
	end
	for i = #commands, 1, -1 do
		local command<const> = commands[i]
		local out_index<const> = i * 2
		commands[out_index - 1] = handlers[command.op]
		commands[out_index] = command
	end
	return commands
end

-- progression.compile_program(program_spec)
--   Compiles the cart-owned rules and every query filter into retained indexed
--   runtime data before mount() publishes the program. Condition arrays are
--   consumed in place and become the compiled handles passed to matches().
function progression.compile_program(program_spec)
	local rule_defs<const> = program_spec.rules
	local handlers<const> = program_spec.handlers
	local state_program<const> = {
		key2idx = {},
		key_count = 0,
	}
	local rules_by_event<const> = {}
	local event_names<const> = {}
	local seen_event<const> = {}
	for i = 1, #rule_defs do
		local rule_def<const> = rule_defs[i]
		local event_name<const> = rule_def.on
		local rule<const> = {
			id = rule_def.id,
			when_all = compile_predicates(state_program, rule_def.when_all),
			when_event = eventmatcher.compile(rule_def.when_event),
			set = compile_set_actions(state_program, rule_def.set),
			apply = compile_commands(handlers, rule_def.apply),
			apply_once = (rule_def.apply_once),
		}
		local event_rules = rules_by_event[event_name]
		if event_rules == nil then
			event_rules = {}
			rules_by_event[event_name] = event_rules
		end
		event_rules[#event_rules + 1] = rule
		if not (seen_event[event_name]) then
			seen_event[event_name] = true
			event_names[#event_names + 1] = event_name
		end
	end
	local filters<const> = program_spec.filters
	for i = 1, #filters do
		compile_predicates(state_program, filters[i])
	end
	state_program.key_count = nil

	local program<const> = {
		state_program = state_program,
		rules_by_event = rules_by_event,
		event_names = event_names,
	}
	return program
end

local apply_set_actions<const> = function(rt, actions)
	local state<const> = rt.state
	for i = 1, #actions, 2 do
		state:set_index(actions[i], actions[i + 1])
	end
end

local apply_commands<const> = function(rt, commands, payload, emitter, event_type)
	local ctx<const> = rt.ctx
	for i = 1, #commands, 2 do
		commands[i](ctx, commands[i + 1], payload, emitter, event_type)
	end
end

local dispatch_rules_to_runtime<const> = function(rt, rules, event_type, emitter, payload)
	local depth<const> = rt.dispatch_depth + 1
	rt.dispatch_depth = depth
	local fired = rt.fired_by_depth[depth]
	if fired == nil then
		fired = {}
		rt.fired_by_depth[depth] = fired
		rt.fired_generation_by_depth[depth] = 0
	end
	local generation<const> = rt.fired_generation_by_depth[depth] + 1
	rt.fired_generation_by_depth[depth] = generation
	local revision
	repeat
		revision = rt.state.revision
		for i = 1, #rules do
			if fired[i] ~= generation then
				local rule<const> = rules[i]
				if rule.when_event(payload) and eval_predicates(rt.state.values, rule.when_all) then
					fired[i] = generation
					if not rule.apply_once or not (rt.apply_done[rule.id]) then
						if rule.apply_once then
							rt.apply_done[rule.id] = true
						end
						apply_set_actions(rt, rule.set)
						apply_commands(rt, rule.apply, payload, emitter, event_type)
					end
				end
			end
		end
	until rt.state.revision == revision
	rt.dispatch_depth = depth - 1
end

local dispatch_event<const> = function(event_type, emitter, payload)
	local runtimes<const> = runtimes_by_event[event_type]
	if runtimes == nil then
		return
	end
	local runtime_count<const> = #runtimes
	local dispatch_depth<const> = runtimes.dispatch_depth + 1
	runtimes.dispatch_depth = dispatch_depth
	for i = 1, runtime_count do
		local rt<const> = runtimes[i]
		if rt then
			local rules<const> = rt.program.rules_by_event[event_type]
			if rules ~= nil then
				dispatch_rules_to_runtime(rt, rules, event_type, emitter, payload)
			end
		end
	end
	local next_dispatch_depth<const> = dispatch_depth - 1
	runtimes.dispatch_depth = next_dispatch_depth
	if next_dispatch_depth == 0 and runtimes.removals_pending then
		local list_count<const> = #runtimes
		local write_index = 1
		for read_index = 1, list_count do
			local rt<const> = runtimes[read_index]
			if rt then
				runtimes[write_index] = rt
				write_index = write_index + 1
			end
		end
		for index = write_index, list_count do
			runtimes[index] = nil
		end
		runtimes.removals_pending = nil
		if write_index == 1 then
			runtimes_by_event[event_type] = nil
			eventemitter:off(event_type, dispatch_event, nil)
		end
	end
end

local add_runtime_subscription<const> = function(rt, event_name)
	local runtimes = runtimes_by_event[event_name]
	if runtimes == nil then
		runtimes = { dispatch_depth = 0 }
		runtimes_by_event[event_name] = runtimes
		eventemitter:on({
			event = event_name,
			handler = dispatch_event,
			subscriber = progression,
		})
	end
	runtimes[#runtimes + 1] = rt
end

local remove_runtime_subscription<const> = function(rt, event_name)
	local runtimes<const> = runtimes_by_event[event_name]
	if runtimes == nil then
		return
	end
	for i = #runtimes, 1, -1 do
		if runtimes[i] == rt then
			if runtimes.dispatch_depth == 0 then
				table.remove(runtimes, i)
			else
				runtimes[i] = false
				runtimes.removals_pending = true
			end
			break
		end
	end
	if runtimes.dispatch_depth == 0 and #runtimes == 0 then
		runtimes_by_event[event_name] = nil
		eventemitter:off(event_name, dispatch_event, nil)
	end
end

-- progression.mount(ctx, program)
--   Attaches a compiled progression program to ctx.
function progression.mount(ctx, program)
	progression.unmount(ctx)
	local state<const> = progression_state.new(program.state_program)

	local rt<const> = {
		ctx = ctx,
		program = program,
		state = state,
		apply_done = {},
		dispatch_depth = 0,
		fired_by_depth = { {} },
		fired_generation_by_depth = { 0 },
	}
	runtime_by_ctx[ctx] = rt
	for i = 1, #program.event_names do
		add_runtime_subscription(rt, program.event_names[i])
	end
	return rt
end

-- progression.unmount(ctx): detaches the progression runtime for ctx.
--   Call this in unbind() or when the context is no longer needed, otherwise
--   the runtime leaks and keeps responding to global events.
function progression.unmount(ctx)
	local rt<const> = runtime_by_ctx[ctx]
	if rt == nil then
		return
	end
	runtime_by_ctx[ctx] = nil
	local event_names<const> = rt.program.event_names
	for i = 1, #event_names do
		remove_runtime_subscription(rt, event_names[i])
	end
end

-- progression.matches(ctx, filter): returns true if all predicates in the
--   compiled filter handle are currently true in ctx's progression state.
function progression.matches(ctx, filter)
	return runtime_by_ctx[ctx].state:matches_filter(filter)
end

-- progression.set(ctx, key, value): directly sets a state key on ctx's runtime.
--   Use only for initialisation or testing; prefer rule-driven set actions.
function progression.set(ctx, key, value)
	local state<const> = runtime_by_ctx[ctx].state
	return state:set_index(state.program.key2idx[key], value)
end

-- progression.get(ctx, key): reads a state key from ctx's progression runtime.
--   Returns nil if the key has never been set.
function progression.get(ctx, key)
	return runtime_by_ctx[ctx].state:get(key)
end

return progression
