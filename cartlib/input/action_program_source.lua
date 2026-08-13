local action_syntax<const> = require('cartlib/input/action_syntax')
local lua_syntax<const> = require('cartlib/codegen/lua_syntax')

local action_program_source<const> = {}
local modifier_kind<const> = action_syntax.modifier_kind
local node_kind<const> = action_syntax.node_kind
local function_kind<const> = action_syntax.function_kind
local compare_operator<const> = action_syntax.compare_operator
local edge<const> = action_syntax.edge
local binary_operator<const> = lua_syntax.binary_operator
local unary_operator<const> = lua_syntax.unary_operator
local identifier<const> = lua_syntax.identifier
local numeric_literal<const> = lua_syntax.numeric_literal
local boolean_literal<const> = lua_syntax.boolean_literal
local member_expression<const> = lua_syntax.member_expression
local call_expression<const> = lua_syntax.call_expression
local binary_expression<const> = lua_syntax.binary_expression
local unary_expression<const> = lua_syntax.unary_expression
local function_expression<const> = lua_syntax.function_expression
local assignment_statement<const> = lua_syntax.assignment_statement
local local_declaration_statement<const> = lua_syntax.local_declaration_statement
local if_statement<const> = lua_syntax.if_statement
local return_statement<const> = lua_syntax.return_statement

local comparison_operator<const> = {
	[compare_operator.less_than] = binary_operator.less_than,
	[compare_operator.greater_than] = binary_operator.greater_than,
	[compare_operator.less_equal] = binary_operator.less_equal,
	[compare_operator.greater_equal] = binary_operator.greater_equal,
	[compare_operator.equal] = binary_operator.equal,
	[compare_operator.not_equal] = binary_operator.not_equal,
}

local modifier_state_field<const> = {
	[modifier_kind.pressed] = 'pressed',
	[modifier_kind.just_pressed] = 'just_pressed',
	[modifier_kind.all_just_pressed] = 'all_just_pressed',
	[modifier_kind.just_released] = 'just_released',
	[modifier_kind.all_just_released] = 'all_just_released',
	[modifier_kind.guarded_just_pressed] = 'guarded_just_pressed',
	[modifier_kind.repeat_pressed] = 'repeat_pressed',
	[modifier_kind.consumed] = 'consumed',
}

local edge_function_spec<const> = {
	[function_kind.any_just_pressed] = {
		all = false,
		edge_bit = edge.just_pressed,
		state_field = 'just_pressed',
	},
	[function_kind.all_just_pressed] = {
		all = true,
		edge_bit = edge.just_pressed,
		state_field = 'just_pressed',
	},
	[function_kind.any_just_released] = {
		all = false,
		edge_bit = edge.just_released,
		state_field = 'just_released',
	},
	[function_kind.all_just_released] = {
		all = true,
		edge_bit = edge.just_released,
		state_field = 'just_released',
	},
	[function_kind.any_guarded_just_pressed] = {
		all = false,
		edge_bit = edge.guarded_just_pressed,
		state_field = 'guarded_just_pressed',
	},
	[function_kind.all_guarded_just_pressed] = {
		all = true,
		edge_bit = edge.guarded_just_pressed,
		state_field = 'guarded_just_pressed',
	},
	[function_kind.any_repeat_pressed] = {
		all = false,
		edge_bit = edge.repeat_pressed,
		state_field = 'repeat_pressed',
	},
	[function_kind.all_repeat_pressed] = {
		all = true,
		edge_bit = edge.repeat_pressed,
		state_field = 'repeat_pressed',
	},
	[function_kind.any_within_press] = {
		all = false,
		edge_bit = edge.within_press,
		delta_field = 'min_press_delta',
	},
	[function_kind.all_within_press] = {
		all = true,
		edge_bit = edge.within_press,
		delta_field = 'min_press_delta',
	},
	[function_kind.any_within_release] = {
		all = false,
		edge_bit = edge.within_release,
		delta_field = 'min_release_delta',
	},
	[function_kind.all_within_release] = {
		all = true,
		edge_bit = edge.within_release,
		delta_field = 'min_release_delta',
	},
}

local expression<const> = {
	context = identifier('context'),
	edge_all = identifier('edge_all'),
	edge_any = identifier('edge_any'),
	edge_eligible = identifier('edge_eligible'),
	edge_ok = identifier('edge_ok'),
	get_state = identifier('get_state'),
	result = identifier('result'),
	state = identifier('state'),
}

local modifier_expression<const> = function(spec)
	local state_field<const> = modifier_state_field[spec.kind]
	local result
	if state_field ~= nil then
		result = member_expression(expression.state, state_field)
	elseif spec.kind == modifier_kind.released then
		result = unary_expression(
			unary_operator.logical_not,
			member_expression(expression.state, 'pressed')
		)
	elseif spec.kind == modifier_kind.held then
		result = binary_expression(
			binary_operator.greater_equal,
			member_expression(expression.state, 'press_time'),
			numeric_literal(1)
		)
	elseif spec.kind == modifier_kind.within_press then
		result = binary_expression(
			binary_operator.less_than,
			member_expression(expression.state, 'min_press_delta'),
			numeric_literal(spec.window)
		)
	elseif spec.kind == modifier_kind.within_release then
		result = binary_expression(
			binary_operator.less_than,
			member_expression(expression.state, 'min_release_delta'),
			numeric_literal(spec.window)
		)
	elseif spec.kind == modifier_kind.press_time then
		result = binary_expression(
			comparison_operator[spec.op],
			member_expression(expression.state, 'press_time'),
			numeric_literal(spec.value)
		)
	else
		result = binary_expression(
			comparison_operator[spec.op],
			member_expression(expression.state, 'repeat_count'),
			numeric_literal(spec.value)
		)
	end
	if spec.neg then
		return unary_expression(unary_operator.logical_not, result)
	end
	return result
end

local append_condition<const> = function(condition, term)
	if condition == nil then
		return term
	end
	return binary_expression(binary_operator.logical_and, condition, term)
end

local action_condition<const> = function(node, bare_requires_pressed)
	local condition
	local specs<const> = node.mod_specs
	if #specs == 0 and bare_requires_pressed then
		condition = member_expression(expression.state, 'pressed')
	end
	for index = 1, #specs do
		condition = append_condition(condition, modifier_expression(specs[index]))
	end
	if not node.has_consume_mod then
		condition = append_condition(
			condition,
			unary_expression(
				unary_operator.logical_not,
				member_expression(expression.state, 'consumed')
			)
		)
	end
	return condition
end

local emit_action<const> = function(statements, state, node, target, bare_requires_pressed)
	state.uses_state = true
	statements[#statements + 1] = assignment_statement(
		{ expression.state },
		{
			call_expression(expression.get_state, {
				expression.context,
				numeric_literal(node.action_index),
			}),
		}
	)
	statements[#statements + 1] = assignment_statement(
		{ target },
		{ action_condition(node, bare_requires_pressed) }
	)
end

local emit_evaluation
local emit_edge_collection

local emit_edge_match<const> = function(statements, edge_spec, window)
	local match
	if edge_spec.state_field ~= nil then
		match = member_expression(expression.state, edge_spec.state_field)
	else
		match = binary_expression(
			binary_operator.less_than,
			member_expression(expression.state, edge_spec.delta_field),
			window
		)
	end
	statements[#statements + 1] = assignment_statement({ expression.edge_any }, { match })
	statements[#statements + 1] = assignment_statement(
		{ expression.edge_all },
		{ expression.edge_any }
	)
end

local emit_edge_empty<const> = function(statements, matches)
	statements[#statements + 1] = assignment_statement(
		{ expression.edge_ok },
		{ boolean_literal(matches) }
	)
	statements[#statements + 1] = assignment_statement(
		{ expression.edge_eligible },
		{ numeric_literal(0) }
	)
	statements[#statements + 1] = assignment_statement(
		{ expression.edge_any },
		{ boolean_literal(false) }
	)
	statements[#statements + 1] = assignment_statement(
		{ expression.edge_all },
		{ boolean_literal(true) }
	)
end

local emit_edge_reset<const> = function(statements)
	statements[#statements + 1] = assignment_statement(
		{ expression.edge_eligible },
		{ numeric_literal(0) }
	)
	statements[#statements + 1] = assignment_statement(
		{ expression.edge_any },
		{ boolean_literal(false) }
	)
	statements[#statements + 1] = assignment_statement(
		{ expression.edge_all },
		{ boolean_literal(true) }
	)
end

local emit_edge_and_continuation<const> = function(statements, state, node, window, edge_spec)
	local body<const> = {
		local_declaration_statement(
			{ 'left_eligible' },
			{ expression.edge_eligible },
			false
		),
		local_declaration_statement({ 'left_any' }, { expression.edge_any }, false),
		local_declaration_statement({ 'left_all' }, { expression.edge_all }, false),
	}
	emit_edge_collection(body, state, node, window, edge_spec)
	body[#body + 1] = if_statement({
		{
			expression.edge_ok,
			{
				assignment_statement(
					{ expression.edge_eligible },
					{
						binary_expression(
							binary_operator.add,
							identifier('left_eligible'),
							expression.edge_eligible
						),
					}
				),
				assignment_statement(
					{ expression.edge_any },
					{
						binary_expression(
							binary_operator.logical_or,
							identifier('left_any'),
							expression.edge_any
						),
					}
				),
				assignment_statement(
					{ expression.edge_all },
					{
						binary_expression(
							binary_operator.logical_and,
							identifier('left_all'),
							expression.edge_all
						),
					}
				),
			},
		},
	})
	statements[#statements + 1] = if_statement({ { expression.edge_ok, body } })
end

local emit_edge_function<const> = function(statements, state, node, window, edge_spec)
	local args<const> = node.args
	if node.function_kind == function_kind.all then
		if #args == 0 then
			emit_edge_empty(statements, true)
			return
		end
		emit_edge_collection(statements, state, args[1], window, edge_spec)
		for index = 2, #args do
			emit_edge_and_continuation(statements, state, args[index], window, edge_spec)
		end
		return
	end
	if node.function_kind == function_kind.any then
		if #args == 0 then
			emit_edge_empty(statements, false)
			return
		end
		emit_edge_collection(statements, state, args[1], window, edge_spec)
		for index = 2, #args do
			local body<const> = {}
			emit_edge_collection(body, state, args[index], window, edge_spec)
			statements[#statements + 1] = if_statement({
				{
					unary_expression(unary_operator.logical_not, expression.edge_ok),
					body,
				},
			})
		end
		return
	end
	emit_evaluation(statements, state, node, expression.edge_ok, window)
	emit_edge_reset(statements)
end

emit_edge_collection = function(statements, state, node, window, edge_spec)
	local kind<const> = node.kind
	if kind == node_kind.action then
		emit_action(statements, state, node, expression.edge_ok, false)
		emit_edge_reset(statements)
		if node.edge_mask & edge_spec.edge_bit ~= 0 then
			local body<const> = {
				assignment_statement(
					{ expression.edge_eligible },
					{ numeric_literal(1) }
				),
			}
			emit_edge_match(body, edge_spec, window)
			statements[#statements + 1] = if_statement({ { expression.edge_ok, body } })
		end
	elseif kind == node_kind.logical_not then
		emit_evaluation(statements, state, node.left, expression.edge_ok, window)
		statements[#statements + 1] = assignment_statement(
			{ expression.edge_ok },
			{ unary_expression(unary_operator.logical_not, expression.edge_ok) }
		)
		emit_edge_reset(statements)
	elseif kind == node_kind.logical_and then
		emit_edge_collection(statements, state, node.left, window, edge_spec)
		emit_edge_and_continuation(statements, state, node.right, window, edge_spec)
	elseif kind == node_kind.logical_or then
		emit_edge_collection(statements, state, node.left, window, edge_spec)
		local body<const> = {}
		emit_edge_collection(body, state, node.right, window, edge_spec)
		statements[#statements + 1] = if_statement({
			{
				unary_expression(unary_operator.logical_not, expression.edge_ok),
				body,
			},
		})
	else
		emit_edge_function(statements, state, node, window, edge_spec)
	end
end

local edge_result_expression<const> = function(edge_spec)
	if edge_spec.all then
		return binary_expression(
			binary_operator.logical_and,
			binary_expression(
				binary_operator.logical_and,
				expression.edge_ok,
				binary_expression(
					binary_operator.greater_than,
					expression.edge_eligible,
					numeric_literal(0)
				)
			),
			expression.edge_all
		)
	end
	return binary_expression(binary_operator.logical_and, expression.edge_ok, expression.edge_any)
end

local emit_function_evaluation<const> = function(statements, state, node, target, inherited_window)
	local window = inherited_window
	if node.window ~= nil then
		window = numeric_literal(node.window)
	end
	local args<const> = node.args
	if node.function_kind == function_kind.all or node.function_kind == function_kind.any then
		local matches_all<const> = node.function_kind == function_kind.all
		if #args == 0 then
			statements[#statements + 1] = assignment_statement(
				{ target },
				{ boolean_literal(matches_all) }
			)
			return
		end
		emit_evaluation(statements, state, args[1], target, window)
		for index = 2, #args do
			local body<const> = {}
			emit_evaluation(body, state, args[index], target, window)
			local condition = target
			if not matches_all then
				condition = unary_expression(unary_operator.logical_not, target)
			end
			statements[#statements + 1] = if_statement({ { condition, body } })
		end
		return
	end
	state.uses_edge = true
	local edge_spec<const> = edge_function_spec[node.function_kind]
	if #args == 0 then
		statements[#statements + 1] = assignment_statement(
			{ target },
			{ boolean_literal(edge_spec.all) }
		)
		return
	end
	emit_edge_collection(statements, state, args[1], window, edge_spec)
	statements[#statements + 1] = assignment_statement(
		{ target },
		{ edge_result_expression(edge_spec) }
	)
	for index = 2, #args do
		local body<const> = {}
		emit_edge_collection(body, state, args[index], window, edge_spec)
		body[#body + 1] = assignment_statement(
			{ target },
			{ edge_result_expression(edge_spec) }
		)
		local condition = target
		if not edge_spec.all then
			condition = unary_expression(unary_operator.logical_not, target)
		end
		statements[#statements + 1] = if_statement({ { condition, body } })
	end
end

emit_evaluation = function(statements, state, node, target, window)
	local kind<const> = node.kind
	if kind == node_kind.action then
		emit_action(statements, state, node, target, true)
	elseif kind == node_kind.logical_not then
		emit_evaluation(statements, state, node.left, target, window)
		statements[#statements + 1] = assignment_statement(
			{ target },
			{ unary_expression(unary_operator.logical_not, target) }
		)
	elseif kind == node_kind.logical_and then
		emit_evaluation(statements, state, node.left, target, window)
		local body<const> = {}
		emit_evaluation(body, state, node.right, target, window)
		statements[#statements + 1] = if_statement({ { target, body } })
	elseif kind == node_kind.logical_or then
		emit_evaluation(statements, state, node.left, target, window)
		local body<const> = {}
		emit_evaluation(body, state, node.right, target, window)
		statements[#statements + 1] = if_statement({
			{
				unary_expression(unary_operator.logical_not, target),
				body,
			},
		})
	else
		emit_function_evaluation(statements, state, node, target, window)
	end
end

function action_program_source.build(ast)
	local state<const> = { uses_state = false, uses_edge = false }
	local evaluation_body<const> = {}
	emit_evaluation(evaluation_body, state, ast, expression.result, identifier('win'))
	local evaluator_body<const> = {
		local_declaration_statement({ 'result' }, {}, false),
	}
	if state.uses_state then
		evaluator_body[#evaluator_body + 1] = local_declaration_statement({ 'state' }, {}, false)
	end
	if state.uses_edge then
		evaluator_body[#evaluator_body + 1] = local_declaration_statement({ 'edge_ok' }, {}, false)
		evaluator_body[#evaluator_body + 1] = local_declaration_statement({ 'edge_eligible' }, {}, false)
		evaluator_body[#evaluator_body + 1] = local_declaration_statement({ 'edge_any' }, {}, false)
		evaluator_body[#evaluator_body + 1] = local_declaration_statement({ 'edge_all' }, {}, false)
	end
	for index = 1, #evaluation_body do
		evaluator_body[#evaluator_body + 1] = evaluation_body[index]
	end
	evaluator_body[#evaluator_body + 1] = return_statement({ expression.result })
	return lua_syntax.chunk({
		return_statement({
			function_expression({ 'source_get_state', 'source_states', 'source_win' }, {
				local_declaration_statement(
					{ 'get_state' },
					{ identifier('source_get_state') },
					true
				),
				local_declaration_statement(
					{ 'context' },
					{ identifier('source_states') },
					true
				),
				local_declaration_statement(
					{ 'win' },
					{ identifier('source_win') },
					true
				),
				return_statement({ function_expression({}, evaluator_body) }),
			}),
		}),
	})
end

return action_program_source
