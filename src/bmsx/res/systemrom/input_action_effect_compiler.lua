-- input_action_effect_compiler.lua
-- compile input action effect programs into executable bindings

local action_effects = require("action_effects")
local eventemitter = require("eventemitter")

local compile_effect_list

local function is_effect_trigger(effect)
	return effect["effect.trigger"] ~= nil
end

local function is_input_consume(effect)
	return effect["input.consume"] ~= nil
end

local function is_gameplay_emit(effect)
	return effect["emit.gameplay"] ~= nil
end

local function is_nested_commands(effect)
	return effect.commands ~= nil
end

local function execute_effect_trigger(env, id, payload)
	local effects = env.effects
	if not effects then
		error("[inputactioneffectcompiler] effect trigger '" .. id .. "' attempted without actioneffectcomponent on '" .. env.owner_id .. "'.")
	end
	if payload == nil then
		return effects:trigger(id)
	end
	return effects:trigger(id, { payload = payload })
end

local function compile_effect(effect, slot, analysis)
	if is_effect_trigger(effect) then
		if analysis then
			analysis.uses_effect_triggers = true
		end
		local spec = effect["effect.trigger"]
		if type(spec) == "string" then
			return function(env)
				execute_effect_trigger(env, spec)
			end
		end
		return function(env)
			execute_effect_trigger(env, spec.id, spec.payload)
		end
	end
	if is_input_consume(effect) then
		local actions = effect["input.consume"]
		if type(actions) ~= "table" then
			actions = { actions }
		end
		return function(env)
			for i = 1, #actions do
				$.consume_action(env.player_index, actions[i])
			end
		end
	end
	if is_gameplay_emit(effect) then
		local spec = effect["emit.gameplay"]
		return function(env)
			local payload = spec.payload or {}
			local base = { type = spec.event }
			for k, v in pairs(payload) do
				base[k] = v
			end
			env.queued_events[#env.queued_events + 1] = eventemitter.create_gameevent(base)
		end
	end
	if is_nested_commands(effect) then
		local nested = compile_effect_list(effect.commands, slot, analysis)
		return nested
	end
	error("[inputactioneffectcompiler] unknown effect in slot '" .. (slot or "unknown") .. "'.")
end

local function compile_effect_list(spec, slot, analysis)
	if not spec then
		return nil
	end
	local entries
	if type(spec) == "table" and spec[1] ~= nil then
		entries = spec
	else
		entries = { spec }
	end
	local executors = {}
	for i = 1, #entries do
		executors[#executors + 1] = compile_effect(entries[i], slot, analysis)
	end
	if #executors == 1 then
		return executors[1]
	end
	return function(env)
		for i = 1, #executors do
			executors[i](env)
		end
	end
end

local function compile_predicate(binding)
	local when = binding.when
	if not when then
		return function()
			return true
		end
	end
	local mode_pred = when.mode
	local mode_items = nil
	if mode_pred then
		if type(mode_pred) == "table" then
			mode_items = mode_pred
		else
			mode_items = { mode_pred }
		end
	end
	if not mode_items then
		return function()
			return true
		end
	end
	return function(env)
		for i = 1, #mode_items do
			local entry = mode_items[i]
			local matches = env.owner.sc:matches_state_path(entry.path)
			if entry["not"] then
				if matches then
					return false
				end
			else
				if not matches then
					return false
				end
			end
		end
		return true
	end
end

local function compile_custom_effects(binding, analysis)
	local map = {}
	local table_go = binding.go or {}
	for key, spec in pairs(table_go) do
		if key ~= "press" and key ~= "hold" and key ~= "release" then
			map[key] = compile_effect_list(spec, key, analysis)
		end
	end
	return map
end

local function compile_binding(binding, parse)
	local priority = binding.priority or 0
	local analysis = { uses_effect_triggers = false }
	local predicate = compile_predicate(binding)
	local on = binding.on
	if not on then
		error("[inputactioneffectcompiler] binding '" .. (binding.name or "(unnamed)") .. "' is missing an 'on' clause.")
	end
	local press = on.press and parse(on.press) or nil
	local hold = on.hold and parse(on.hold) or nil
	local release = on.release and parse(on.release) or nil
	local custom_entries = on.custom or {}
	local custom_effects = compile_custom_effects(binding, analysis)
	local custom_edges = {}
	for i = 1, #custom_entries do
		local entry = custom_entries[i]
		custom_edges[#custom_edges + 1] = {
			name = entry.name,
			match = parse(entry.pattern),
			effect = custom_effects[entry.name],
		}
	end

	return {
		name = binding.name,
		priority = priority,
		predicate = predicate,
		press = press,
		hold = hold,
		release = release,
		press_effect = compile_effect_list(binding.go and binding.go.press or nil, "press", analysis),
		hold_effect = compile_effect_list(binding.go and binding.go.hold or nil, "hold", analysis),
		release_effect = compile_effect_list(binding.go and binding.go.release or nil, "release", analysis),
		custom_edges = custom_edges,
		uses_effect_triggers = analysis.uses_effect_triggers,
	}
end

function compile_program(program, parse)
	local prog_priority = program.priority or 0
	local eval_mode = program.eval or "first"
	local bindings = program.bindings or {}

	local compiled_entries = {}
	for i = 1, #bindings do
		compiled_entries[#compiled_entries + 1] = {
			index = i,
			compiled = compile_binding(bindings[i], parse),
		}
	end

	table.sort(compiled_entries, function(a, b)
		if a.compiled.priority ~= b.compiled.priority then
			return a.compiled.priority > b.compiled.priority
		end
		return a.index < b.index
	end)

	local uses_effect_triggers = false
	for i = 1, #compiled_entries do
		if compiled_entries[i].compiled.uses_effect_triggers then
			uses_effect_triggers = true
			break
		end
	end

	local out_bindings = {}
	for i = 1, #compiled_entries do
		out_bindings[#out_bindings + 1] = compiled_entries[i].compiled
	end

	return {
		eval_mode = eval_mode,
		priority = prog_priority,
		bindings = out_bindings,
		uses_effect_triggers = uses_effect_triggers,
	}
end

local function validate_effect(effect, ctx)
	if not effect then
		return
	end
	if is_effect_trigger(effect) then
		local descriptor = effect["effect.trigger"]
		local effect_id = nil
		local payload = nil
		if type(descriptor) == "string" then
			effect_id = descriptor
		else
			effect_id = descriptor.id
			payload = descriptor.payload
		end
		action_effects.validate(effect_id, payload)
		return
	end
	if is_nested_commands(effect) then
		local commands = effect.commands
		for i = 1, #commands do
			local slot = ctx.slot .. ".commands[" .. i .. "]"
			validate_effect(commands[i], { program_id = ctx.program_id, binding_name = ctx.binding_name, slot = slot })
		end
	end
end

local function validate_effect_spec(spec, ctx)
	if not spec then
		return
	end
	if type(spec) == "table" and spec[1] ~= nil then
		for i = 1, #spec do
			local slot = ctx.slot .. "[" .. i .. "]"
			validate_effect(spec[i], { program_id = ctx.program_id, binding_name = ctx.binding_name, slot = slot })
		end
		return
	end
	validate_effect(spec, ctx)
end

function validate_program_effects(program, program_id)
	local bindings = program.bindings or {}
	for i = 1, #bindings do
		local binding = bindings[i]
		local binding_name = binding.name or ("#" .. i)
		local table_go = binding.go
		if not table_go then
			error("[inputactioneffectprogramvalidation] program '" .. program_id .. "' binding '" .. binding_name .. "' missing effect table.")
		end
		validate_effect_spec(table_go.press, { program_id = program_id, binding_name = binding_name, slot = "press" })
		validate_effect_spec(table_go.hold, { program_id = program_id, binding_name = binding_name, slot = "hold" })
		validate_effect_spec(table_go.release, { program_id = program_id, binding_name = binding_name, slot = "release" })
		for key, spec in pairs(table_go) do
			if key ~= "press" and key ~= "hold" and key ~= "release" then
				validate_effect_spec(spec, { program_id = program_id, binding_name = binding_name, slot = "custom:" .. key })
			end
		end
	end
end

return {
	compile_program = compile_program,
	compile_effect_list = compile_effect_list,
	validate_program_effects = validate_program_effects,
}
