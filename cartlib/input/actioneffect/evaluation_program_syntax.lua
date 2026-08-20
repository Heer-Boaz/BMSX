-- Admission-only lowering from resolved action effects to canonical firmware
-- syntax. Effect dispatch does not inspect authored effect records.
local syntax_factory<const> = lua_compiler.syntax_factory

local evaluation_program_syntax<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local generated_symbol<const> = syntax_factory.generated_symbol
local reference<const> = syntax_factory.reference
local numeric_literal<const> = syntax_factory.number_literal
local boolean_literal<const> = syntax_factory.boolean_literal
local member_expression<const> = syntax_factory.member_expression
local index_expression<const> = syntax_factory.index_expression
local call_expression<const> = syntax_factory.call_expression
local binary_expression<const> = syntax_factory.binary_expression
local unary_expression<const> = syntax_factory.unary_expression
local function_expression<const> = syntax_factory.function_expression
local assignment_statement<const> = syntax_factory.assignment_statement
local local_statement<const> = syntax_factory.local_statement
local call_statement<const> = syntax_factory.call_statement
local if_clause<const> = syntax_factory.if_clause
local else_clause<const> = syntax_factory.else_clause
local if_statement<const> = syntax_factory.if_statement
local while_statement<const> = syntax_factory.while_statement
local numeric_for_statement<const> = syntax_factory.numeric_for_statement
local return_statement<const> = syntax_factory.return_statement
local break_statement<const> = syntax_factory.break_statement

local symbols<const> = {
	component = generated_symbol('component'),
	frame = generated_symbol('frame'),
	owner = generated_symbol('owner'),
	bindings = generated_symbol('bindings'),
	binding = generated_symbol('binding'),
	operands = generated_symbol('operands'),
	trigger = generated_symbol('trigger'),
	input_consume = generated_symbol('input_consume'),
	press = generated_symbol('press'),
	hold = generated_symbol('hold'),
	release = generated_symbol('release'),
	combo = generated_symbol('combo'),
	latch = generated_symbol('latch'),
	armed = generated_symbol('armed'),
	matched = generated_symbol('matched'),
	custom_matches = generated_symbol('custom_matches'),
	commands = generated_symbol('commands'),
	queued_command_count = generated_symbol('queued_command_count'),
	event_types = generated_symbol('event_types'),
	event_payloads = generated_symbol('event_payloads'),
	queued_event_count = generated_symbol('queued_event_count'),
	index = generated_symbol('index'),
	command = generated_symbol('command'),
}

-- Slot metadata keeps compiled input member keys separate from generated result
-- accumulators and effect-range fields.
local input_slots<const> = {
	{
		member = 'press',
		result = symbols.press,
		effect_start = 'press_effect_start',
		effect_end = 'press_effect_end',
	},
	{
		member = 'hold',
		result = symbols.hold,
		effect_start = 'hold_effect_start',
		effect_end = 'hold_effect_end',
	},
	{
		member = 'release',
		result = symbols.release,
		effect_start = 'release_effect_start',
		effect_end = 'release_effect_end',
	},
	{
		member = 'combo',
		result = symbols.combo,
		effect_start = 'combo_effect_start',
		effect_end = 'combo_effect_end',
	},
}

local effect_kind<const> = {
	trigger = 1,
	consume = 2,
	gameplay = 3,
	command = 4,
}
evaluation_program_syntax.effect_kind = effect_kind

local operand_expression<const> = function(index)
	if index == 0 then
		return syntax_factory.nil_literal()
	end
	return index_expression(reference(symbols.operands), numeric_literal(index))
end

local emit_effect<const> = function(statements, effect, player_index)
	if effect.kind == effect_kind.trigger then
		statements[#statements + 1] = call_statement(call_expression(reference(symbols.trigger), {
			member_expression(reference(symbols.owner), 'actioneffects'),
			operand_expression(effect.id_operand_index),
			operand_expression(effect.payload_operand_index),
		}))
	elseif effect.kind == effect_kind.consume then
		statements[#statements + 1] = call_statement(call_expression(reference(symbols.input_consume), {
			numeric_literal(player_index),
			operand_expression(effect.operand_index),
		}))
	elseif effect.kind == effect_kind.gameplay then
		statements[#statements + 1] = assignment_statement(
			reference(symbols.queued_event_count),
			binary_expression(
				syntax.binary_add,
				reference(symbols.queued_event_count),
				numeric_literal(1)
			)
		)
		statements[#statements + 1] = assignment_statement(
			index_expression(reference(symbols.event_types), reference(symbols.queued_event_count)),
			operand_expression(effect.event_operand_index)
		)
		statements[#statements + 1] = assignment_statement(
			index_expression(reference(symbols.event_payloads), reference(symbols.queued_event_count)),
			operand_expression(effect.payload_operand_index)
		)
	else
		statements[#statements + 1] = assignment_statement(
			reference(symbols.queued_command_count),
			binary_expression(
				syntax.binary_add,
				reference(symbols.queued_command_count),
				numeric_literal(1)
			)
		)
		statements[#statements + 1] = assignment_statement(
			index_expression(reference(symbols.commands), reference(symbols.queued_command_count)),
			operand_expression(effect.operand_index)
		)
	end
end

local emit_effect_range<const> = function(statements, values, first, last)
	if last == nil then
		return
	end
	local effects<const> = values.effect_program.effects
	for index = first, last do
		emit_effect(statements, effects[index], values.player_index)
	end
end

local emit_match<const> = function(statements, record_match)
	if record_match then
		statements[#statements + 1] = assignment_statement(
			reference(symbols.matched),
			boolean_literal(true)
		)
	end
end

local emit_input<const> = function(statements, values, binding, binding_index, slot)
	local member<const> = slot.member
	if binding[member] == nil then
		return
	end
	statements[#statements + 1] = assignment_statement(
		reference(slot.result),
		call_expression(member_expression(reference(symbols.binding), member), {})
	)
	local body<const> = {}
	emit_match(body, values.record_match)
	local effect_start<const> = binding[slot.effect_start]
	local effect_end<const> = binding[slot.effect_end]
	emit_effect_range(body, values, effect_start, effect_end)
	if values.has_release and member ~= 'release' then
		body[#body + 1] = assignment_statement(
			index_expression(reference(symbols.latch), numeric_literal(binding_index)),
			boolean_literal(true)
		)
	end
	local condition
	if member == 'release' then
		condition = binary_expression(
			syntax.binary_and,
			reference(slot.result),
			reference(symbols.armed)
		)
		body[#body + 1] = assignment_statement(
			index_expression(reference(symbols.latch), numeric_literal(binding_index)),
			boolean_literal(false)
		)
	else
		condition = reference(slot.result)
	end
	statements[#statements + 1] = if_statement({ if_clause(condition, block(body)) })
end

local mode_expression<const> = function(mode, mode_index)
	local path_match
	if mode.path ~= nil then
		path_match = call_expression(member_expression(
			member_expression(reference(symbols.owner), 'state_machines'),
			'matches_state'
		), {
			member_expression(reference(symbols.owner), 'state_machines'),
			member_expression(index_expression(
				member_expression(reference(symbols.binding), 'modes'),
				numeric_literal(mode_index)
			), 'path'),
		})
	end
	local tag_match
	if mode.tag ~= nil then
		tag_match = call_expression(member_expression(reference(symbols.owner), 'has_tag'), {
			reference(symbols.owner),
			member_expression(index_expression(
				member_expression(reference(symbols.binding), 'modes'),
				numeric_literal(mode_index)
			), 'tag'),
		})
	end
	local result = path_match
	if result == nil then
		result = tag_match
	elseif tag_match ~= nil then
		result = binary_expression(syntax.binary_and, result, tag_match)
	end
	if mode.negated then
		result = unary_expression(syntax.unary_not, result)
	end
	return result
end

local build_mode_condition<const> = function(modes)
	local condition = mode_expression(modes[1], 1)
	for index = 2, #modes do
		condition = binary_expression(
			syntax.binary_and,
			condition,
			mode_expression(modes[index], index)
		)
	end
	return condition
end

local emit_binding_body<const> = function(statements, values, binding, binding_index)
	if values.has_release then
		statements[#statements + 1] = assignment_statement(
			reference(symbols.armed),
			index_expression(reference(symbols.latch), numeric_literal(binding_index))
		)
	end
	emit_input(statements, values, binding, binding_index, input_slots[1])
	emit_input(statements, values, binding, binding_index, input_slots[2])
	emit_input(statements, values, binding, binding_index, input_slots[3])
	emit_input(statements, values, binding, binding_index, input_slots[4])
	local custom<const> = binding.custom
	for custom_index = 1, #custom do
		local source_custom<const> = index_expression(
			member_expression(reference(symbols.binding), 'custom'),
			numeric_literal(custom_index)
		)
		statements[#statements + 1] = assignment_statement(
			index_expression(reference(symbols.custom_matches), numeric_literal(custom_index)),
			call_expression(member_expression(source_custom, 'input'), {})
		)
	end
	for custom_index = 1, #custom do
		local body<const> = {}
		emit_match(body, values.record_match)
		local custom_entry<const> = custom[custom_index]
		emit_effect_range(body, values, custom_entry.effect_start, custom_entry.effect_end)
		statements[#statements + 1] = if_statement({
			if_clause(
				index_expression(reference(symbols.custom_matches), numeric_literal(custom_index)),
				block(body)
			),
		})
	end
end

local emit_binding<const> = function(statements, values, binding, binding_index)
	statements[#statements + 1] = assignment_statement(
		reference(symbols.binding),
		index_expression(reference(symbols.bindings), numeric_literal(binding_index))
	)
	values.has_release = binding.release ~= nil
	local body<const> = {}
	emit_binding_body(body, values, binding, binding_index)
	local modes<const> = binding.modes
	if modes == nil then
		for index = 1, #body do
			statements[#statements + 1] = body[index]
		end
		return
	end
	local clauses<const> = { if_clause(build_mode_condition(modes), block(body)) }
	if values.has_release then
		clauses[2] = else_clause(block({
				assignment_statement(
					index_expression(reference(symbols.latch), numeric_literal(binding_index)),
					boolean_literal(false)
				),
			}))
	end
	statements[#statements + 1] = if_statement(clauses)
end

local emit_release_latch_clears<const> = function(statements, bindings, first)
	for binding_index = first, #bindings do
		if bindings[binding_index].release ~= nil then
			statements[#statements + 1] = assignment_statement(
				index_expression(reference(symbols.latch), numeric_literal(binding_index)),
				boolean_literal(false)
			)
		end
	end
end

local emit_bindings<const> = function(statements, values)
	local bindings<const> = values.bindings
	for binding_index = 1, #bindings do
		local binding<const> = bindings[binding_index]
		values.record_match = values.program.stop_after_match and binding_index < #bindings
		emit_binding(statements, values, binding, binding_index)
		if values.record_match then
			local matched_body<const> = {}
			emit_release_latch_clears(matched_body, bindings, binding_index + 1)
			matched_body[#matched_body + 1] = break_statement()
			statements[#statements + 1] = if_statement({
				if_clause(reference(symbols.matched), block(matched_body)),
			})
		end
	end
end

local emit_release_state<const> = function(statements, values)
	if values.program.release_binding_count == 0 then
		return
	end
	statements[#statements + 1] = local_statement(
		reference(symbols.latch),
		member_expression(reference(symbols.component), 'binding_latch'),
		false
	)
	statements[#statements + 1] = local_statement(reference(symbols.armed), nil, false)
	local clear_latches<const> = {}
	emit_release_latch_clears(clear_latches, values.bindings, 1)
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_not_equal,
				member_expression(reference(symbols.component), 'last_frame'),
				binary_expression(syntax.binary_subtract, reference(symbols.frame), numeric_literal(1))
			),
			block(clear_latches)
		),
	})
	statements[#statements + 1] = assignment_statement(
		member_expression(reference(symbols.component), 'last_frame'),
		reference(symbols.frame)
	)
end

local emit_input_locals<const> = function(statements, program)
	if program.has_press then
		statements[#statements + 1] = local_statement(reference(symbols.press), nil, false)
	end
	if program.has_hold then
		statements[#statements + 1] = local_statement(reference(symbols.hold), nil, false)
	end
	if program.release_binding_count > 0 then
		statements[#statements + 1] = local_statement(reference(symbols.release), nil, false)
	end
	if program.has_combo then
		statements[#statements + 1] = local_statement(reference(symbols.combo), nil, false)
	end
	if program.max_custom_count > 0 then
		statements[#statements + 1] = local_statement(
			reference(symbols.custom_matches),
			member_expression(reference(symbols.component), 'custom_matches'),
			false
		)
	end
end

local emit_dependency_captures<const> = function(statements, effect_program)
	statements[#statements + 1] = local_statement(
		reference(symbols.bindings),
		identifier('action_bindings'),
		true
	)
	if #effect_program.operands > 0 then
		statements[#statements + 1] = local_statement(
			reference(symbols.operands),
			identifier('effect_operands'),
			true
		)
	end
	if effect_program.environment.trigger ~= nil then
		statements[#statements + 1] = local_statement(
			reference(symbols.trigger),
			identifier('trigger'),
			true
		)
	end
	if effect_program.environment.input_consume ~= nil then
		statements[#statements + 1] = local_statement(
			reference(symbols.input_consume),
			identifier('input_consume'),
			true
		)
	end
end

local emit_command_flush<const> = function(statements)
	statements[#statements + 1] = assignment_statement(
		member_expression(reference(symbols.component), 'queued_command_count'),
		reference(symbols.queued_command_count)
	)
	statements[#statements + 1] = numeric_for_statement(
		reference(symbols.index),
		numeric_literal(1),
		reference(symbols.queued_command_count),
		nil,
		block({
			local_statement(
				reference(symbols.command),
				index_expression(reference(symbols.commands), reference(symbols.index)),
				false
			),
			call_statement(call_expression(
				member_expression(member_expression(reference(symbols.owner), 'state_machines'), 'dispatch'),
				{
					member_expression(reference(symbols.owner), 'state_machines'),
					member_expression(reference(symbols.command), 'event'),
					member_expression(reference(symbols.command), 'payload'),
				}
			)),
			assignment_statement(
				index_expression(reference(symbols.commands), reference(symbols.index)),
				boolean_literal(false)
			),
		})
	)
	statements[#statements + 1] = assignment_statement(
		member_expression(reference(symbols.component), 'queued_command_count'),
		numeric_literal(0)
	)
end

local emit_event_flush<const> = function(statements)
	statements[#statements + 1] = assignment_statement(
		member_expression(reference(symbols.component), 'queued_event_count'),
		reference(symbols.queued_event_count)
	)
	statements[#statements + 1] = numeric_for_statement(
		reference(symbols.index),
		numeric_literal(1),
		reference(symbols.queued_event_count),
		nil,
		block({
			call_statement(call_expression(
				member_expression(member_expression(reference(symbols.owner), 'events'), 'emit'),
				{
					member_expression(reference(symbols.owner), 'events'),
					index_expression(reference(symbols.event_types), reference(symbols.index)),
					index_expression(reference(symbols.event_payloads), reference(symbols.index)),
				}
			)),
			assignment_statement(
				index_expression(reference(symbols.event_types), reference(symbols.index)),
				boolean_literal(false)
			),
			assignment_statement(
				index_expression(reference(symbols.event_payloads), reference(symbols.index)),
				boolean_literal(false)
			),
		})
	)
	statements[#statements + 1] = assignment_statement(
		member_expression(reference(symbols.component), 'queued_event_count'),
		numeric_literal(0)
	)
end

function evaluation_program_syntax.build(program, effect_program, player_index)
	local values<const> = {
		program = program,
		bindings = program.bindings,
		effect_program = effect_program,
		player_index = player_index,
		has_release = false,
		record_match = false,
	}
	local statements<const> = {}
	emit_dependency_captures(statements, effect_program)
	local body<const> = {
		local_statement(
			reference(symbols.owner),
			member_expression(reference(symbols.component), 'parent'),
			false
		),
		local_statement(reference(symbols.binding), nil, false),
	}
	if effect_program.queued_command_capacity > 0 then
		body[#body + 1] = local_statement(
			reference(symbols.commands),
			member_expression(reference(symbols.component), 'queued_commands'),
			false
		)
		body[#body + 1] = local_statement(
			reference(symbols.queued_command_count),
			numeric_literal(0),
			false
		)
	end
	if effect_program.queued_event_capacity > 0 then
		body[#body + 1] = local_statement(
			reference(symbols.event_types),
			member_expression(reference(symbols.component), 'queued_event_types'),
			false
		)
		body[#body + 1] = local_statement(
			reference(symbols.event_payloads),
			member_expression(reference(symbols.component), 'queued_event_payloads'),
			false
		)
		body[#body + 1] = local_statement(
			reference(symbols.queued_event_count),
			numeric_literal(0),
			false
		)
	end
	emit_release_state(body, values)
	emit_input_locals(body, program)
	if program.stop_after_match and #program.bindings > 1 then
		local binding_body<const> = {}
		emit_bindings(binding_body, values)
		binding_body[#binding_body + 1] = break_statement()
		body[#body + 1] = local_statement(reference(symbols.matched), nil, false)
		body[#body + 1] = while_statement(boolean_literal(true), block(binding_body))
	else
		emit_bindings(body, values)
	end
	if effect_program.queued_command_capacity > 0 then
		emit_command_flush(body)
	end
	if effect_program.queued_event_capacity > 0 then
		emit_event_flush(body)
	end
	statements[#statements + 1] = return_statement({
		function_expression(
			{ reference(symbols.component), reference(symbols.frame) },
			block(body)
		),
	})
	return syntax_factory.chunk(block(statements))
end

return evaluation_program_syntax
