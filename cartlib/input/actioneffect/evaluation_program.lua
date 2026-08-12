local input<const> = require('cartlib/input/input')
local actioneffectcomponent<const> = require('cartlib/actioneffects/actioneffectcomponent')

local evaluation_program<const> = {}

local add_effect_operand<const> = function(parts, value)
	if value == nil then
		parts[#parts + 1] = 'nil'
		return
	end
	local operands<const> = parts.effect_operands
	local index<const> = #operands + 1
	operands[index] = value
	parts[#parts + 1] = 'operands['
	parts[#parts + 1] = index
	parts[#parts + 1] = ']'
end

local append_effect<const> = function(parts, effect, slot)
	local trigger<const> = effect['effect.trigger']
	if trigger ~= nil then
		local id = trigger
		local payload
		if type(trigger) == 'table' then
			id = trigger.id
			payload = trigger.payload
		end
		parts.uses_effect_triggers = true
		parts.environment.try_trigger = actioneffectcomponent.try_trigger
		parts[#parts + 1] = 'try_trigger(owner["actioneffects"], '
		add_effect_operand(parts, id)
		parts[#parts + 1] = ', '
		add_effect_operand(parts, payload)
		parts[#parts + 1] = ')\n'
		return
	end
	local consume<const> = effect['input.consume']
	if consume ~= nil then
		parts.environment.input_consume = input.consume
		parts[#parts + 1] = 'input_consume('
		parts[#parts + 1] = parts.player_index
		parts[#parts + 1] = ', '
		add_effect_operand(parts, consume)
		parts[#parts + 1] = ')\n'
		return
	end
	local gameplay<const> = effect['emit.gameplay']
	if gameplay ~= nil then
		parts.queued_event_capacity = parts.queued_event_capacity + 1
		parts[#parts + 1] = 'queued_event_count = queued_event_count + 1\n'
		parts[#parts + 1] = 'event_types[queued_event_count] = '
		add_effect_operand(parts, gameplay.event)
		parts[#parts + 1] = '\nevent_payloads[queued_event_count] = '
		add_effect_operand(parts, gameplay.payload)
		parts[#parts + 1] = '\n'
		return
	end
	local command<const> = effect['dispatch.command']
	if command ~= nil then
		parts.queued_command_capacity = parts.queued_command_capacity + 1
		parts[#parts + 1] = 'queued_command_count = queued_command_count + 1\n'
		parts[#parts + 1] = 'commands[queued_command_count] = '
		add_effect_operand(parts, command)
		parts[#parts + 1] = '\n'
		return
	end
	error('unknown input effect in slot "' .. slot .. '".')
end

local append_effects<const> = function(parts, effects, first, last, slot)
	if last == nil then
		return
	end
	for index = first, last do
		append_effect(parts, effects[index], slot)
	end
end

local append_mode_operand<const> = function(parts, mode, mode_index)
	local reference<const> = 'binding["modes"][' .. mode_index .. ']'
	if mode.negated then
		parts[#parts + 1] = 'not ('
	end
	if mode.path ~= nil then
		parts[#parts + 1] = 'owner["state_machines"]["matches_state"](owner["state_machines"], '
		parts[#parts + 1] = reference
		parts[#parts + 1] = '["path"])'
		if mode.tag ~= nil then
			parts[#parts + 1] = ' and '
		end
	end
	if mode.tag ~= nil then
		parts[#parts + 1] = 'owner["has_tag"](owner, '
		parts[#parts + 1] = reference
		parts[#parts + 1] = '["tag"])'
	end
	if mode.negated then
		parts[#parts + 1] = ')'
	end
end

local append_mode_condition<const> = function(parts, modes)
	for mode_index = 1, #modes do
		if mode_index > 1 then
			parts[#parts + 1] = ' and '
		end
		append_mode_operand(parts, modes[mode_index], mode_index)
	end
end

local append_binding_body<const> = function(parts, effects, binding, binding_index, record_match)
	local has_release<const> = binding.release ~= nil
	if has_release then
		parts[#parts + 1] = 'armed = latch['
		parts[#parts + 1] = binding_index
		parts[#parts + 1] = ']\n'
	end
	if binding.press ~= nil then
		parts[#parts + 1] = 'press = input_is_active(binding["press"])\nif press then\n'
		if record_match then
			parts[#parts + 1] = 'matched = true\n'
		end
		append_effects(parts, effects, binding.press_effect_start, binding.press_effect_end, 'press')
		if has_release then
			parts[#parts + 1] = 'latch['
			parts[#parts + 1] = binding_index
			parts[#parts + 1] = '] = true\n'
		end
		parts[#parts + 1] = 'end\n'
	end
	if binding.hold ~= nil then
		parts[#parts + 1] = 'hold = input_is_active(binding["hold"])\nif hold then\n'
		if record_match then
			parts[#parts + 1] = 'matched = true\n'
		end
		append_effects(parts, effects, binding.hold_effect_start, binding.hold_effect_end, 'hold')
		if has_release then
			parts[#parts + 1] = 'latch['
			parts[#parts + 1] = binding_index
			parts[#parts + 1] = '] = true\n'
		end
		parts[#parts + 1] = 'end\n'
	end
	if has_release then
		parts[#parts + 1] = 'release = input_is_active(binding["release"])\nif release and armed then\n'
		if record_match then
			parts[#parts + 1] = 'matched = true\n'
		end
		append_effects(parts, effects, binding.release_effect_start, binding.release_effect_end, 'release')
		parts[#parts + 1] = 'latch['
		parts[#parts + 1] = binding_index
		parts[#parts + 1] = '] = false\nend\n'
	end
	local custom<const> = binding.custom
	for custom_index = 1, #custom do
		parts[#parts + 1] = 'custom_matches['
		parts[#parts + 1] = custom_index
		parts[#parts + 1] = '] = input_is_active(binding["custom"]['
		parts[#parts + 1] = custom_index
		parts[#parts + 1] = ']["input"])\n'
	end
	for custom_index = 1, #custom do
		parts[#parts + 1] = 'if custom_matches['
		parts[#parts + 1] = custom_index
		parts[#parts + 1] = '] then\n'
		if record_match then
			parts[#parts + 1] = 'matched = true\n'
		end
		local entry<const> = custom[custom_index]
		append_effects(parts, effects, entry.effect_start, entry.effect_end, entry.slot)
		parts[#parts + 1] = 'end\n'
	end
end

local append_binding<const> = function(parts, effects, binding, binding_index, record_match)
	parts[#parts + 1] = 'binding = bindings['
	parts[#parts + 1] = binding_index
	parts[#parts + 1] = ']\n'
	local modes<const> = binding.modes
	if modes ~= nil then
		parts[#parts + 1] = 'if '
		append_mode_condition(parts, modes)
		parts[#parts + 1] = ' then\n'
	end
	append_binding_body(parts, effects, binding, binding_index, record_match)
	if modes ~= nil then
		if binding.release ~= nil then
			parts[#parts + 1] = 'else\nlatch['
			parts[#parts + 1] = binding_index
			parts[#parts + 1] = '] = false\n'
		end
		parts[#parts + 1] = 'end\n'
	end
end

function evaluation_program.compile(program, effects, player_index)
	local bindings<const> = program.bindings
	local environment<const> = {
		input_is_active = input.is_active,
	}
	local parts<const> = {
		'return function(component, frame)\n',
		'local program = component["program"]\n',
		'local bindings = program["bindings"]\n',
		'local owner = component["parent"]\n',
		'local binding\n',
	}
	parts.effect_operands = {}
	parts.environment = environment
	parts.player_index = player_index
	parts.queued_event_capacity = 0
	parts.queued_command_capacity = 0
	if program.release_binding_count > 0 then
		parts[#parts + 1] = 'local latch = component["binding_latch"]\nlocal armed\n'
		parts[#parts + 1] = 'if component["last_frame"] ~= frame - 1 then\n'
		for binding_index = 1, #bindings do
			if bindings[binding_index].release ~= nil then
				parts[#parts + 1] = 'latch['
				parts[#parts + 1] = binding_index
				parts[#parts + 1] = '] = false\n'
			end
		end
		parts[#parts + 1] = 'end\ncomponent["last_frame"] = frame\n'
	end
	if program.has_press then
		parts[#parts + 1] = 'local press\n'
	end
	if program.has_hold then
		parts[#parts + 1] = 'local hold\n'
	end
	if program.release_binding_count > 0 then
		parts[#parts + 1] = 'local release\n'
	end
	if program.max_custom_count > 0 then
		parts[#parts + 1] = 'local custom_matches = component["custom_matches"]\n'
	end
	if program.stop_after_match and #bindings > 1 then
		parts[#parts + 1] = 'local matched\nwhile true do\n'
	end
	for binding_index = 1, #bindings do
		local binding<const> = bindings[binding_index]
		local record_match<const> = program.stop_after_match and binding_index < #bindings
		append_binding(parts, effects, binding, binding_index, record_match)
		if record_match then
			parts[#parts + 1] = 'if matched then\n'
			for later_index = binding_index + 1, #bindings do
				if bindings[later_index].release ~= nil then
					parts[#parts + 1] = 'latch['
					parts[#parts + 1] = later_index
					parts[#parts + 1] = '] = false\n'
				end
			end
			parts[#parts + 1] = 'break\nend\n'
		end
	end
	if program.stop_after_match and #bindings > 1 then
		parts[#parts + 1] = 'break\nend\n'
	end
	local queued_command_capacity<const> = parts.queued_command_capacity
	local queued_event_capacity<const> = parts.queued_event_capacity
	if #parts.effect_operands > 0 then
		table.insert(parts, 6, 'local operands = effect_operands\n')
	end
	if queued_command_capacity > 0 then
		table.insert(parts, 6, 'local commands = component["queued_commands"]\nlocal queued_command_count = 0\n')
		parts[#parts + 1] = 'component["queued_command_count"] = queued_command_count\n'
		parts[#parts + 1] = 'for index = 1, queued_command_count do\n'
		parts[#parts + 1] = 'local command = commands[index]\n'
		parts[#parts + 1] = 'owner["state_machines"]["dispatch"](owner["state_machines"], command["event"], command["payload"])\n'
		parts[#parts + 1] = 'commands[index] = false\nend\ncomponent["queued_command_count"] = 0\n'
	end
	if queued_event_capacity > 0 then
		table.insert(parts, 6, 'local event_types = component["queued_event_types"]\nlocal event_payloads = component["queued_event_payloads"]\nlocal queued_event_count = 0\n')
		parts[#parts + 1] = 'component["queued_event_count"] = queued_event_count\n'
		parts[#parts + 1] = 'for index = 1, queued_event_count do\n'
		parts[#parts + 1] = 'owner["events"]["emit"](owner["events"], event_types[index], event_payloads[index])\n'
		parts[#parts + 1] = 'event_types[index] = false\nevent_payloads[index] = false\nend\n'
		parts[#parts + 1] = 'component["queued_event_count"] = 0\n'
	end
	parts[#parts + 1] = 'end'
	if #parts.effect_operands > 0 then
		environment.effect_operands = parts.effect_operands
	end
	return load(
		table.concat(parts),
		'[input.actioneffect]',
		't',
		environment
	)(), parts.uses_effect_triggers, queued_event_capacity, queued_command_capacity
end

return evaluation_program
