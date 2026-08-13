-- Admission-only lowering from action-field requirements to one aggregation
-- runner. The emitted runner contains no per-field capability branches.
local action_syntax<const> = require('cartlib/input/action_syntax')
local syntax_factory<const> = lua_compiler.syntax_factory

local action_state_program_syntax<const> = {}
local requirement<const> = action_syntax.evaluation_requirement
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
local if_statement<const> = syntax_factory.if_statement
local numeric_for_statement<const> = syntax_factory.numeric_for_statement
local return_statement<const> = syntax_factory.return_statement
local no_edge_delta<const> = action_syntax.no_edge_delta
local direct_state_fields<const> = {
	'pressed',
	'just_pressed',
	'just_released',
	'all_just_pressed',
	'all_just_released',
	'consumed',
	'press_time',
	'press_id',
	'value_q16',
}

local requirement_enabled<const> = function(mask, flag)
	return mask & flag ~= 0
end

local build_shape<const> = function(mask)
	local guarded_just_pressed<const> = requirement_enabled(mask, requirement.guarded_just_pressed)
	local repeat_state<const> = requirement_enabled(mask, requirement.repeat_state)
	local shape<const> = {
		pressed = requirement_enabled(mask, requirement.pressed) or repeat_state,
		just_pressed = requirement_enabled(mask, requirement.just_pressed)
			or guarded_just_pressed
			or repeat_state,
		just_released = requirement_enabled(mask, requirement.just_released),
		all_just_pressed = requirement_enabled(mask, requirement.all_just_pressed),
		all_just_released = requirement_enabled(mask, requirement.all_just_released),
		consumed = requirement_enabled(mask, requirement.consumed),
		press_time = requirement_enabled(mask, requirement.press_time),
		press_id = guarded_just_pressed,
		value_q16 = requirement_enabled(mask, requirement.value_q16),
		vector_q16 = requirement_enabled(mask, requirement.vector_q16),
		press_delta = requirement_enabled(mask, requirement.press_delta),
		release_delta = requirement_enabled(mask, requirement.release_delta),
		guarded_just_pressed = guarded_just_pressed,
		repeat_state = repeat_state,
	}
	shape.button_pressed = shape.pressed
		or shape.press_time
		or shape.press_id
		or shape.press_delta
	shape.button_just_pressed = shape.just_pressed or shape.all_just_pressed
	shape.button_just_released = shape.just_released
		or shape.all_just_released
		or shape.release_delta
	return shape
end

local emit_accumulator_locals<const> = function(statements, shape)
	if shape.pressed then
		statements[#statements + 1] = local_statement(
			identifier('pressed'),
			boolean_literal(false),
			false
		)
	end
	if shape.just_pressed then
		statements[#statements + 1] = local_statement(
			identifier('just_pressed'),
			boolean_literal(false),
			false
		)
	end
	if shape.just_released then
		statements[#statements + 1] = local_statement(
			identifier('just_released'),
			boolean_literal(false),
			false
		)
	end
	if shape.all_just_pressed then
		statements[#statements + 1] = local_statement(
			identifier('all_just_pressed'),
			boolean_literal(false),
			false
		)
	end
	if shape.all_just_released then
		statements[#statements + 1] = local_statement(
			identifier('all_just_released'),
			boolean_literal(false),
			false
		)
	end
	if shape.consumed then
		statements[#statements + 1] = local_statement(
			identifier('consumed'),
			boolean_literal(false),
			false
		)
	end
	if shape.press_time then
		statements[#statements + 1] = local_statement(
			identifier('has_press_time'),
			boolean_literal(false),
			false
		)
		statements[#statements + 1] = local_statement(
			identifier('press_time'),
			numeric_literal(0),
			false
		)
	end
	if shape.press_id then
		statements[#statements + 1] = local_statement(
			identifier('press_id'),
			numeric_literal(0),
			false
		)
	end
	if shape.value_q16 then
		statements[#statements + 1] = local_statement(
			identifier('value_q16'),
			numeric_literal(0),
			false
		)
	end
	if shape.vector_q16 then
		statements[#statements + 1] = local_statement(
			identifier('value_x_q16'),
			numeric_literal(0),
			false
		)
		statements[#statements + 1] = local_statement(
			identifier('value_y_q16'),
			numeric_literal(0),
			false
		)
	end
	if shape.press_delta then
		statements[#statements + 1] = local_statement(
			identifier('min_press_delta'),
			numeric_literal(no_edge_delta),
			false
		)
	end
	if shape.release_delta then
		statements[#statements + 1] = local_statement(
			identifier('min_release_delta'),
			numeric_literal(no_edge_delta),
			false
		)
	end
end

local emit_button_captures<const> = function(statements, shape)
	statements[#statements + 1] = local_statement(
		identifier('button'),
		index_expression(identifier('list'), identifier('button_index')),
		true
	)
	if shape.button_pressed then
		statements[#statements + 1] = local_statement(
			identifier('button_pressed'),
			member_expression(identifier('button'), 'pressed'),
			true
		)
	end
	if shape.button_just_pressed then
		statements[#statements + 1] = local_statement(
			identifier('button_just_pressed'),
			member_expression(identifier('button'), 'just_pressed'),
			true
		)
	end
	if shape.button_just_released then
		statements[#statements + 1] = local_statement(
			identifier('button_just_released'),
			member_expression(identifier('button'), 'just_released'),
			true
		)
	end
end

local emit_boolean_aggregation<const> = function(statements, shape)
	if shape.pressed then
		statements[#statements + 1] = assignment_statement(
			identifier('pressed'),
			binary_expression(
				syntax.binary_or,
				identifier('pressed'),
				identifier('button_pressed')
			)
		)
	end
	if shape.just_pressed then
		statements[#statements + 1] = assignment_statement(
			identifier('just_pressed'),
			binary_expression(
				syntax.binary_or,
				identifier('just_pressed'),
				identifier('button_just_pressed')
			)
		)
	end
	if shape.just_released then
		statements[#statements + 1] = assignment_statement(
			identifier('just_released'),
			binary_expression(
				syntax.binary_or,
				identifier('just_released'),
				identifier('button_just_released')
			)
		)
	end
	if shape.all_just_pressed then
		statements[#statements + 1] = assignment_statement(
			identifier('source_all_just_pressed'),
			binary_expression(
				syntax.binary_and,
				identifier('source_all_just_pressed'),
				identifier('button_just_pressed')
			)
		)
	end
	if shape.all_just_released then
		statements[#statements + 1] = assignment_statement(
			identifier('source_all_just_released'),
			binary_expression(
				syntax.binary_and,
				identifier('source_all_just_released'),
				identifier('button_just_released')
			)
		)
	end
	if shape.consumed then
		statements[#statements + 1] = assignment_statement(
			identifier('consumed'),
			binary_expression(
				syntax.binary_or,
				identifier('consumed'),
				member_expression(identifier('button'), 'consumed')
			)
		)
	end
end

local emit_delta_aggregation<const> = function(statements, shape)
	if shape.press_delta then
		statements[#statements + 1] = local_statement(
			identifier('press_delta'),
			binary_expression(
				syntax.binary_subtract,
				identifier('frame'),
				member_expression(identifier('button'), 'last_press_frame')
			),
			false
		)
		statements[#statements + 1] = if_statement({
			if_clause(identifier('button_pressed'), block({
				assignment_statement(identifier('press_delta'), numeric_literal(-1)),
			})),
		})
		statements[#statements + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_less,
					identifier('press_delta'),
					identifier('min_press_delta')
				),
				block({
					assignment_statement(
						identifier('min_press_delta'),
						identifier('press_delta')
					),
				})
			),
		})
	end
	if shape.release_delta then
		statements[#statements + 1] = local_statement(
			identifier('release_delta'),
			binary_expression(
				syntax.binary_subtract,
				identifier('frame'),
				member_expression(identifier('button'), 'last_release_frame')
			),
			false
		)
		statements[#statements + 1] = if_statement({
			if_clause(identifier('button_just_released'), block({
				assignment_statement(identifier('release_delta'), numeric_literal(-1)),
			})),
		})
		statements[#statements + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_less,
					identifier('release_delta'),
					identifier('min_release_delta')
				),
				block({
					assignment_statement(
						identifier('min_release_delta'),
						identifier('release_delta')
					),
				})
			),
		})
	end
end

local emit_pressed_aggregation<const> = function(statements, shape)
	if not shape.press_time and not shape.press_id then
		return
	end
	local body<const> = {}
	if shape.press_time then
		body[#body + 1] = local_statement(
			identifier('button_press_time'),
			binary_expression(
				syntax.binary_subtract,
				identifier('frame'),
				member_expression(identifier('button'), 'press_start_frame')
			),
			true
		)
		body[#body + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_or,
					unary_expression(syntax.unary_not, identifier('has_press_time')),
					binary_expression(
						syntax.binary_less,
						identifier('button_press_time'),
						identifier('press_time')
					)
				),
				block({
					assignment_statement(identifier('has_press_time'), boolean_literal(true)),
					assignment_statement(identifier('press_time'), identifier('button_press_time')),
				})
			),
		})
	end
	if shape.press_id then
		body[#body + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_greater,
					member_expression(identifier('button'), 'press_id'),
					identifier('press_id')
				),
				block({
					assignment_statement(
						identifier('press_id'),
						member_expression(identifier('button'), 'press_id')
					),
				})
			),
		})
	end
	statements[#statements + 1] = if_statement({
		if_clause(identifier('button_pressed'), block(body)),
	})
end

local emit_value_aggregation<const> = function(statements, shape)
	if shape.value_q16 then
		statements[#statements + 1] = local_statement(
			identifier('button_value_q16'),
			member_expression(identifier('button'), 'value_q16'),
			true
		)
		statements[#statements + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_not_equal,
					identifier('button_value_q16'),
					numeric_literal(0)
				),
				block({
					assignment_statement(
						identifier('source_value_q16'),
						identifier('button_value_q16')
					),
				})
			),
		})
	end
	if shape.vector_q16 then
		statements[#statements + 1] = local_statement(
			identifier('button_value_x_q16'),
			member_expression(identifier('button'), 'value_x_q16'),
			true
		)
		statements[#statements + 1] = local_statement(
			identifier('button_value_y_q16'),
			member_expression(identifier('button'), 'value_y_q16'),
			true
		)
		statements[#statements + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_or,
					binary_expression(
						syntax.binary_not_equal,
						identifier('button_value_x_q16'),
						numeric_literal(0)
					),
					binary_expression(
						syntax.binary_not_equal,
						identifier('button_value_y_q16'),
						numeric_literal(0)
					)
				),
				block({
					assignment_statement(
						identifier('source_value_x_q16'),
						identifier('button_value_x_q16')
					),
					assignment_statement(
						identifier('source_value_y_q16'),
						identifier('button_value_y_q16')
					),
				})
			),
		})
	end
end

local emit_source_locals<const> = function(statements, shape)
	if shape.all_just_pressed then
		statements[#statements + 1] = local_statement(
			identifier('source_all_just_pressed'),
			boolean_literal(true),
			false
		)
	end
	if shape.all_just_released then
		statements[#statements + 1] = local_statement(
			identifier('source_all_just_released'),
			boolean_literal(true),
			false
		)
	end
	if shape.value_q16 then
		statements[#statements + 1] = local_statement(
			identifier('source_value_q16'),
			numeric_literal(0),
			false
		)
	end
	if shape.vector_q16 then
		statements[#statements + 1] = local_statement(
			identifier('source_value_x_q16'),
			numeric_literal(0),
			false
		)
		statements[#statements + 1] = local_statement(
			identifier('source_value_y_q16'),
			numeric_literal(0),
			false
		)
	end
end

local emit_source_fold<const> = function(statements, shape)
	if shape.all_just_pressed then
		statements[#statements + 1] = assignment_statement(
			identifier('all_just_pressed'),
			binary_expression(
				syntax.binary_or,
				identifier('all_just_pressed'),
				identifier('source_all_just_pressed')
			)
		)
	end
	if shape.all_just_released then
		statements[#statements + 1] = assignment_statement(
			identifier('all_just_released'),
			binary_expression(
				syntax.binary_or,
				identifier('all_just_released'),
				identifier('source_all_just_released')
			)
		)
	end
	if shape.value_q16 then
		statements[#statements + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_equal,
					identifier('value_q16'),
					numeric_literal(0)
				),
				block({
					assignment_statement(identifier('value_q16'), identifier('source_value_q16')),
				})
			),
		})
	end
	if shape.vector_q16 then
		statements[#statements + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_and,
					binary_expression(
						syntax.binary_equal,
						identifier('value_x_q16'),
						numeric_literal(0)
					),
					binary_expression(
						syntax.binary_equal,
						identifier('value_y_q16'),
						numeric_literal(0)
					)
				),
				block({
					assignment_statement(
						identifier('value_x_q16'),
						identifier('source_value_x_q16')
					),
					assignment_statement(
						identifier('value_y_q16'),
						identifier('source_value_y_q16')
					),
				})
			),
		})
	end
end

local emit_source_loop<const> = function(statements, shape)
	statements[#statements + 1] = local_statement(
		identifier('sources'),
		member_expression(identifier('state'), 'resolved_sources'),
		true
	)
	local source_body<const> = {
		local_statement(
			identifier('list'),
			index_expression(identifier('sources'), identifier('source_index')),
			true
		),
	}
	emit_source_locals(source_body, shape)
	local button_body<const> = {}
	emit_button_captures(button_body, shape)
	emit_boolean_aggregation(button_body, shape)
	emit_delta_aggregation(button_body, shape)
	emit_pressed_aggregation(button_body, shape)
	emit_value_aggregation(button_body, shape)
	source_body[#source_body + 1] = numeric_for_statement(
		identifier('button_index'),
		numeric_literal(1),
		unary_expression(syntax.unary_length, identifier('list')),
		nil,
		block(button_body)
	)
	emit_source_fold(source_body, shape)
	statements[#statements + 1] = numeric_for_statement(
		identifier('source_index'),
		numeric_literal(1),
		member_expression(identifier('state'), 'resolved_source_count'),
		nil,
		block(source_body)
	)
end

local emit_state_writes<const> = function(statements, shape)
	for index = 1, #direct_state_fields do
		local field<const> = direct_state_fields[index]
		if shape[field] then
			statements[#statements + 1] = assignment_statement(
				member_expression(identifier('state'), field),
				identifier(field)
			)
		end
	end
	if shape.press_delta then
		statements[#statements + 1] = assignment_statement(
			member_expression(identifier('state'), 'min_press_delta'),
			identifier('min_press_delta')
		)
	end
	if shape.release_delta then
		statements[#statements + 1] = assignment_statement(
			member_expression(identifier('state'), 'min_release_delta'),
			identifier('min_release_delta')
		)
	end
	if shape.vector_q16 then
		statements[#statements + 1] = assignment_statement(
			member_expression(identifier('state'), 'value_x_q16'),
			identifier('value_x_q16')
		)
		statements[#statements + 1] = assignment_statement(
			member_expression(identifier('state'), 'value_y_q16'),
			identifier('value_y_q16')
		)
	end
	if shape.guarded_just_pressed then
		statements[#statements + 1] = call_statement(call_expression(
			identifier('evaluate_guard'),
			{ identifier('state'), identifier('frame') }
		))
	end
	if shape.repeat_state then
		statements[#statements + 1] = call_statement(call_expression(
			identifier('evaluate_repeat'),
			{ identifier('state'), identifier('frame') }
		))
	end
	statements[#statements + 1] = assignment_statement(
		member_expression(identifier('state'), 'eval_frame'),
		identifier('frame')
	)
	statements[#statements + 1] = assignment_statement(
		member_expression(identifier('state'), 'eval_gen'),
		identifier('eval_gen')
	)
end

function action_state_program_syntax.build(requirement_mask)
	local shape<const> = build_shape(requirement_mask)
	local body<const> = {}
	emit_accumulator_locals(body, shape)
	emit_source_loop(body, shape)
	emit_state_writes(body, shape)
	return syntax_factory.chunk(block({
		return_statement({
			function_expression(
				{ identifier('state'), identifier('frame'), identifier('eval_gen') },
				block(body)
			),
		}),
	}))
end

return action_state_program_syntax
