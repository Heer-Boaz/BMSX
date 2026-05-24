-- input_action_effect_compiler.lua
-- compile input action effect programs into executable bindings

local action_effects<const> = require('bios/action_effects')
local eventemitter<const> = require('bios/eventemitter')

local compile_effect_list

local execute_effect_trigger<const> = function(env, id, payload)
	local effects<const> = env.effects
	if not effects then
		error('[inputactioneffectcompiler] effect trigger "' .. id .. '" attempted without actioneffectcomponent on "' .. env.owner_id .. '".')
	end
	if payload == nil then
		return effects:trigger(id)
	end
	return effects:trigger(id, { payload = payload })
end

local compile_effect<const> = function(effect, slot, analysis)
	if effect['effect.trigger'] ~= nil then
		if analysis then
			analysis.uses_effect_triggers = true
		end
		local spec<const> = effect['effect.trigger']
		if type(spec) == 'string' then
			return function(env)
				execute_effect_trigger(env, spec)
			end
		end
		return function(env)
			execute_effect_trigger(env, spec.id, spec.payload)
		end
	end
	if effect['input.consume'] ~= nil then
		local actions = effect['input.consume']
		if type(actions) ~= 'table' then
			actions = { actions }
		end
		return function(env)
			for i = 1, #actions do
				mem[sys_inp_player] = env.player_index
				mem[sys_inp_consume] = &(actions[i])
			end
		end
	end
	if effect['emit.gameplay'] ~= nil then
		local spec<const> = effect['emit.gameplay']
		return function(env)
			env.queued_events[#env.queued_events + 1] = eventemitter.eventemitter.instance:create_gameevent({
				emitter = env.owner,
				type = spec.event,
				payload = spec.payload,
			})
		end
	end
	if effect['dispatch.command'] ~= nil then
		local spec<const> = effect['dispatch.command']
		if type(spec) ~= 'table' then
			error('[inputactioneffectcompiler] dispatch.command must be a table.')
		end
		if type(spec.event) ~= 'string' then
			error('[inputactioneffectcompiler] dispatch.command is missing event.')
		end
		return function(env)
			env.queued_commands[#env.queued_commands + 1] = {
				event = spec.event,
				payload = spec.payload,
			}
		end
	end
	if effect.commands ~= nil then
		local nested<const> = compile_effect_list(effect.commands, slot, analysis)
		return nested
	end
	error('[inputactioneffectcompiler] unknown effect in slot "' .. (slot or "unknown") .. '".')
end

local compile_effect_list<const> = function(spec, slot, analysis)
	if not spec then
		return nil
	end
	local entries
	if type(spec) == 'table' and spec[1] ~= nil then
		entries = spec
	else
		entries = { spec }
	end
	local executors<const> = {}
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

local compile_predicate<const> = function(binding)
	local when<const> = binding.when
	if not when then
		return function()
			return true
		end
	end
	local mode_pred<const> = when.mode
	local mode_items
	if mode_pred then
		if type(mode_pred) == 'table' and mode_pred[1] ~= nil then
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
	local binding_name<const> = binding.name or '(unnamed)'
	for i = 1, #mode_items do
		local entry<const> = mode_items[i]
		if entry.path == nil and entry.tag == nil then
			error('[inputactioneffectcompiler] "mode" clause in binding "' .. binding_name .. '" is missing both "path" and "tag".')
		end
	end
	return function(env)
		for i = 1, #mode_items do
			local entry<const> = mode_items[i]
			local matches = true
			if entry.path ~= nil then
				matches = matches and env.owner:matches_state_path(entry.path)
			end
			if entry.tag ~= nil then
				matches = matches and env.owner:has_tag(entry.tag)
			end
			if entry['not'] then
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

local compile_custom_effects<const> = function(binding, analysis)
	local map<const> = {}
	local table_go<const> = binding.go or {}
	for key, spec in pairs(table_go) do
		if key ~= 'press' and key ~= 'hold' and key ~= 'release' then
			map[key] = compile_effect_list(spec, key, analysis)
		end
	end
	return map
end

local compile_binding<const> = function(binding, parse)
	local priority<const> = binding.priority or 0
	local analysis<const> = { uses_effect_triggers = false }
	local predicate<const> = compile_predicate(binding)
	local on<const> = binding.on
	if not on then
		error('[inputactioneffectcompiler] binding "' .. (binding.name or '(unnamed)') .. '" is missing an "on" clause.')
	end
	local press<const> = on.press and parse(on.press)
	local hold<const> = on.hold and parse(on.hold)
	local release<const> = on.release and parse(on.release)
	local custom_entries<const> = on.custom or {}
	local custom_effects<const> = compile_custom_effects(binding, analysis)
	local custom_edges<const> = {}
	for i = 1, #custom_entries do
		local entry<const> = custom_entries[i]
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
		press_effect = compile_effect_list(binding.go and binding.go.press, 'press', analysis),
		hold_effect = compile_effect_list(binding.go and binding.go.hold, 'hold', analysis),
		release_effect = compile_effect_list(binding.go and binding.go.release, 'release', analysis),
		custom_edges = custom_edges,
		uses_effect_triggers = analysis.uses_effect_triggers,
	}
end

function compile_program(program, parse)
	local prog_priority<const> = program.priority or 0
	local eval_mode<const> = program.eval or 'first'
	local bindings<const> = program.bindings or {}

	local compiled_entries<const> = {}
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

	local uses_effect_triggers
	for i = 1, #compiled_entries do
		if compiled_entries[i].compiled.uses_effect_triggers then
			uses_effect_triggers = true
			break
		end
	end

	local out_bindings<const> = {}
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

local validate_effect<const> = function(effect, ctx)
	if not effect then
		return
	end
	if effect['effect.trigger'] ~= nil then
		local descriptor<const> = effect['effect.trigger']
		local effect_id
		local payload
		if type(descriptor) == 'string' then
			effect_id = descriptor
		else
			effect_id = descriptor.id
			payload = descriptor.payload
		end
		action_effects.validate(effect_id, payload)
		return
	end
	if effect['emit.gameplay'] ~= nil then
		local spec<const> = effect['emit.gameplay']
		if type(spec) ~= 'table' then
			error('[inputactioneffectcompiler] program "' .. ctx.program_id .. '" binding "' .. ctx.binding_name .. '" slot "' .. ctx.slot .. '" emit.gameplay must be a table.')
		end
		if type(spec.event) ~= 'string' then
			error('[inputactioneffectcompiler] program "' .. ctx.program_id .. '" binding "' .. ctx.binding_name .. '" slot "' .. ctx.slot .. '" emit.gameplay missing event.')
		end
		local payload<const> = spec.payload
		if payload ~= nil and type(payload) == 'table' then
			if payload.type ~= nil then
				error('[inputactioneffectcompiler] program "' .. ctx.program_id .. '" binding "' .. ctx.binding_name .. '" slot "' .. ctx.slot .. '" emit.gameplay payload must not contain reserved key "type".')
			end
			if payload.emitter ~= nil then
				error('[inputactioneffectcompiler] program "' .. ctx.program_id .. '" binding "' .. ctx.binding_name .. '" slot "' .. ctx.slot .. '" emit.gameplay payload must not contain reserved key "emitter".')
			end
		end
		return
	end
	if effect['dispatch.command'] ~= nil then
		local spec<const> = effect['dispatch.command']
		if type(spec) ~= 'table' then
			error('[inputactioneffectcompiler] program "' .. ctx.program_id .. '" binding "' .. ctx.binding_name .. '" slot "' .. ctx.slot .. '" dispatch.command must be a table.')
		end
		if type(spec.event) ~= 'string' then
			error('[inputactioneffectcompiler] program "' .. ctx.program_id .. '" binding "' .. ctx.binding_name .. '" slot "' .. ctx.slot .. '" dispatch.command missing event.')
		end
		return
	end
	if effect.commands ~= nil then
		local commands<const> = effect.commands
		for i = 1, #commands do
			local slot<const> = ctx.slot .. '.commands[' .. i .. ']'
			validate_effect(commands[i], { program_id = ctx.program_id, binding_name = ctx.binding_name, slot = slot })
		end
		return
	end
end

local validate_effect_spec<const> = function(spec, ctx)
	if not spec then
		return
	end
	if type(spec) == 'table' and spec[1] ~= nil then
		for i = 1, #spec do
			local slot<const> = ctx.slot .. '[' .. i .. ']'
			validate_effect(spec[i], { program_id = ctx.program_id, binding_name = ctx.binding_name, slot = slot })
		end
		return
	end
	validate_effect(spec, ctx)
end

function validate_program_effects(program, program_id)
	local bindings<const> = program.bindings or {}
	for i = 1, #bindings do
		local binding<const> = bindings[i]
		local binding_name<const> = binding.name or ('#' .. i)
		local table_go<const> = binding.go
		if not table_go then
			error('[inputactioneffectprogramvalidation] program "' .. program_id .. '" binding "' .. binding_name .. '" missing effect table.')
		end
		validate_effect_spec(table_go.press, { program_id = program_id, binding_name = binding_name, slot = 'press' })
		validate_effect_spec(table_go.hold, { program_id = program_id, binding_name = binding_name, slot = 'hold' })
		validate_effect_spec(table_go.release, { program_id = program_id, binding_name = binding_name, slot = 'release' })
		for key, spec in pairs(table_go) do
			if key ~= 'press' and key ~= 'hold' and key ~= 'release' then
				validate_effect_spec(spec, { program_id = program_id, binding_name = binding_name, slot = 'custom:' .. key })
			end
		end
	end
end

return {
	compile_program = compile_program,
	compile_effect_list = compile_effect_list,
	validate_program_effects = validate_program_effects,
}
