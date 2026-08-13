local syntax_factory<const> = lua_compiler.syntax_factory

local evaluation_program_source<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
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

local effect_kind<const> = {
	trigger = 1,
	consume = 2,
	gameplay = 3,
	command = 4,
}
evaluation_program_source.effect_kind = effect_kind

local operand_expression<const> = function(index)
	if index == 0 then
		return syntax_factory.nil_literal()
	end
	return index_expression(identifier('operands'), numeric_literal(index))
end

local emit_effect<const> = function(statements, effect, player_index)
	if effect.kind == effect_kind.trigger then
		statements[#statements + 1] = call_statement(call_expression(identifier('try_trigger'), {
			member_expression(identifier('owner'), 'actioneffects'),
			operand_expression(effect.id_operand_index),
			operand_expression(effect.payload_operand_index),
		}))
	elseif effect.kind == effect_kind.consume then
		statements[#statements + 1] = call_statement(call_expression(identifier('input_consume'), {
			numeric_literal(player_index),
			operand_expression(effect.operand_index),
		}))
	elseif effect.kind == effect_kind.gameplay then
		statements[#statements + 1] = assignment_statement(
			identifier('queued_event_count'),
			binary_expression(
				syntax.binary_add,
				identifier('queued_event_count'),
				numeric_literal(1)
			)
		)
		statements[#statements + 1] = assignment_statement(
			index_expression(identifier('event_types'), identifier('queued_event_count')),
			operand_expression(effect.event_operand_index)
		)
		statements[#statements + 1] = assignment_statement(
			index_expression(identifier('event_payloads'), identifier('queued_event_count')),
			operand_expression(effect.payload_operand_index)
		)
	else
		statements[#statements + 1] = assignment_statement(
			identifier('queued_command_count'),
			binary_expression(
				syntax.binary_add,
				identifier('queued_command_count'),
				numeric_literal(1)
			)
		)
		statements[#statements + 1] = assignment_statement(
			index_expression(identifier('commands'), identifier('queued_command_count')),
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
			identifier('matched'),
			boolean_literal(true)
		)
	end
end

local emit_input<const> = function(statements, values, binding, binding_index, field, result_name)
	if binding[field] == nil then
		return
	end
	statements[#statements + 1] = assignment_statement(
		identifier(result_name),
		call_expression(member_expression(identifier('binding'), field), {})
	)
	local body<const> = {}
	emit_match(body, values.record_match)
	local effect_start<const> = binding[field .. '_effect_start']
	local effect_end<const> = binding[field .. '_effect_end']
	emit_effect_range(body, values, effect_start, effect_end)
	if values.has_release and field ~= 'release' then
		body[#body + 1] = assignment_statement(
			index_expression(identifier('latch'), numeric_literal(binding_index)),
			boolean_literal(true)
		)
	end
	local condition
	if field == 'release' then
		condition = binary_expression(
			syntax.binary_and,
			identifier(result_name),
			identifier('armed')
		)
		body[#body + 1] = assignment_statement(
			index_expression(identifier('latch'), numeric_literal(binding_index)),
			boolean_literal(false)
		)
	else
		condition = identifier(result_name)
	end
	statements[#statements + 1] = if_statement({ if_clause(condition, block(body)) })
end

local mode_expression<const> = function(mode, mode_index)
	local path_match
	if mode.path ~= nil then
		path_match = call_expression(member_expression(
			member_expression(identifier('owner'), 'state_machines'),
			'matches_state'
		), {
			member_expression(identifier('owner'), 'state_machines'),
			member_expression(index_expression(
				member_expression(identifier('binding'), 'modes'),
				numeric_literal(mode_index)
			), 'path'),
		})
	end
	local tag_match
	if mode.tag ~= nil then
		tag_match = call_expression(member_expression(identifier('owner'), 'has_tag'), {
			identifier('owner'),
			member_expression(index_expression(
				member_expression(identifier('binding'), 'modes'),
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
			identifier('armed'),
			index_expression(identifier('latch'), numeric_literal(binding_index))
		)
	end
	emit_input(statements, values, binding, binding_index, 'press', 'press')
	emit_input(statements, values, binding, binding_index, 'hold', 'hold')
	emit_input(statements, values, binding, binding_index, 'release', 'release')
	local custom<const> = binding.custom
	for custom_index = 1, #custom do
		local source_custom<const> = index_expression(
			member_expression(identifier('binding'), 'custom'),
			numeric_literal(custom_index)
		)
		statements[#statements + 1] = assignment_statement(
			index_expression(identifier('custom_matches'), numeric_literal(custom_index)),
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
				index_expression(identifier('custom_matches'), numeric_literal(custom_index)),
				block(body)
			),
		})
	end
end

local emit_binding<const> = function(statements, values, binding, binding_index)
	statements[#statements + 1] = assignment_statement(
		identifier('binding'),
		index_expression(identifier('bindings'), numeric_literal(binding_index))
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
					index_expression(identifier('latch'), numeric_literal(binding_index)),
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
				index_expression(identifier('latch'), numeric_literal(binding_index)),
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
				if_clause(identifier('matched'), block(matched_body)),
			})
		end
	end
end

local emit_release_state<const> = function(statements, values)
	if values.program.release_binding_count == 0 then
		return
	end
	statements[#statements + 1] = local_statement(
		identifier('latch'),
		member_expression(identifier('component'), 'binding_latch'),
		false
	)
	statements[#statements + 1] = local_statement(identifier('armed'), nil, false)
	local clear_latches<const> = {}
	emit_release_latch_clears(clear_latches, values.bindings, 1)
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_not_equal,
				member_expression(identifier('component'), 'last_frame'),
				binary_expression(syntax.binary_subtract, identifier('frame'), numeric_literal(1))
			),
			block(clear_latches)
		),
	})
	statements[#statements + 1] = assignment_statement(
		member_expression(identifier('component'), 'last_frame'),
		identifier('frame')
	)
end

local emit_input_locals<const> = function(statements, program)
	if program.has_press then
		statements[#statements + 1] = local_statement(identifier('press'), nil, false)
	end
	if program.has_hold then
		statements[#statements + 1] = local_statement(identifier('hold'), nil, false)
	end
	if program.release_binding_count > 0 then
		statements[#statements + 1] = local_statement(identifier('release'), nil, false)
	end
	if program.max_custom_count > 0 then
		statements[#statements + 1] = local_statement(
			identifier('custom_matches'),
			member_expression(identifier('component'), 'custom_matches'),
			false
		)
	end
end

local emit_dependency_captures<const> = function(statements, effect_program)
	statements[#statements + 1] = local_statement(
		identifier('bindings'),
		identifier('action_bindings'),
		true
	)
	if #effect_program.operands > 0 then
		statements[#statements + 1] = local_statement(
			identifier('operands'),
			identifier('effect_operands'),
			true
		)
	end
	if effect_program.environment.try_trigger ~= nil then
		statements[#statements + 1] = local_statement(
			identifier('try_trigger'),
			identifier('try_trigger'),
			true
		)
	end
	if effect_program.environment.input_consume ~= nil then
		statements[#statements + 1] = local_statement(
			identifier('input_consume'),
			identifier('input_consume'),
			true
		)
	end
end

local emit_command_flush<const> = function(statements)
	statements[#statements + 1] = assignment_statement(
		member_expression(identifier('component'), 'queued_command_count'),
		identifier('queued_command_count')
	)
	statements[#statements + 1] = numeric_for_statement(
		identifier('index'),
		numeric_literal(1),
		identifier('queued_command_count'),
		nil,
		block({
			local_statement(
				identifier('command'),
				index_expression(identifier('commands'), identifier('index')),
				false
			),
			call_statement(call_expression(
				member_expression(member_expression(identifier('owner'), 'state_machines'), 'dispatch'),
				{
					member_expression(identifier('owner'), 'state_machines'),
					member_expression(identifier('command'), 'event'),
					member_expression(identifier('command'), 'payload'),
				}
			)),
			assignment_statement(
				index_expression(identifier('commands'), identifier('index')),
				boolean_literal(false)
			),
		})
	)
	statements[#statements + 1] = assignment_statement(
		member_expression(identifier('component'), 'queued_command_count'),
		numeric_literal(0)
	)
end

local emit_event_flush<const> = function(statements)
	statements[#statements + 1] = assignment_statement(
		member_expression(identifier('component'), 'queued_event_count'),
		identifier('queued_event_count')
	)
	statements[#statements + 1] = numeric_for_statement(
		identifier('index'),
		numeric_literal(1),
		identifier('queued_event_count'),
		nil,
		block({
			call_statement(call_expression(
				member_expression(member_expression(identifier('owner'), 'events'), 'emit'),
				{
					member_expression(identifier('owner'), 'events'),
					index_expression(identifier('event_types'), identifier('index')),
					index_expression(identifier('event_payloads'), identifier('index')),
				}
			)),
			assignment_statement(
				index_expression(identifier('event_types'), identifier('index')),
				boolean_literal(false)
			),
			assignment_statement(
				index_expression(identifier('event_payloads'), identifier('index')),
				boolean_literal(false)
			),
		})
	)
	statements[#statements + 1] = assignment_statement(
		member_expression(identifier('component'), 'queued_event_count'),
		numeric_literal(0)
	)
end

function evaluation_program_source.build(program, effect_program, player_index)
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
			identifier('owner'),
			member_expression(identifier('component'), 'parent'),
			false
		),
		local_statement(identifier('binding'), nil, false),
	}
	if effect_program.queued_command_capacity > 0 then
		body[#body + 1] = local_statement(
			identifier('commands'),
			member_expression(identifier('component'), 'queued_commands'),
			false
		)
		body[#body + 1] = local_statement(
			identifier('queued_command_count'),
			numeric_literal(0),
			false
		)
	end
	if effect_program.queued_event_capacity > 0 then
		body[#body + 1] = local_statement(
			identifier('event_types'),
			member_expression(identifier('component'), 'queued_event_types'),
			false
		)
		body[#body + 1] = local_statement(
			identifier('event_payloads'),
			member_expression(identifier('component'), 'queued_event_payloads'),
			false
		)
		body[#body + 1] = local_statement(
			identifier('queued_event_count'),
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
		body[#body + 1] = local_statement(identifier('matched'), nil, false)
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
			{ identifier('component'), identifier('frame') },
			block(body)
		),
	})
	return syntax_factory.chunk(block(statements))
end

return evaluation_program_source
