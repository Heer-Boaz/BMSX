-- progression.lua
-- singleton event-driven progression service

local eventemitter = require('eventemitter').eventemitter
local event_matcher = require('event_matcher')
local progression_core = require('progression_core')

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

local EMPTY_LIST = {}

local function compile_set_actions(state_program, actions)
	if actions == nil then
		return EMPTY_LIST
	end
	for i = 1, #actions do
		local action = actions[i]
		local key = action.key
		if type(key) ~= 'string' or key == '' then
			error("progression set action at index " .. i .. " must define a non-empty string key.")
		end
		progression_core.ensure_key(state_program, key)
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
		rule_defs = EMPTY_LIST
		handlers = {}
	elseif program_spec.rules ~= nil or program_spec.handlers ~= nil or program_spec.keys ~= nil then
		rule_defs = program_spec.rules or EMPTY_LIST
		handlers = program_spec.handlers or {}
		seed_keys = program_spec.keys
	else
		rule_defs = program_spec
		handlers = {}
	end

	local state_program = progression_core.compile_program({
		keys = seed_keys,
		rules = EMPTY_LIST,
	})
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
			when_all = progression_core.compile_filter(state_program, rule_def.when_all),
			when_event = event_matcher.compile(rule_def.when_event),
			set = compile_set_actions(state_program, rule_def.set),
			apply = rule_def.apply or EMPTY_LIST,
			apply_once = rule_def.apply_once == true,
		}
		rules[i] = rule
		local event_rules = rules_by_event[event_name]
		if event_rules == nil then
			event_rules = {}
			rules_by_event[event_name] = event_rules
		end
		event_rules[#event_rules + 1] = rule
		if seen_event[event_name] ~= true then
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

local function apply_set_actions(runtime, actions)
	local changed = false
	local state = runtime.state
	for i = 1, #actions do
		local action = actions[i]
		if state:set(action.key, action.value) then
			changed = true
		end
	end
	return changed
end

local function apply_commands(runtime, commands, event)
	local handlers = runtime.program.handlers
	local ctx = runtime.ctx
	for i = 1, #commands do
		local command = commands[i]
		handlers[command.op](ctx, command, event)
	end
end

local function dispatch_event_now(event)
	local runtime = runtime_for_event(event)
	if runtime == nil then
		return
	end
	local rules = runtime.program.rules_by_event[event.type]
	if rules == nil then
		return
	end
	local fired = {}
	local changed
	repeat
		changed = false
		for i = 1, #rules do
			if fired[i] ~= true then
				local rule = rules[i]
				if rule.when_event(event) and runtime.state:matches_filter(rule.when_all) then
					fired[i] = true
					if not rule.apply_once or runtime.apply_done[rule.id] ~= true then
						if apply_set_actions(runtime, rule.set) then
							changed = true
						end
						apply_commands(runtime, rule.apply, event)
						if rule.apply_once then
							runtime.apply_done[rule.id] = true
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
	local state = progression_core.progression.new(program.state_program)

	local runtime = {
		ctx = ctx,
		program = program,
		state = state,
		apply_done = {},
	}
	progression._runtime_by_ctx[ctx] = runtime
	progression._runtime_by_service_id[ctx.id] = runtime
	return runtime
end

function progression.unmount(ctx)
	local runtime = progression._runtime_by_ctx[ctx]
	if runtime == nil then
		return
	end
	progression._runtime_by_ctx[ctx] = nil
	progression._runtime_by_service_id[ctx.id] = nil
end

function progression.matches(ctx, filter)
	return progression._runtime_by_ctx[ctx].state:matches_filter(filter)
end

function progression.set(ctx, key, value)
	local runtime = progression._runtime_by_ctx[ctx]
	return runtime.state:set(key, value)
end

function progression.get(ctx, key)
	return progression._runtime_by_ctx[ctx].state:get(key)
end

return progression
