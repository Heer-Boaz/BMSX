-- Admission-only lowering from the action expression tree to canonical
-- firmware syntax. Per-frame input evaluation executes the compiled closure.
local action_syntax<const> = require('cartlib/input/action_syntax')
local syntax_factory<const> = lua_compiler.syntax_factory

local action_program_syntax<const> = {}
local modifier_kind<const> = action_syntax.modifier_kind
local node_kind<const> = action_syntax.node_kind
local function_kind<const> = action_syntax.function_kind
local compare_operator<const> = action_syntax.compare_operator
local edge<const> = action_syntax.edge
local evaluation_requirement<const> = action_syntax.evaluation_requirement
local requirement_pressed<const> = evaluation_requirement.pressed
local requirement_just_pressed<const> = evaluation_requirement.just_pressed
local requirement_just_released<const> = evaluation_requirement.just_released
local requirement_all_just_pressed<const> = evaluation_requirement.all_just_pressed
local requirement_all_just_released<const> = evaluation_requirement.all_just_released
local requirement_consumed<const> = evaluation_requirement.consumed
local requirement_press_time<const> = evaluation_requirement.press_time
local requirement_press_delta<const> = evaluation_requirement.press_delta
local requirement_release_delta<const> = evaluation_requirement.release_delta
local requirement_guarded_just_pressed<const> = evaluation_requirement.guarded_just_pressed
local requirement_repeat_state<const> = evaluation_requirement.repeat_state
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local generated_symbol<const> = syntax_factory.generated_symbol
local reference<const> = syntax_factory.reference
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

-- Recursive lowering passes result targets by symbol identity. The diagnostic
-- spelling is never used to reconnect a nested expression to its accumulator.
local symbols<const> = {
	source_get_state = generated_symbol('source_get_state'),
	source_states = generated_symbol('source_states'),
	source_win = generated_symbol('source_win'),
	get_state = generated_symbol('get_state'),
	context = generated_symbol('context'),
	win = generated_symbol('win'),
	result = generated_symbol('result'),
	state = generated_symbol('state'),
	edge_ok = generated_symbol('edge_ok'),
	edge_eligible = generated_symbol('edge_eligible'),
	edge_any = generated_symbol('edge_any'),
	edge_all = generated_symbol('edge_all'),
	left_eligible = generated_symbol('left_eligible'),
	left_any = generated_symbol('left_any'),
	left_all = generated_symbol('left_all'),
}

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
		requirement = requirement_just_pressed,
	},
	[function_kind.all_just_pressed] = {
		all = true,
		edge_bit = edge.just_pressed,
		state_field = 'just_pressed',
		requirement = requirement_just_pressed,
	},
	[function_kind.any_just_released] = {
		all = false,
		edge_bit = edge.just_released,
		state_field = 'just_released',
		requirement = requirement_just_released,
	},
	[function_kind.all_just_released] = {
		all = true,
		edge_bit = edge.just_released,
		state_field = 'just_released',
		requirement = requirement_just_released,
	},
	[function_kind.any_guarded_just_pressed] = {
		all = false,
		edge_bit = edge.guarded_just_pressed,
		state_field = 'guarded_just_pressed',
		requirement = requirement_guarded_just_pressed,
	},
	[function_kind.all_guarded_just_pressed] = {
		all = true,
		edge_bit = edge.guarded_just_pressed,
		state_field = 'guarded_just_pressed',
		requirement = requirement_guarded_just_pressed,
	},
	[function_kind.any_repeat_pressed] = {
		all = false,
		edge_bit = edge.repeat_pressed,
		state_field = 'repeat_pressed',
		requirement = requirement_repeat_state,
	},
	[function_kind.all_repeat_pressed] = {
		all = true,
		edge_bit = edge.repeat_pressed,
		state_field = 'repeat_pressed',
		requirement = requirement_repeat_state,
	},
	[function_kind.any_within_press] = {
		all = false,
		edge_bit = edge.within_press,
		delta_field = 'min_press_delta',
		requirement = requirement_press_delta,
	},
	[function_kind.all_within_press] = {
		all = true,
		edge_bit = edge.within_press,
		delta_field = 'min_press_delta',
		requirement = requirement_press_delta,
	},
	[function_kind.any_within_release] = {
		all = false,
		edge_bit = edge.within_release,
		delta_field = 'min_release_delta',
		requirement = requirement_release_delta,
	},
	[function_kind.all_within_release] = {
		all = true,
		edge_bit = edge.within_release,
		delta_field = 'min_release_delta',
		requirement = requirement_release_delta,
	},
}

local modifier_requirement<const> = {
	[modifier_kind.pressed] = requirement_pressed,
	[modifier_kind.released] = requirement_pressed,
	[modifier_kind.just_pressed] = requirement_just_pressed,
	[modifier_kind.all_just_pressed] = requirement_all_just_pressed,
	[modifier_kind.just_released] = requirement_just_released,
	[modifier_kind.all_just_released] = requirement_all_just_released,
	[modifier_kind.guarded_just_pressed] = requirement_guarded_just_pressed,
	[modifier_kind.repeat_pressed] = requirement_repeat_state,
	[modifier_kind.consumed] = requirement_consumed,
	[modifier_kind.held] = requirement_press_time,
	[modifier_kind.within_press] = requirement_press_delta,
	[modifier_kind.within_release] = requirement_release_delta,
	[modifier_kind.press_time] = requirement_press_time,
	[modifier_kind.repeat_count] = requirement_repeat_state,
}

local add_action_requirement<const> = function(state, action_index, requirement)
	if requirement ~= nil then
		state.action_requirement_masks[action_index] = state.action_requirement_masks[action_index] | requirement
	end
end

local window_expression<const> = function(window)
	if window == nil then
		return reference(symbols.win)
	end
	return numeric_literal(window)
end

local modifier_expression<const> = function(spec)
	local state_field<const> = modifier_state_field[spec.kind]
	local result
	if state_field ~= nil then
		result = member_expression(reference(symbols.state), state_field)
	elseif spec.kind == modifier_kind.released then
		result = unary_expression(
			syntax.unary_not,
			member_expression(reference(symbols.state), 'pressed')
		)
	elseif spec.kind == modifier_kind.held then
		result = binary_expression(
			syntax.binary_greater_equal,
			member_expression(reference(symbols.state), 'press_time'),
			numeric_literal(1)
		)
	elseif spec.kind == modifier_kind.within_press then
		result = binary_expression(
			syntax.binary_less,
			member_expression(reference(symbols.state), 'min_press_delta'),
			numeric_literal(spec.window)
		)
	elseif spec.kind == modifier_kind.within_release then
		result = binary_expression(
			syntax.binary_less,
			member_expression(reference(symbols.state), 'min_release_delta'),
			numeric_literal(spec.window)
		)
	elseif spec.kind == modifier_kind.press_time then
		result = binary_expression(
			comparison_operator[spec.op],
			member_expression(reference(symbols.state), 'press_time'),
			numeric_literal(spec.value)
		)
	else
		result = binary_expression(
			comparison_operator[spec.op],
			member_expression(reference(symbols.state), 'repeat_count'),
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
		condition = member_expression(reference(symbols.state), 'pressed')
	end
	for index = 1, #specs do
		condition = append_condition(condition, modifier_expression(specs[index]))
	end
	if not node.has_consume_mod then
		condition = append_condition(
			condition,
			unary_expression(
				syntax.unary_not,
				member_expression(reference(symbols.state), 'consumed')
			)
		)
	end
	return condition
end

local emit_action<const> = function(statements, state, node, target_symbol, bare_requires_pressed)
	state.uses_state = true
	local specs<const> = node.mod_specs
	if #specs == 0 and bare_requires_pressed then
		add_action_requirement(state, node.action_index, requirement_pressed)
	end
	for index = 1, #specs do
		add_action_requirement(state, node.action_index, modifier_requirement[specs[index].kind])
	end
	if not node.has_consume_mod then
		add_action_requirement(state, node.action_index, requirement_consumed)
	end
	statements[#statements + 1] = assignment_statement(
		reference(symbols.state),
		call_expression(reference(symbols.get_state), {
			reference(symbols.context),
			numeric_literal(node.action_index),
		})
	)
	statements[#statements + 1] = assignment_statement(
		reference(target_symbol),
		action_condition(node, bare_requires_pressed)
	)
end

local emit_evaluation
local emit_edge_collection

local emit_edge_match<const> = function(statements, edge_spec, window)
	local match
	if edge_spec.state_field ~= nil then
		match = member_expression(reference(symbols.state), edge_spec.state_field)
	else
		match = binary_expression(
			syntax.binary_less,
			member_expression(reference(symbols.state), edge_spec.delta_field),
			window_expression(window)
		)
	end
	statements[#statements + 1] = assignment_statement(reference(symbols.edge_any), match)
	statements[#statements + 1] = assignment_statement(
		reference(symbols.edge_all),
		reference(symbols.edge_any)
	)
end

local emit_edge_empty<const> = function(statements, matches)
	statements[#statements + 1] = assignment_statement(
		reference(symbols.edge_ok),
		boolean_literal(matches)
	)
	statements[#statements + 1] = assignment_statement(
		reference(symbols.edge_eligible),
		numeric_literal(0)
	)
	statements[#statements + 1] = assignment_statement(
		reference(symbols.edge_any),
		boolean_literal(false)
	)
	statements[#statements + 1] = assignment_statement(
		reference(symbols.edge_all),
		boolean_literal(true)
	)
end

local emit_edge_reset<const> = function(statements)
	statements[#statements + 1] = assignment_statement(
		reference(symbols.edge_eligible),
		numeric_literal(0)
	)
	statements[#statements + 1] = assignment_statement(
		reference(symbols.edge_any),
		boolean_literal(false)
	)
	statements[#statements + 1] = assignment_statement(
		reference(symbols.edge_all),
		boolean_literal(true)
	)
end

local emit_edge_and_continuation<const> = function(statements, state, node, window, edge_spec)
	local body<const> = {
		local_statement(
			reference(symbols.left_eligible),
			reference(symbols.edge_eligible),
			false
		),
		local_statement(reference(symbols.left_any), reference(symbols.edge_any), false),
		local_statement(reference(symbols.left_all), reference(symbols.edge_all), false),
	}
	emit_edge_collection(body, state, node, window, edge_spec)
	body[#body + 1] = if_statement({
		if_clause(
			reference(symbols.edge_ok),
			block({
				assignment_statement(
					reference(symbols.edge_eligible),
					binary_expression(
						syntax.binary_add,
						reference(symbols.left_eligible),
						reference(symbols.edge_eligible)
					)
				),
				assignment_statement(
					reference(symbols.edge_any),
					binary_expression(
						syntax.binary_or,
						reference(symbols.left_any),
						reference(symbols.edge_any)
					)
				),
				assignment_statement(
					reference(symbols.edge_all),
					binary_expression(
						syntax.binary_and,
						reference(symbols.left_all),
						reference(symbols.edge_all)
					)
				),
			})
		),
	})
	statements[#statements + 1] = if_statement({
		if_clause(reference(symbols.edge_ok), block(body)),
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
					unary_expression(syntax.unary_not, reference(symbols.edge_ok)),
					block(body)
				),
			})
		end
		return
	end
	emit_evaluation(statements, state, node, symbols.edge_ok, window)
	emit_edge_reset(statements)
end

emit_edge_collection = function(statements, state, node, window, edge_spec)
	local kind<const> = node.kind
	if kind == node_kind.action then
		emit_action(statements, state, node, symbols.edge_ok, false)
		emit_edge_reset(statements)
		if node.edge_mask & edge_spec.edge_bit ~= 0 then
			add_action_requirement(state, node.action_index, edge_spec.requirement)
			local body<const> = {
				assignment_statement(
					reference(symbols.edge_eligible),
					numeric_literal(1)
				),
			}
			emit_edge_match(body, edge_spec, window)
			statements[#statements + 1] = if_statement({
				if_clause(reference(symbols.edge_ok), block(body)),
			})
		end
	elseif kind == node_kind.logical_not then
		emit_evaluation(statements, state, node.left, symbols.edge_ok, window)
		statements[#statements + 1] = assignment_statement(
			reference(symbols.edge_ok),
			unary_expression(syntax.unary_not, reference(symbols.edge_ok))
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
				unary_expression(syntax.unary_not, reference(symbols.edge_ok)),
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
				reference(symbols.edge_ok),
				binary_expression(
					syntax.binary_greater,
					reference(symbols.edge_eligible),
					numeric_literal(0)
				)
			),
			reference(symbols.edge_all)
		)
	end
	return binary_expression(syntax.binary_and, reference(symbols.edge_ok), reference(symbols.edge_any))
end

local emit_function_evaluation<const> = function(statements, state, node, target_symbol, inherited_window)
	local window = inherited_window
	if node.window ~= nil then
		window = node.window
	end
	local args<const> = node.args
	if node.function_kind == function_kind.all or node.function_kind == function_kind.any then
		local matches_all<const> = node.function_kind == function_kind.all
		if #args == 0 then
			statements[#statements + 1] = assignment_statement(
				reference(target_symbol),
				boolean_literal(matches_all)
			)
			return
		end
		emit_evaluation(statements, state, args[1], target_symbol, window)
		for index = 2, #args do
			local body<const> = {}
			emit_evaluation(body, state, args[index], target_symbol, window)
			local condition
			if matches_all then
				condition = reference(target_symbol)
			else
				condition = unary_expression(syntax.unary_not, reference(target_symbol))
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
			reference(target_symbol),
			boolean_literal(edge_spec.all)
		)
		return
	end
	emit_edge_collection(statements, state, args[1], window, edge_spec)
	statements[#statements + 1] = assignment_statement(
		reference(target_symbol),
		edge_result_expression(edge_spec)
	)
	for index = 2, #args do
		local body<const> = {}
		emit_edge_collection(body, state, args[index], window, edge_spec)
		body[#body + 1] = assignment_statement(
			reference(target_symbol),
			edge_result_expression(edge_spec)
		)
		local condition
		if edge_spec.all then
			condition = reference(target_symbol)
		else
			condition = unary_expression(syntax.unary_not, reference(target_symbol))
		end
		statements[#statements + 1] = if_statement({
			if_clause(condition, block(body)),
		})
	end
end

emit_evaluation = function(statements, state, node, target_symbol, window)
	local kind<const> = node.kind
	if kind == node_kind.action then
		emit_action(statements, state, node, target_symbol, true)
	elseif kind == node_kind.logical_not then
		emit_evaluation(statements, state, node.left, target_symbol, window)
		statements[#statements + 1] = assignment_statement(
			reference(target_symbol),
			unary_expression(syntax.unary_not, reference(target_symbol))
		)
	elseif kind == node_kind.logical_and then
		emit_evaluation(statements, state, node.left, target_symbol, window)
		local body<const> = {}
		emit_evaluation(body, state, node.right, target_symbol, window)
		statements[#statements + 1] = if_statement({
			if_clause(reference(target_symbol), block(body)),
		})
	elseif kind == node_kind.logical_or then
		emit_evaluation(statements, state, node.left, target_symbol, window)
		local body<const> = {}
		emit_evaluation(body, state, node.right, target_symbol, window)
		statements[#statements + 1] = if_statement({
			if_clause(
				unary_expression(syntax.unary_not, reference(target_symbol)),
				block(body)
			),
		})
	else
		emit_function_evaluation(statements, state, node, target_symbol, window)
	end
end

function action_program_syntax.build(ast, action_count)
	local action_requirement_masks<const> = {}
	for action_index = 1, action_count do
		action_requirement_masks[action_index] = 0
	end
	local state<const> = {
		uses_state = false,
		uses_edge = false,
		action_requirement_masks = action_requirement_masks,
	}
	local evaluation_body<const> = {}
	emit_evaluation(evaluation_body, state, ast, symbols.result, nil)
	local evaluator_body<const> = {
		local_statement(reference(symbols.result), nil, false),
	}
	if state.uses_state then
		evaluator_body[#evaluator_body + 1] = local_statement(reference(symbols.state), nil, false)
	end
	if state.uses_edge then
		evaluator_body[#evaluator_body + 1] = local_statement(reference(symbols.edge_ok), nil, false)
		evaluator_body[#evaluator_body + 1] = local_statement(reference(symbols.edge_eligible), nil, false)
		evaluator_body[#evaluator_body + 1] = local_statement(reference(symbols.edge_any), nil, false)
		evaluator_body[#evaluator_body + 1] = local_statement(reference(symbols.edge_all), nil, false)
	end
	for index = 1, #evaluation_body do
		evaluator_body[#evaluator_body + 1] = evaluation_body[index]
	end
	evaluator_body[#evaluator_body + 1] = return_statement({ reference(symbols.result) })
	local chunk<const> = syntax_factory.chunk(block({
		return_statement({
			function_expression(
				{
					reference(symbols.source_get_state),
					reference(symbols.source_states),
					reference(symbols.source_win),
				},
				block({
					local_statement(
						reference(symbols.get_state),
						reference(symbols.source_get_state),
						true
					),
					local_statement(
						reference(symbols.context),
						reference(symbols.source_states),
						true
					),
					local_statement(
						reference(symbols.win),
						reference(symbols.source_win),
						true
					),
					return_statement({ function_expression({}, block(evaluator_body)) }),
				})
			),
		}),
	}))
	return chunk, action_requirement_masks
end

return action_program_syntax
