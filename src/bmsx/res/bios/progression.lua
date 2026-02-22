-- progression.lua
-- singleton event-driven progression service

local eventemitter = require('eventemitter').eventemitter
local event_matcher = require('event_matcher')

local progression = {
	_inited = false,
	_bound = false,
	_any_handler = nil,
	_runtime_by_ctx = setmetatable({}, { __mode = 'k' }),
	_runtime_by_service_id = {},
	_event_queue = {},
	_event_head = 1,
	_event_tail = 0,
	_is_dispatching = false,
}

local progression_state = {}
progression_state.__index = progression_state

local empty_list = {}

local op_eq = 1
local op_ne = 2
local op_lt = 3
local op_lte = 4
local op_gt = 5
local op_gte = 6

local op_by_text = {
	['=='] = op_eq,
	['='] = op_eq,
	eq = op_eq,
	['!='] = op_ne,
	['~='] = op_ne,
	ne = op_ne,
	['<'] = op_lt,
	lt = op_lt,
	['<='] = op_lte,
	lte = op_lte,
	['>'] = op_gt,
	gt = op_gt,
	['>='] = op_gte,
	gte = op_gte,
}

local function new_state_program()
	return {
		key2idx = {},
		idx2key = {},
	}
end

local function default_for(value)
	local value_type = type(value)
	if value_type == 'boolean' then
		return false
	end
	if value_type == 'number' then
		return 0
	end
	return nil
end

local function compare(left, op, right)
	if op == op_eq then
		return left == right
	end
	if op == op_ne then
		return left ~= right
	end
	if op == op_lt then
		return left < right
	end
	if op == op_lte then
		return left <= right
	end
	if op == op_gt then
		return left > right
	end
	return left >= right
end

local function intern_key(program, key)
	local key_idx = program.key2idx[key]
	if key_idx ~= nil then
		return key_idx
	end
	key_idx = #program.idx2key + 1
	program.key2idx[key] = key_idx
	program.idx2key[key_idx] = key
	return key_idx
end

local function normalize_condition(spec)
	if type(spec) == 'string' then
		if spec:sub(1, 1) == '!' then
			return spec:sub(2), op_eq, false
		end
		return spec, op_eq, true
	end

	if type(spec) ~= 'table' then
		error('progression condition must be string or table.')
	end

	local key = spec.key or spec[1]
	if type(key) ~= 'string' then
		error('progression condition is missing key.')
	end

	local op_text = spec.op or spec[2] or '=='
	local op = op_by_text[op_text]
	if op == nil then
		error("progression condition has unknown operator '" .. tostring(op_text) .. "'.")
	end

	local value = spec.equals
	if value == nil then
		value = spec.value
	end
	if value == nil then
		value = spec[3]
	end
	if value == nil then
		value = true
	end

	if (op == op_lt or op == op_lte or op == op_gt or op == op_gte) and type(value) ~= 'number' then
		error("progression condition '" .. key .. "' expects numeric value for operator '" .. tostring(op_text) .. "'.")
	end

	return key, op, value
end

local function is_compiled_predicates(source)
	if type(source) ~= 'table' then
		return false
	end
	local count = #source
	if count == 0 then
		return true
	end
	if count % 4 ~= 0 then
		return false
	end
	return type(source[1]) == 'number'
end

local function compile_predicates(program, source)
	if source == nil then
		return empty_list
	end
	local compiled = {}
	local out_index = 1
	for i = 1, #source do
		local key, op, value = normalize_condition(source[i])
		compiled[out_index] = intern_key(program, key)
		compiled[out_index + 1] = op
		compiled[out_index + 2] = value
		compiled[out_index + 3] = default_for(value)
		out_index = out_index + 4
	end
	return compiled
end

local function compile_filter(program, source)
	if is_compiled_predicates(source) then
		return source
	end
	return compile_predicates(program, source)
end

local function eval_predicates(values, predicates)
	for i = 1, #predicates, 4 do
		local left = values[predicates[i]]
		if left == nil then
			left = predicates[i + 3]
		end
		if not compare(left, predicates[i + 1], predicates[i + 2]) then
			return false
		end
	end
	return true
end

function progression_state.new(program)
	return setmetatable({
		program = program or new_state_program(),
		values = {},
		filter_cache = setmetatable({}, { __mode = 'k' }),
	}, progression_state)
end

function progression_state:set(key, value)
	local key_idx = self.program.key2idx[key]
	if key_idx == nil then
		key_idx = intern_key(self.program, key)
	end
	if self.values[key_idx] == value then
		return false
	end
	self.values[key_idx] = value
	return true
end

function progression_state:get(key)
	local key_idx = self.program.key2idx[key]
	if key_idx == nil then
		return nil
	end
	return self.values[key_idx]
end

function progression_state:matches_filter(filter)
	if filter == nil then
		return true
	end
	if is_compiled_predicates(filter) then
		return eval_predicates(self.values, filter)
	end
	local cached = self.filter_cache[filter]
	if cached == nil then
		cached = compile_predicates(self.program, filter)
		self.filter_cache[filter] = cached
	end
	return eval_predicates(self.values, cached)
end

local function compile_set_actions(state_program, actions)
	if actions == nil then
		return empty_list
	end
	for i = 1, #actions do
		local action = actions[i]
		local key = action.key
		if type(key) ~= 'string' then
			error("progression set action at index " .. i .. " must define a string key.")
		end
		intern_key(state_program, key)
	end
	return actions
end

function progression.compile_program(program_spec)
	if program_spec ~= nil and program_spec.state_program ~= nil and program_spec.rules_by_event ~= nil then
		return program_spec
	end

	local rule_defs
	local handlers
	local seed_keys

	if program_spec == nil then
		rule_defs = empty_list
		handlers = {}
	elseif program_spec.rules ~= nil or program_spec.handlers ~= nil or program_spec.keys ~= nil then
		rule_defs = program_spec.rules or empty_list
		handlers = program_spec.handlers or {}
		seed_keys = program_spec.keys
	else
		rule_defs = program_spec
		handlers = {}
	end

	local state_program = new_state_program()
	if seed_keys ~= nil then
		for i = 1, #seed_keys do
			intern_key(state_program, seed_keys[i])
		end
	end
	local rules = {}
	local rules_by_event = {}
	local event_names = {}
	local seen_event = {}
	for i = 1, #rule_defs do
		local rule_def = rule_defs[i]
		local event_name = rule_def.on
		local rule = {
			id = rule_def.id or ('rule_' .. i),
			on = event_name,
			when_all = compile_filter(state_program, rule_def.when_all),
			when_event = event_matcher.compile(rule_def.when_event),
			set = compile_set_actions(state_program, rule_def.set),
			apply = rule_def.apply or empty_list,
			apply_once = (rule_def.apply_once),
		}
		rules[i] = rule
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

	return {
		state_program = state_program,
		rules = rules,
		rules_by_event = rules_by_event,
		event_names = event_names,
		handlers = handlers,
	}
end

local function runtime_for_event(event)
	local service_id = event.service_id
	if service_id == nil and event.emitter ~= nil then
		service_id = event.emitter.id
	end
	if service_id == nil then
		return nil
	end
	return progression._runtime_by_service_id[service_id]
end

local function apply_set_actions(rt, actions)
	local changed
	local state = rt.state
	for i = 1, #actions do
		local action = actions[i]
		if state:set(action.key, action.value) then
			changed = true
		end
	end
	return changed
end

local function apply_commands(rt, commands, event)
	local handlers = rt.program.handlers
	local ctx = rt.ctx
	for i = 1, #commands do
		local command = commands[i]
		handlers[command.op](ctx, command, event)
	end
end

local function dispatch_event_now(event)
	local rt = runtime_for_event(event)
	if rt == nil then
		return
	end
	local rules = rt.program.rules_by_event[event.type]
	if rules == nil then
		return
	end
	local fired = {}
	local changed
	repeat
		changed = false
		for i = 1, #rules do
			if not (fired[i]) then
				local rule = rules[i]
				if rule.when_event(event) and rt.state:matches_filter(rule.when_all) then
					fired[i] = true
					if not rule.apply_once or not (rt.apply_done[rule.id]) then
						if apply_set_actions(rt, rule.set) then
							changed = true
						end
						apply_commands(rt, rule.apply, event)
						if rule.apply_once then
							rt.apply_done[rule.id] = true
						end
					end
				end
			end
		end
	until not changed
end

function progression.dispatch_event(event)
	local tail = progression._event_tail + 1
	progression._event_tail = tail
	progression._event_queue[tail] = event
	if progression._is_dispatching then
		return
	end
	progression._is_dispatching = true
	while progression._event_head <= progression._event_tail do
		local head = progression._event_head
		local queued_event = progression._event_queue[head]
		progression._event_queue[head] = nil
		progression._event_head = head + 1
		dispatch_event_now(queued_event)
	end
	progression._event_head = 1
	progression._event_tail = 0
	progression._is_dispatching = false
end

function progression.init()
	if progression._inited then
		return
	end
	progression._inited = true
	progression._any_handler = function(event)
		progression.dispatch_event(event)
	end
	eventemitter.instance:on_any(progression._any_handler, true, progression)
	progression._bound = true
end

function progression.mount(ctx, program_or_rule_defs)
	local program = progression.compile_program(program_or_rule_defs)
	local state = progression_state.new(program.state_program)

	local rt = {
		ctx = ctx,
		program = program,
		state = state,
		apply_done = {},
	}
	progression._runtime_by_ctx[ctx] = rt
	progression._runtime_by_service_id[ctx.id] = rt
	return rt
end

function progression.unmount(ctx)
	local rt = progression._runtime_by_ctx[ctx]
	if rt == nil then
		return
	end
	progression._runtime_by_ctx[ctx] = nil
	progression._runtime_by_service_id[ctx.id] = nil
end

function progression.matches(ctx, filter)
	return progression._runtime_by_ctx[ctx].state:matches_filter(filter)
end

function progression.set(ctx, key, value)
	local rt = progression._runtime_by_ctx[ctx]
	return rt.state:set(key, value)
end

function progression.get(ctx, key)
	return progression._runtime_by_ctx[ctx].state:get(key)
end

return progression
