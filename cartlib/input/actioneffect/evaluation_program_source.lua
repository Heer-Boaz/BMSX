local lua_syntax<const> = require('cartlib/codegen/lua_syntax')

local evaluation_program_source<const> = {}
local binary_operator<const> = lua_syntax.binary_operator
local unary_operator<const> = lua_syntax.unary_operator
local identifier<const> = lua_syntax.identifier
local numeric_literal<const> = lua_syntax.numeric_literal
local boolean_literal<const> = lua_syntax.boolean_literal
local member_expression<const> = lua_syntax.member_expression
local index_expression<const> = lua_syntax.index_expression
local call_expression<const> = lua_syntax.call_expression
local binary_expression<const> = lua_syntax.binary_expression
local unary_expression<const> = lua_syntax.unary_expression
local function_expression<const> = lua_syntax.function_expression
local assignment_statement<const> = lua_syntax.assignment_statement
local local_declaration_statement<const> = lua_syntax.local_declaration_statement
local call_statement<const> = lua_syntax.call_statement
local if_statement<const> = lua_syntax.if_statement
local while_statement<const> = lua_syntax.while_statement
local for_numeric_statement<const> = lua_syntax.for_numeric_statement
local return_statement<const> = lua_syntax.return_statement
local break_statement<const> = lua_syntax.break_statement

local effect_kind<const> = {
	trigger = 1,
	consume = 2,
	gameplay = 3,
	command = 4,
}
evaluation_program_source.effect_kind = effect_kind

local expression<const> = {
	armed = identifier('armed'),
	binding = identifier('binding'),
	bindings = identifier('bindings'),
	commands = identifier('commands'),
	component = identifier('component'),
	custom_matches = identifier('custom_matches'),
	event_payloads = identifier('event_payloads'),
	event_types = identifier('event_types'),
	frame = identifier('frame'),
	hold = identifier('hold'),
	index = identifier('index'),
	latch = identifier('latch'),
	matched = identifier('matched'),
	owner = identifier('owner'),
	press = identifier('press'),
	queued_command_count = identifier('queued_command_count'),
	queued_event_count = identifier('queued_event_count'),
	release = identifier('release'),
}

local operand_expression<const> = function(index)
	if index == 0 then
		return lua_syntax.nil_literal
	end
	return index_expression(identifier('operands'), numeric_literal(index))
end

local emit_effect<const> = function(statements, effect, player_index)
	if effect.kind == effect_kind.trigger then
		statements[#statements + 1] = call_statement(call_expression(identifier('try_trigger'), {
			member_expression(expression.owner, 'actioneffects'),
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
			{ expression.queued_event_count },
			{
				binary_expression(
					binary_operator.add,
					expression.queued_event_count,
					numeric_literal(1)
				),
			}
		)
		statements[#statements + 1] = assignment_statement(
			{ index_expression(expression.event_types, expression.queued_event_count) },
			{ operand_expression(effect.event_operand_index) }
		)
		statements[#statements + 1] = assignment_statement(
			{ index_expression(expression.event_payloads, expression.queued_event_count) },
			{ operand_expression(effect.payload_operand_index) }
		)
	else
		statements[#statements + 1] = assignment_statement(
			{ expression.queued_command_count },
			{
				binary_expression(
					binary_operator.add,
					expression.queued_command_count,
					numeric_literal(1)
				),
			}
		)
		statements[#statements + 1] = assignment_statement(
			{ index_expression(expression.commands, expression.queued_command_count) },
			{ operand_expression(effect.operand_index) }
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
			{ expression.matched },
			{ boolean_literal(true) }
		)
	end
end

local emit_input<const> = function(statements, values, binding, binding_index, field, result)
	if binding[field] == nil then
		return
	end
	statements[#statements + 1] = assignment_statement(
		{ result },
		{ call_expression(member_expression(expression.binding, field), {}) }
	)
	local body<const> = {}
	emit_match(body, values.record_match)
	local effect_start<const> = binding[field .. '_effect_start']
	local effect_end<const> = binding[field .. '_effect_end']
	emit_effect_range(body, values, effect_start, effect_end)
	if values.has_release and field ~= 'release' then
		body[#body + 1] = assignment_statement(
			{ index_expression(expression.latch, numeric_literal(binding_index)) },
			{ boolean_literal(true) }
		)
	end
	local condition = result
	if field == 'release' then
		condition = binary_expression(binary_operator.logical_and, result, expression.armed)
		body[#body + 1] = assignment_statement(
			{ index_expression(expression.latch, numeric_literal(binding_index)) },
			{ boolean_literal(false) }
		)
	end
	statements[#statements + 1] = if_statement({ { condition, body } })
end

local mode_expression<const> = function(mode, mode_index)
	local source_mode<const> = index_expression(
		member_expression(expression.binding, 'modes'),
		numeric_literal(mode_index)
	)
	local state_machines<const> = member_expression(expression.owner, 'state_machines')
	local path_match
	if mode.path ~= nil then
		path_match = call_expression(member_expression(state_machines, 'matches_state'), {
			state_machines,
			member_expression(source_mode, 'path'),
		})
	end
	local tag_match
	if mode.tag ~= nil then
		tag_match = call_expression(member_expression(expression.owner, 'has_tag'), {
			expression.owner,
			member_expression(source_mode, 'tag'),
		})
	end
	local result = path_match
	if result == nil then
		result = tag_match
	elseif tag_match ~= nil then
		result = binary_expression(binary_operator.logical_and, result, tag_match)
	end
	if mode.negated then
		result = unary_expression(unary_operator.logical_not, result)
	end
	return result
end

local build_mode_condition<const> = function(modes)
	local condition = mode_expression(modes[1], 1)
	for index = 2, #modes do
		condition = binary_expression(
			binary_operator.logical_and,
			condition,
			mode_expression(modes[index], index)
		)
	end
	return condition
end

local emit_binding_body<const> = function(statements, values, binding, binding_index)
	if values.has_release then
		statements[#statements + 1] = assignment_statement(
			{ expression.armed },
			{ index_expression(expression.latch, numeric_literal(binding_index)) }
		)
	end
	emit_input(statements, values, binding, binding_index, 'press', expression.press)
	emit_input(statements, values, binding, binding_index, 'hold', expression.hold)
	emit_input(statements, values, binding, binding_index, 'release', expression.release)
	local custom<const> = binding.custom
	for custom_index = 1, #custom do
		local source_custom<const> = index_expression(
			member_expression(expression.binding, 'custom'),
			numeric_literal(custom_index)
		)
		statements[#statements + 1] = assignment_statement(
			{ index_expression(expression.custom_matches, numeric_literal(custom_index)) },
			{ call_expression(member_expression(source_custom, 'input'), {}) }
		)
	end
	for custom_index = 1, #custom do
		local body<const> = {}
		emit_match(body, values.record_match)
		local custom_entry<const> = custom[custom_index]
		emit_effect_range(body, values, custom_entry.effect_start, custom_entry.effect_end)
		statements[#statements + 1] = if_statement({
			{
				index_expression(expression.custom_matches, numeric_literal(custom_index)),
				body,
			},
		})
	end
end

local emit_binding<const> = function(statements, values, binding, binding_index)
	statements[#statements + 1] = assignment_statement(
		{ expression.binding },
		{ index_expression(expression.bindings, numeric_literal(binding_index)) }
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
	local clauses<const> = { { build_mode_condition(modes), body } }
	if values.has_release then
		clauses[2] = {
			nil,
			{
				assignment_statement(
					{ index_expression(expression.latch, numeric_literal(binding_index)) },
					{ boolean_literal(false) }
				),
			},
		}
	end
	statements[#statements + 1] = if_statement(clauses)
end

local emit_release_latch_clears<const> = function(statements, bindings, first)
	for binding_index = first, #bindings do
		if bindings[binding_index].release ~= nil then
			statements[#statements + 1] = assignment_statement(
				{ index_expression(expression.latch, numeric_literal(binding_index)) },
				{ boolean_literal(false) }
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
			matched_body[#matched_body + 1] = break_statement
			statements[#statements + 1] = if_statement({
				{ expression.matched, matched_body },
			})
		end
	end
end

local emit_release_state<const> = function(statements, values)
	if values.program.release_binding_count == 0 then
		return
	end
	statements[#statements + 1] = local_declaration_statement(
		{ 'latch' },
		{ member_expression(expression.component, 'binding_latch') },
		false
	)
	statements[#statements + 1] = local_declaration_statement({ 'armed' }, {}, false)
	local clear_latches<const> = {}
	emit_release_latch_clears(clear_latches, values.bindings, 1)
	statements[#statements + 1] = if_statement({
		{
			binary_expression(
				binary_operator.not_equal,
				member_expression(expression.component, 'last_frame'),
				binary_expression(binary_operator.subtract, expression.frame, numeric_literal(1))
			),
			clear_latches,
		},
	})
	statements[#statements + 1] = assignment_statement(
		{ member_expression(expression.component, 'last_frame') },
		{ expression.frame }
	)
end

local emit_input_locals<const> = function(statements, program)
	if program.has_press then
		statements[#statements + 1] = local_declaration_statement({ 'press' }, {}, false)
	end
	if program.has_hold then
		statements[#statements + 1] = local_declaration_statement({ 'hold' }, {}, false)
	end
	if program.release_binding_count > 0 then
		statements[#statements + 1] = local_declaration_statement({ 'release' }, {}, false)
	end
	if program.max_custom_count > 0 then
		statements[#statements + 1] = local_declaration_statement(
			{ 'custom_matches' },
			{ member_expression(expression.component, 'custom_matches') },
			false
		)
	end
end

local emit_dependency_captures<const> = function(statements, effect_program)
	statements[#statements + 1] = local_declaration_statement(
		{ 'bindings' },
		{ identifier('action_bindings') },
		true
	)
	if #effect_program.operands > 0 then
		statements[#statements + 1] = local_declaration_statement(
			{ 'operands' },
			{ identifier('effect_operands') },
			true
		)
	end
	if effect_program.environment.try_trigger ~= nil then
		statements[#statements + 1] = local_declaration_statement(
			{ 'try_trigger' },
			{ identifier('try_trigger') },
			true
		)
	end
	if effect_program.environment.input_consume ~= nil then
		statements[#statements + 1] = local_declaration_statement(
			{ 'input_consume' },
			{ identifier('input_consume') },
			true
		)
	end
end

local emit_command_flush<const> = function(statements)
	statements[#statements + 1] = assignment_statement(
		{ member_expression(expression.component, 'queued_command_count') },
		{ expression.queued_command_count }
	)
	statements[#statements + 1] = for_numeric_statement(
		'index',
		numeric_literal(1),
		expression.queued_command_count,
		nil,
		{
			local_declaration_statement(
				{ 'command' },
				{ index_expression(expression.commands, expression.index) },
				false
			),
			call_statement(call_expression(
				member_expression(member_expression(expression.owner, 'state_machines'), 'dispatch'),
				{
					member_expression(expression.owner, 'state_machines'),
					member_expression(identifier('command'), 'event'),
					member_expression(identifier('command'), 'payload'),
				}
			)),
			assignment_statement(
				{ index_expression(expression.commands, expression.index) },
				{ boolean_literal(false) }
			),
		}
	)
	statements[#statements + 1] = assignment_statement(
		{ member_expression(expression.component, 'queued_command_count') },
		{ numeric_literal(0) }
	)
end

local emit_event_flush<const> = function(statements)
	statements[#statements + 1] = assignment_statement(
		{ member_expression(expression.component, 'queued_event_count') },
		{ expression.queued_event_count }
	)
	statements[#statements + 1] = for_numeric_statement(
		'index',
		numeric_literal(1),
		expression.queued_event_count,
		nil,
		{
			call_statement(call_expression(
				member_expression(member_expression(expression.owner, 'events'), 'emit'),
				{
					member_expression(expression.owner, 'events'),
					index_expression(expression.event_types, expression.index),
					index_expression(expression.event_payloads, expression.index),
				}
			)),
			assignment_statement(
				{ index_expression(expression.event_types, expression.index) },
				{ boolean_literal(false) }
			),
			assignment_statement(
				{ index_expression(expression.event_payloads, expression.index) },
				{ boolean_literal(false) }
			),
		}
	)
	statements[#statements + 1] = assignment_statement(
		{ member_expression(expression.component, 'queued_event_count') },
		{ numeric_literal(0) }
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
		local_declaration_statement(
			{ 'owner' },
			{ member_expression(expression.component, 'parent') },
			false
		),
		local_declaration_statement({ 'binding' }, {}, false),
	}
	if effect_program.queued_command_capacity > 0 then
		body[#body + 1] = local_declaration_statement(
			{ 'commands' },
			{ member_expression(expression.component, 'queued_commands') },
			false
		)
		body[#body + 1] = local_declaration_statement(
			{ 'queued_command_count' },
			{ numeric_literal(0) },
			false
		)
	end
	if effect_program.queued_event_capacity > 0 then
		body[#body + 1] = local_declaration_statement(
			{ 'event_types' },
			{ member_expression(expression.component, 'queued_event_types') },
			false
		)
		body[#body + 1] = local_declaration_statement(
			{ 'event_payloads' },
			{ member_expression(expression.component, 'queued_event_payloads') },
			false
		)
		body[#body + 1] = local_declaration_statement(
			{ 'queued_event_count' },
			{ numeric_literal(0) },
			false
		)
	end
	emit_release_state(body, values)
	emit_input_locals(body, program)
	if program.stop_after_match and #program.bindings > 1 then
		local binding_body<const> = {}
		emit_bindings(binding_body, values)
		binding_body[#binding_body + 1] = break_statement
		body[#body + 1] = local_declaration_statement({ 'matched' }, {}, false)
		body[#body + 1] = while_statement(boolean_literal(true), binding_body)
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
		function_expression({ 'component', 'frame' }, body),
	})
	return lua_syntax.chunk(statements)
end

return evaluation_program_source
