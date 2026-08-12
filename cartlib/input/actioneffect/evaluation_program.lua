local input<const> = require('cartlib/input/input')
local actioneffect_component<const> = require('cartlib/actioneffects/actioneffect_component')
local lua_source_printer<const> = require('cartlib/codegen/lua_source_printer')

local evaluation_program<const> = {}
local templates<const> = {}

local effect_kind_trigger<const> = 1
local effect_kind_consume<const> = 2
local effect_kind_gameplay<const> = 3
local effect_kind_command<const> = 4

local add_operand<const> = function(program, value)
	if value == nil then
		return 0
	end
	local operands<const> = program.operands
	local index<const> = #operands + 1
	operands[index] = value
	return index
end

local compile_effect<const> = function(program, effect, slot)
	local trigger<const> = effect['effect.trigger']
	if trigger ~= nil then
		local id = trigger
		local payload
		if type(trigger) == 'table' then
			id = trigger.id
			payload = trigger.payload
		end
		program.uses_effect_triggers = true
		program.environment.try_trigger = actioneffect_component.try_trigger
		return {
			kind = effect_kind_trigger,
			id_operand_index = add_operand(program, id),
			payload_operand_index = add_operand(program, payload),
		}
	end
	local consume<const> = effect['input.consume']
	if consume ~= nil then
		program.environment.input_consume = input.consume
		return {
			kind = effect_kind_consume,
			operand_index = add_operand(program, consume),
		}
	end
	local gameplay<const> = effect['emit.gameplay']
	if gameplay ~= nil then
		program.queued_event_capacity = program.queued_event_capacity + 1
		return {
			kind = effect_kind_gameplay,
			event_operand_index = add_operand(program, gameplay.event),
			payload_operand_index = add_operand(program, gameplay.payload),
		}
	end
	local command<const> = effect['dispatch.command']
	if command ~= nil then
		program.queued_command_capacity = program.queued_command_capacity + 1
		return {
			kind = effect_kind_command,
			operand_index = add_operand(program, command),
		}
	end
	error('unknown input effect in slot "' .. slot .. '".')
end

local compile_effect_range<const> = function(program, source, first, last, slot)
	if last == nil then
		return
	end
	local effects<const> = program.effects
	for index = first, last do
		effects[index] = compile_effect(program, source[index], slot)
	end
end

local compile_effects<const> = function(bindings, source)
	local program<const> = {
		effects = {},
		operands = {},
		environment = { input_is_active = input.is_active },
		uses_effect_triggers = false,
		queued_event_capacity = 0,
		queued_command_capacity = 0,
	}
	for binding_index = 1, #bindings do
		local binding<const> = bindings[binding_index]
		compile_effect_range(program, source, binding.press_effect_start, binding.press_effect_end, 'press')
		compile_effect_range(program, source, binding.hold_effect_start, binding.hold_effect_end, 'hold')
		compile_effect_range(program, source, binding.release_effect_start, binding.release_effect_end, 'release')
		local custom<const> = binding.custom
		for custom_index = 1, #custom do
			local entry<const> = custom[custom_index]
			compile_effect_range(program, source, entry.effect_start, entry.effect_end, entry.slot)
		end
	end
	return program
end

local emit_operand<const> = function(printer, values)
	if values.operand_index == 0 then
		printer:emit(templates.nil_operand, values)
		return
	end
	printer:emit(templates.operand, values)
end

local emit_trigger_id<const> = function(printer, values)
	values.operand_index = values.effect.id_operand_index
	emit_operand(printer, values)
end

local emit_trigger_payload<const> = function(printer, values)
	values.operand_index = values.effect.payload_operand_index
	emit_operand(printer, values)
end

local emit_effect_operand<const> = function(printer, values)
	values.operand_index = values.effect.operand_index
	emit_operand(printer, values)
end

local emit_effect<const> = function(printer, values)
	local kind<const> = values.effect.kind
	if kind == effect_kind_trigger then
		printer:emit(templates.trigger_effect, values)
	elseif kind == effect_kind_consume then
		printer:emit(templates.consume_effect, values)
	elseif kind == effect_kind_gameplay then
		printer:emit(templates.gameplay_effect, values)
	else
		printer:emit(templates.command_effect, values)
	end
end

local emit_event_type<const> = function(printer, values)
	values.operand_index = values.effect.event_operand_index
	emit_operand(printer, values)
end

local emit_event_payload<const> = function(printer, values)
	values.operand_index = values.effect.payload_operand_index
	emit_operand(printer, values)
end

local emit_effects<const> = function(printer, values, first, last)
	if last == nil then
		return
	end
	local effects<const> = values.effect_program.effects
	for index = first, last do
		values.effect = effects[index]
		emit_effect(printer, values)
	end
end

local emit_press_effects<const> = function(printer, values)
	local binding<const> = values.binding
	emit_effects(printer, values, binding.press_effect_start, binding.press_effect_end)
end

local emit_hold_effects<const> = function(printer, values)
	local binding<const> = values.binding
	emit_effects(printer, values, binding.hold_effect_start, binding.hold_effect_end)
end

local emit_release_effects<const> = function(printer, values)
	local binding<const> = values.binding
	emit_effects(printer, values, binding.release_effect_start, binding.release_effect_end)
end

local emit_custom_effects<const> = function(printer, values)
	local entry<const> = values.custom_entry
	emit_effects(printer, values, entry.effect_start, entry.effect_end)
end

local emit_matched<const> = function(printer, values)
	if values.record_match then
		printer:emit(templates.matched, values)
	end
end

local emit_arm_latch<const> = function(printer, values)
	if values.has_release then
		printer:emit(templates.arm_latch, values)
	end
end

local emit_armed_local<const> = function(printer, values)
	if values.has_release then
		printer:emit(templates.armed_local, values)
	end
end

local emit_press<const> = function(printer, values)
	if values.binding.press ~= nil then
		printer:emit(templates.press, values)
	end
end

local emit_hold<const> = function(printer, values)
	if values.binding.hold ~= nil then
		printer:emit(templates.hold, values)
	end
end

local emit_release<const> = function(printer, values)
	if values.has_release then
		printer:emit(templates.release, values)
	end
end

local emit_custom_samples<const> = function(printer, values)
	local custom<const> = values.binding.custom
	for custom_index = 1, #custom do
		values.custom_index = custom_index
		printer:emit(templates.custom_sample, values)
	end
end

local emit_custom_matches<const> = function(printer, values)
	local custom<const> = values.binding.custom
	for custom_index = 1, #custom do
		values.custom_index = custom_index
		values.custom_entry = custom[custom_index]
		printer:emit(templates.custom_match, values)
	end
end

local emit_binding_body<const> = function(printer, values)
	printer:emit(templates.binding_body, values)
end

local emit_mode_operand<const> = function(printer, values)
	local mode<const> = values.mode
	local template
	if mode.path ~= nil and mode.tag ~= nil then
		template = templates.mode_path_and_tag
	elseif mode.path ~= nil then
		template = templates.mode_path
	else
		template = templates.mode_tag
	end
	if mode.negated then
		values.mode_template = template
		printer:emit(templates.negated_mode, values)
	else
		printer:emit(template, values)
	end
end

local emit_negated_mode_operand<const> = function(printer, values)
	printer:emit(values.mode_template, values)
end

local emit_mode_condition<const> = function(printer, values)
	local modes<const> = values.binding.modes
	for mode_index = 1, #modes do
		if mode_index > 1 then
			printer:emit(templates.mode_and, values)
		end
		values.mode_index = mode_index
		values.mode = modes[mode_index]
		emit_mode_operand(printer, values)
	end
end

local emit_binding<const> = function(printer, values)
	local binding<const> = values.binding
	values.has_release = binding.release ~= nil
	if binding.modes ~= nil then
		if values.has_release then
			printer:emit(templates.conditional_release_binding, values)
		else
			printer:emit(templates.conditional_binding, values)
		end
	else
		printer:emit(templates.binding, values)
	end
end

local emit_release_latches<const> = function(printer, values)
	local bindings<const> = values.bindings
	for binding_index = 1, #bindings do
		if bindings[binding_index].release ~= nil then
			values.binding_index = binding_index
			printer:emit(templates.clear_latch, values)
		end
	end
end

local emit_release_state<const> = function(printer, values)
	if values.program.release_binding_count > 0 then
		printer:emit(templates.release_state, values)
	end
end

local emit_input_locals<const> = function(printer, values)
	local program<const> = values.program
	if program.has_press then
		printer:emit(templates.press_local, values)
	end
	if program.has_hold then
		printer:emit(templates.hold_local, values)
	end
	if program.release_binding_count > 0 then
		printer:emit(templates.release_local, values)
	end
	if program.max_custom_count > 0 then
		printer:emit(templates.custom_local, values)
	end
end

local emit_operands_local<const> = function(printer, values)
	if #values.effect_program.operands > 0 then
		printer:emit(templates.operands_local, values)
	end
end

local emit_command_locals<const> = function(printer, values)
	if values.effect_program.queued_command_capacity > 0 then
		printer:emit(templates.command_locals, values)
	end
end

local emit_event_locals<const> = function(printer, values)
	if values.effect_program.queued_event_capacity > 0 then
		printer:emit(templates.event_locals, values)
	end
end

local emit_remaining_latch_clears<const> = function(printer, values)
	local bindings<const> = values.bindings
	for later_index = values.binding_index + 1, #bindings do
		if bindings[later_index].release ~= nil then
			values.later_index = later_index
			printer:emit(templates.clear_later_latch, values)
		end
	end
end

local emit_stop_after_match<const> = function(printer, values)
	if values.record_match then
		printer:emit(templates.stop_after_match, values)
	end
end

local emit_bindings<const> = function(printer, values)
	local bindings<const> = values.bindings
	for binding_index = 1, #bindings do
		values.binding_index = binding_index
		values.binding = bindings[binding_index]
		values.record_match = values.program.stop_after_match and binding_index < #bindings
		emit_binding(printer, values)
		emit_stop_after_match(printer, values)
	end
end

local emit_binding_evaluation<const> = function(printer, values)
	if values.program.stop_after_match and #values.bindings > 1 then
		printer:emit(templates.first_binding_loop, values)
	else
		emit_bindings(printer, values)
	end
end

local emit_command_flush<const> = function(printer, values)
	if values.effect_program.queued_command_capacity > 0 then
		printer:emit(templates.command_flush, values)
	end
end

local emit_event_flush<const> = function(printer, values)
	if values.effect_program.queued_event_capacity > 0 then
		printer:emit(templates.event_flush, values)
	end
end

templates.nil_operand = lua_source_printer.compile_template('nil')
templates.operand = lua_source_printer.compile_template('operands[$operand_index$]')

templates.trigger_effect = lua_source_printer.compile_template(
	'try_trigger(owner["actioneffects"], $id$, $payload$)\n',
	{ id = emit_trigger_id, payload = emit_trigger_payload }
)

templates.consume_effect = lua_source_printer.compile_template(
	'input_consume($player_index$, $actions$)\n',
	{ actions = emit_effect_operand }
)

templates.gameplay_effect = lua_source_printer.compile_template([[
	queued_event_count = queued_event_count + 1
	event_types[queued_event_count] = $event_type$
	event_payloads[queued_event_count] = $event_payload$
]], {
	event_type = emit_event_type,
	event_payload = emit_event_payload,
})

templates.command_effect = lua_source_printer.compile_template([[
	queued_command_count = queued_command_count + 1
	commands[queued_command_count] = $command$
]], { command = emit_effect_operand })

templates.matched = lua_source_printer.compile_template('matched = true\n')
templates.armed_local = lua_source_printer.compile_template('armed = latch[$binding_index$]\n')
templates.arm_latch = lua_source_printer.compile_template('latch[$binding_index$] = true\n')
templates.clear_latch = lua_source_printer.compile_template('latch[$binding_index$] = false\n')

templates.press = lua_source_printer.compile_template([[
	press = input_is_active(binding["press"])
	if press then
		$matched$
		$effects$
		$latch$
	end
]], {
	matched = emit_matched,
	effects = emit_press_effects,
	latch = emit_arm_latch,
})

templates.hold = lua_source_printer.compile_template([[
	hold = input_is_active(binding["hold"])
	if hold then
		$matched$
		$effects$
		$latch$
	end
]], {
	matched = emit_matched,
	effects = emit_hold_effects,
	latch = emit_arm_latch,
})

templates.release = lua_source_printer.compile_template([[
	release = input_is_active(binding["release"])
	if release and armed then
		$matched$
		$effects$
		latch[$binding_index$] = false
	end
]], {
	matched = emit_matched,
	effects = emit_release_effects,
})

templates.custom_sample = lua_source_printer.compile_template(
	'custom_matches[$custom_index$] = input_is_active(binding["custom"][$custom_index$]["input"])\n'
)

templates.custom_match = lua_source_printer.compile_template([[
	if custom_matches[$custom_index$] then
		$matched$
		$effects$
	end
]], {
	matched = emit_matched,
	effects = emit_custom_effects,
})

templates.binding_body = lua_source_printer.compile_template([[
	$armed$
	$press$
	$hold$
	$release$
	$custom_samples$
	$custom_matches$
]], {
	armed = emit_armed_local,
	press = emit_press,
	hold = emit_hold,
	release = emit_release,
	custom_samples = emit_custom_samples,
	custom_matches = emit_custom_matches,
})

templates.mode_path = lua_source_printer.compile_template(
	'owner["state_machines"]["matches_state"](owner["state_machines"], binding["modes"][$mode_index$]["path"])'
)

templates.mode_tag = lua_source_printer.compile_template(
	'owner["has_tag"](owner, binding["modes"][$mode_index$]["tag"])'
)

templates.mode_path_and_tag = lua_source_printer.compile_template(
	'owner["state_machines"]["matches_state"](owner["state_machines"], binding["modes"][$mode_index$]["path"]) and owner["has_tag"](owner, binding["modes"][$mode_index$]["tag"])'
)

templates.negated_mode = lua_source_printer.compile_template(
	'not ($mode$)',
	{ mode = emit_negated_mode_operand }
)

templates.mode_and = lua_source_printer.compile_template(' and ')

templates.binding = lua_source_printer.compile_template([[
	binding = bindings[$binding_index$]
	$body$
]], { body = emit_binding_body })

templates.conditional_binding = lua_source_printer.compile_template([[
	binding = bindings[$binding_index$]
	if $condition$ then
		$body$
	end
]], {
	condition = emit_mode_condition,
	body = emit_binding_body,
})

templates.conditional_release_binding = lua_source_printer.compile_template([[
	binding = bindings[$binding_index$]
	if $condition$ then
		$body$
	else
		latch[$binding_index$] = false
	end
]], {
	condition = emit_mode_condition,
	body = emit_binding_body,
})

templates.release_state = lua_source_printer.compile_template([[
	local latch = component["binding_latch"]
	local armed
	if component["last_frame"] ~= frame - 1 then
		$clear_latches$
	end
	component["last_frame"] = frame
]], { clear_latches = emit_release_latches })

templates.press_local = lua_source_printer.compile_template('local press\n')
templates.hold_local = lua_source_printer.compile_template('local hold\n')
templates.release_local = lua_source_printer.compile_template('local release\n')
templates.custom_local = lua_source_printer.compile_template('local custom_matches = component["custom_matches"]\n')
templates.operands_local = lua_source_printer.compile_template('local operands = effect_operands\n')

templates.command_locals = lua_source_printer.compile_template([[
	local commands = component["queued_commands"]
	local queued_command_count = 0
]])

templates.event_locals = lua_source_printer.compile_template([[
	local event_types = component["queued_event_types"]
	local event_payloads = component["queued_event_payloads"]
	local queued_event_count = 0
]])

templates.clear_later_latch = lua_source_printer.compile_template('latch[$later_index$] = false\n')

templates.stop_after_match = lua_source_printer.compile_template([[
	if matched then
		$clear_latches$
		break
	end
]], { clear_latches = emit_remaining_latch_clears })

templates.first_binding_loop = lua_source_printer.compile_template([[
	local matched
	while true do
		$bindings$
		break
	end
]], { bindings = emit_bindings })

templates.command_flush = lua_source_printer.compile_template([[
	component["queued_command_count"] = queued_command_count
	for index = 1, queued_command_count do
		local command = commands[index]
		owner["state_machines"]["dispatch"](owner["state_machines"], command["event"], command["payload"])
		commands[index] = false
	end
	component["queued_command_count"] = 0
]])

templates.event_flush = lua_source_printer.compile_template([[
	component["queued_event_count"] = queued_event_count
	for index = 1, queued_event_count do
		owner["events"]["emit"](owner["events"], event_types[index], event_payloads[index])
		event_types[index] = false
		event_payloads[index] = false
	end
	component["queued_event_count"] = 0
]])

templates.program = lua_source_printer.compile_template([[
	return function(component, frame)
		local program = component["program"]
		local bindings = program["bindings"]
		local owner = component["parent"]
		local binding
		$operands_local$
		$command_locals$
		$event_locals$
		$release_state$
		$input_locals$
		$bindings$
		$command_flush$
		$event_flush$
	end
]], {
	operands_local = emit_operands_local,
	command_locals = emit_command_locals,
	event_locals = emit_event_locals,
	release_state = emit_release_state,
	input_locals = emit_input_locals,
	bindings = emit_binding_evaluation,
	command_flush = emit_command_flush,
	event_flush = emit_event_flush,
})

function evaluation_program.compile(program, effects, player_index)
	local effect_program<const> = compile_effects(program.bindings, effects)
	local values<const> = {
		program = program,
		bindings = program.bindings,
		effect_program = effect_program,
		player_index = player_index,
	}
	local printer<const> = lua_source_printer.new()
	printer:emit(templates.program, values)
	local environment<const> = effect_program.environment
	if #effect_program.operands > 0 then
		environment.effect_operands = effect_program.operands
	end
	return load(
		printer:finish(),
		'[input.actioneffect]',
		't',
		environment
	)(), effect_program.uses_effect_triggers,
		effect_program.queued_event_capacity,
		effect_program.queued_command_capacity
end

return evaluation_program
