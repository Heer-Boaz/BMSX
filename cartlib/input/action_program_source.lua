local action_syntax<const> = require('cartlib/input/action_syntax')
local syntax_factory<const> = lua_compiler.syntax_factory

local action_program_source<const> = {}
local modifier_kind<const> = action_syntax.modifier_kind
local node_kind<const> = action_syntax.node_kind
local function_kind<const> = action_syntax.function_kind
local compare_operator<const> = action_syntax.compare_operator
local edge<const> = action_syntax.edge
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local numeric_literal<const> = syntax_factory.number_literal
local boolean_literal<const> = syntax_factory.boolean_literal
local member_expression<const> = syntax_factory.member_expression
local call_expression<const> = syntax_factory.call_expression
local binary_expression<const> = syntax_factory.binary_expression
local unary_expression<const> = syntax_factory.unary_expression
local function_expression<const> = syntax_factory.function_expression
local assignment_statement<const> = syntax_factory.assignment_statement
local local_statement<const> = syntax_factory.local_statement
local if_clause<const> = syntax_factory.if_clause
local if_statement<const> = syntax_factory.if_statement
local return_statement<const> = syntax_factory.return_statement

local comparison_operator<const> = {
	[compare_operator.less_than] = syntax.binary_less,
	[compare_operator.greater_than] = syntax.binary_greater,
	[compare_operator.less_equal] = syntax.binary_less_equal,
	[compare_operator.greater_equal] = syntax.binary_greater_equal,
	[compare_operator.equal] = syntax.binary_equal,
	[compare_operator.not_equal] = syntax.binary_not_equal,
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

local window_expression<const> = function(window)
	if window == nil then
		return identifier('win')
	end
	return numeric_literal(window)
end

local modifier_expression<const> = function(spec)
	local state_field<const> = modifier_state_field[spec.kind]
	local result
	if state_field ~= nil then
		result = member_expression(identifier('state'), state_field)
	elseif spec.kind == modifier_kind.released then
		result = unary_expression(
			syntax.unary_not,
			member_expression(identifier('state'), 'pressed')
		)
	elseif spec.kind == modifier_kind.held then
		result = binary_expression(
			syntax.binary_greater_equal,
			member_expression(identifier('state'), 'press_time'),
			numeric_literal(1)
		)
	elseif spec.kind == modifier_kind.within_press then
		result = binary_expression(
			syntax.binary_less,
			member_expression(identifier('state'), 'min_press_delta'),
			numeric_literal(spec.window)
		)
	elseif spec.kind == modifier_kind.within_release then
		result = binary_expression(
			syntax.binary_less,
			member_expression(identifier('state'), 'min_release_delta'),
			numeric_literal(spec.window)
		)
	elseif spec.kind == modifier_kind.press_time then
		result = binary_expression(
			comparison_operator[spec.op],
			member_expression(identifier('state'), 'press_time'),
			numeric_literal(spec.value)
		)
	else
		result = binary_expression(
			comparison_operator[spec.op],
			member_expression(identifier('state'), 'repeat_count'),
			numeric_literal(spec.value)
		)
	end
	if spec.neg then
		return unary_expression(syntax.unary_not, result)
	end
	return result
end

local append_condition<const> = function(condition, term)
	if condition == nil then
		return term
	end
	return binary_expression(syntax.binary_and, condition, term)
end

local action_condition<const> = function(node, bare_requires_pressed)
	local condition
	local specs<const> = node.mod_specs
	if #specs == 0 and bare_requires_pressed then
		condition = member_expression(identifier('state'), 'pressed')
	end
	for index = 1, #specs do
		condition = append_condition(condition, modifier_expression(specs[index]))
	end
	if not node.has_consume_mod then
		condition = append_condition(
			condition,
			unary_expression(
				syntax.unary_not,
				member_expression(identifier('state'), 'consumed')
			)
		)
	end
	return condition
end

local emit_action<const> = function(statements, state, node, target_name, bare_requires_pressed)
	state.uses_state = true
	statements[#statements + 1] = assignment_statement(
		identifier('state'),
		call_expression(identifier('get_state'), {
			identifier('context'),
			numeric_literal(node.action_index),
		})
	)
	statements[#statements + 1] = assignment_statement(
		identifier(target_name),
		action_condition(node, bare_requires_pressed)
	)
end

local emit_evaluation
local emit_edge_collection

local emit_edge_match<const> = function(statements, edge_spec, window)
	local match
	if edge_spec.state_field ~= nil then
		match = member_expression(identifier('state'), edge_spec.state_field)
	else
		match = binary_expression(
			syntax.binary_less,
			member_expression(identifier('state'), edge_spec.delta_field),
			window_expression(window)
		)
	end
	statements[#statements + 1] = assignment_statement(identifier('edge_any'), match)
	statements[#statements + 1] = assignment_statement(
		identifier('edge_all'),
		identifier('edge_any')
	)
end

local emit_edge_empty<const> = function(statements, matches)
	statements[#statements + 1] = assignment_statement(
		identifier('edge_ok'),
		boolean_literal(matches)
	)
	statements[#statements + 1] = assignment_statement(
		identifier('edge_eligible'),
		numeric_literal(0)
	)
	statements[#statements + 1] = assignment_statement(
		identifier('edge_any'),
		boolean_literal(false)
	)
	statements[#statements + 1] = assignment_statement(
		identifier('edge_all'),
		boolean_literal(true)
	)
end

local emit_edge_reset<const> = function(statements)
	statements[#statements + 1] = assignment_statement(
		identifier('edge_eligible'),
		numeric_literal(0)
	)
	statements[#statements + 1] = assignment_statement(
		identifier('edge_any'),
		boolean_literal(false)
	)
	statements[#statements + 1] = assignment_statement(
		identifier('edge_all'),
		boolean_literal(true)
	)
end

local emit_edge_and_continuation<const> = function(statements, state, node, window, edge_spec)
	local body<const> = {
		local_statement(
			identifier('left_eligible'),
			identifier('edge_eligible'),
			false
		),
		local_statement(identifier('left_any'), identifier('edge_any'), false),
		local_statement(identifier('left_all'), identifier('edge_all'), false),
	}
	emit_edge_collection(body, state, node, window, edge_spec)
	body[#body + 1] = if_statement({
		if_clause(
			identifier('edge_ok'),
			block({
				assignment_statement(
					identifier('edge_eligible'),
					binary_expression(
						syntax.binary_add,
						identifier('left_eligible'),
						identifier('edge_eligible')
					)
				),
				assignment_statement(
					identifier('edge_any'),
					binary_expression(
						syntax.binary_or,
						identifier('left_any'),
						identifier('edge_any')
					)
				),
				assignment_statement(
					identifier('edge_all'),
					binary_expression(
						syntax.binary_and,
						identifier('left_all'),
						identifier('edge_all')
					)
				),
			})
		),
	})
	statements[#statements + 1] = if_statement({
		if_clause(identifier('edge_ok'), block(body)),
	})
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
				if_clause(
					unary_expression(syntax.unary_not, identifier('edge_ok')),
					block(body)
				),
			})
		end
		return
	end
	emit_evaluation(statements, state, node, 'edge_ok', window)
	emit_edge_reset(statements)
end

emit_edge_collection = function(statements, state, node, window, edge_spec)
	local kind<const> = node.kind
	if kind == node_kind.action then
		emit_action(statements, state, node, 'edge_ok', false)
		emit_edge_reset(statements)
		if node.edge_mask & edge_spec.edge_bit ~= 0 then
			local body<const> = {
				assignment_statement(
					identifier('edge_eligible'),
					numeric_literal(1)
				),
			}
			emit_edge_match(body, edge_spec, window)
			statements[#statements + 1] = if_statement({
				if_clause(identifier('edge_ok'), block(body)),
			})
		end
	elseif kind == node_kind.logical_not then
		emit_evaluation(statements, state, node.left, 'edge_ok', window)
		statements[#statements + 1] = assignment_statement(
			identifier('edge_ok'),
			unary_expression(syntax.unary_not, identifier('edge_ok'))
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
			if_clause(
				unary_expression(syntax.unary_not, identifier('edge_ok')),
				block(body)
			),
		})
	else
		emit_edge_function(statements, state, node, window, edge_spec)
	end
end

local edge_result_expression<const> = function(edge_spec)
	if edge_spec.all then
		return binary_expression(
			syntax.binary_and,
			binary_expression(
				syntax.binary_and,
				identifier('edge_ok'),
				binary_expression(
					syntax.binary_greater,
					identifier('edge_eligible'),
					numeric_literal(0)
				)
			),
			identifier('edge_all')
		)
	end
	return binary_expression(syntax.binary_and, identifier('edge_ok'), identifier('edge_any'))
end

local emit_function_evaluation<const> = function(statements, state, node, target_name, inherited_window)
	local window = inherited_window
	if node.window ~= nil then
		window = node.window
	end
	local args<const> = node.args
	if node.function_kind == function_kind.all or node.function_kind == function_kind.any then
		local matches_all<const> = node.function_kind == function_kind.all
		if #args == 0 then
			statements[#statements + 1] = assignment_statement(
				identifier(target_name),
				boolean_literal(matches_all)
			)
			return
		end
		emit_evaluation(statements, state, args[1], target_name, window)
		for index = 2, #args do
			local body<const> = {}
			emit_evaluation(body, state, args[index], target_name, window)
			local condition
			if matches_all then
				condition = identifier(target_name)
			else
				condition = unary_expression(syntax.unary_not, identifier(target_name))
			end
			statements[#statements + 1] = if_statement({
				if_clause(condition, block(body)),
			})
		end
		return
	end
	state.uses_edge = true
	local edge_spec<const> = edge_function_spec[node.function_kind]
	if #args == 0 then
		statements[#statements + 1] = assignment_statement(
			identifier(target_name),
			boolean_literal(edge_spec.all)
		)
		return
	end
	emit_edge_collection(statements, state, args[1], window, edge_spec)
	statements[#statements + 1] = assignment_statement(
		identifier(target_name),
		edge_result_expression(edge_spec)
	)
	for index = 2, #args do
		local body<const> = {}
		emit_edge_collection(body, state, args[index], window, edge_spec)
		body[#body + 1] = assignment_statement(
			identifier(target_name),
			edge_result_expression(edge_spec)
		)
		local condition
		if edge_spec.all then
			condition = identifier(target_name)
		else
			condition = unary_expression(syntax.unary_not, identifier(target_name))
		end
		statements[#statements + 1] = if_statement({
			if_clause(condition, block(body)),
		})
	end
end

emit_evaluation = function(statements, state, node, target_name, window)
	local kind<const> = node.kind
	if kind == node_kind.action then
		emit_action(statements, state, node, target_name, true)
	elseif kind == node_kind.logical_not then
		emit_evaluation(statements, state, node.left, target_name, window)
		statements[#statements + 1] = assignment_statement(
			identifier(target_name),
			unary_expression(syntax.unary_not, identifier(target_name))
		)
	elseif kind == node_kind.logical_and then
		emit_evaluation(statements, state, node.left, target_name, window)
		local body<const> = {}
		emit_evaluation(body, state, node.right, target_name, window)
		statements[#statements + 1] = if_statement({
			if_clause(identifier(target_name), block(body)),
		})
	elseif kind == node_kind.logical_or then
		emit_evaluation(statements, state, node.left, target_name, window)
		local body<const> = {}
		emit_evaluation(body, state, node.right, target_name, window)
		statements[#statements + 1] = if_statement({
			if_clause(
				unary_expression(syntax.unary_not, identifier(target_name)),
				block(body)
			),
		})
	else
		emit_function_evaluation(statements, state, node, target_name, window)
	end
end

function action_program_source.build(ast)
	local state<const> = { uses_state = false, uses_edge = false }
	local evaluation_body<const> = {}
	emit_evaluation(evaluation_body, state, ast, 'result', nil)
	local evaluator_body<const> = {
		local_statement(identifier('result'), nil, false),
	}
	if state.uses_state then
		evaluator_body[#evaluator_body + 1] = local_statement(identifier('state'), nil, false)
	end
	if state.uses_edge then
		evaluator_body[#evaluator_body + 1] = local_statement(identifier('edge_ok'), nil, false)
		evaluator_body[#evaluator_body + 1] = local_statement(identifier('edge_eligible'), nil, false)
		evaluator_body[#evaluator_body + 1] = local_statement(identifier('edge_any'), nil, false)
		evaluator_body[#evaluator_body + 1] = local_statement(identifier('edge_all'), nil, false)
	end
	for index = 1, #evaluation_body do
		evaluator_body[#evaluator_body + 1] = evaluation_body[index]
	end
	evaluator_body[#evaluator_body + 1] = return_statement({ identifier('result') })
	return syntax_factory.chunk(block({
		return_statement({
			function_expression(
				{
					identifier('source_get_state'),
					identifier('source_states'),
					identifier('source_win'),
				},
				block({
					local_statement(
						identifier('get_state'),
						identifier('source_get_state'),
						true
					),
					local_statement(
						identifier('context'),
						identifier('source_states'),
						true
					),
					local_statement(
						identifier('win'),
						identifier('source_win'),
						true
					),
					return_statement({ function_expression({}, block(evaluator_body)) }),
				})
			),
		}),
	}))
end

return action_program_source
