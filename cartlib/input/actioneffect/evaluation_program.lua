local input<const> = require('cartlib/input/input')

local evaluation_program<const> = {}
local evaluation_environment<const> = {
	input_is_active = input.is_active,
}

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

local append_binding_body<const> = function(parts, program, binding, binding_index)
	local has_release<const> = binding.release ~= nil
	if has_release then
		parts[#parts + 1] = 'armed = latch['
		parts[#parts + 1] = binding_index
		parts[#parts + 1] = ']\n'
	end
	if binding.press ~= nil then
		parts[#parts + 1] = 'press = input_is_active(binding["press"])\nif press then\n'
		if program.stop_after_match then
			parts[#parts + 1] = 'matched = true\n'
		end
		if binding.press_effect ~= nil then
			parts[#parts + 1] = 'binding["press_effect"](component)\n'
		end
		if has_release then
			parts[#parts + 1] = 'latch['
			parts[#parts + 1] = binding_index
			parts[#parts + 1] = '] = true\n'
		end
		parts[#parts + 1] = 'end\n'
	end
	if binding.hold ~= nil then
		parts[#parts + 1] = 'hold = input_is_active(binding["hold"])\nif hold then\n'
		if program.stop_after_match then
			parts[#parts + 1] = 'matched = true\n'
		end
		if binding.hold_effect ~= nil then
			parts[#parts + 1] = 'binding["hold_effect"](component)\n'
		end
		if has_release then
			parts[#parts + 1] = 'latch['
			parts[#parts + 1] = binding_index
			parts[#parts + 1] = '] = true\n'
		end
		parts[#parts + 1] = 'end\n'
	end
	if has_release then
		parts[#parts + 1] = 'release = input_is_active(binding["release"])\nif release and armed then\n'
		if program.stop_after_match then
			parts[#parts + 1] = 'matched = true\n'
		end
		if binding.release_effect ~= nil then
			parts[#parts + 1] = 'binding["release_effect"](component)\n'
		end
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
		if program.stop_after_match then
			parts[#parts + 1] = 'matched = true\n'
		end
		local entry<const> = custom[custom_index]
		if entry.effect ~= nil then
			parts[#parts + 1] = 'binding["custom"]['
			parts[#parts + 1] = custom_index
			parts[#parts + 1] = ']["effect"](component)\n'
		end
		parts[#parts + 1] = 'end\n'
	end
end

local append_binding<const> = function(parts, program, binding, binding_index)
	parts[#parts + 1] = 'binding = bindings['
	parts[#parts + 1] = binding_index
	parts[#parts + 1] = ']\n'
	local modes<const> = binding.modes
	if modes ~= nil then
		parts[#parts + 1] = 'if '
		append_mode_condition(parts, modes)
		parts[#parts + 1] = ' then\n'
	end
	append_binding_body(parts, program, binding, binding_index)
	if modes ~= nil then
		if binding.release ~= nil then
			parts[#parts + 1] = 'else\nlatch['
			parts[#parts + 1] = binding_index
			parts[#parts + 1] = '] = false\n'
		end
		parts[#parts + 1] = 'end\n'
	end
end

function evaluation_program.compile(program)
	local bindings<const> = program.bindings
	local parts<const> = {
		'return function(component, frame)\n',
		'local program = component["program"]\n',
		'local bindings = program["bindings"]\n',
		'local owner = component["parent"]\n',
		'local binding\n',
	}
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
	if program.queued_event_capacity > 0 then
		parts[#parts + 1] = 'local event_types = component["queued_event_types"]\n'
		parts[#parts + 1] = 'local event_payloads = component["queued_event_payloads"]\n'
	end
	if program.queued_command_capacity > 0 then
		parts[#parts + 1] = 'local commands = component["queued_commands"]\n'
	end
	for binding_index = 1, #bindings do
		local binding<const> = bindings[binding_index]
		if program.stop_after_match and binding_index > 1 then
			parts[#parts + 1] = 'if matched then return end\n'
			append_binding(parts, program, binding, binding_index)
		else
			append_binding(parts, program, binding, binding_index)
		end
	end
	if program.queued_command_capacity > 0 then
		parts[#parts + 1] = 'for index = 1, component["queued_command_count"] do\n'
		parts[#parts + 1] = 'local command = commands[index]\n'
		parts[#parts + 1] = 'owner["state_machines"]["dispatch"](owner["state_machines"], command["event"], command["payload"])\n'
		parts[#parts + 1] = 'commands[index] = false\nend\ncomponent["queued_command_count"] = 0\n'
	end
	if program.queued_event_capacity > 0 then
		parts[#parts + 1] = 'for index = 1, component["queued_event_count"] do\n'
		parts[#parts + 1] = 'owner["events"]["emit"](owner["events"], event_types[index], event_payloads[index])\n'
		parts[#parts + 1] = 'event_types[index] = false\nevent_payloads[index] = false\nend\n'
		parts[#parts + 1] = 'component["queued_event_count"] = 0\n'
	end
	parts[#parts + 1] = 'end'
	return load(
		table.concat(parts),
		'[input.actioneffect]',
		't',
		evaluation_environment
	)()
end

return evaluation_program
