-- Admission-only lowering from action-field requirements to one aggregation
-- runner. The emitted runner contains no per-field capability branches.
local action_syntax<const> = require('cartlib/input/action_syntax')
local syntax_factory<const> = lua_compiler.syntax_factory

local action_state_program_syntax<const> = {}
local requirement<const> = action_syntax.evaluation_requirement
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
local if_statement<const> = syntax_factory.if_statement
local numeric_for_statement<const> = syntax_factory.numeric_for_statement
local return_statement<const> = syntax_factory.return_statement
local no_edge_delta<const> = action_syntax.no_edge_delta

local symbols<const> = {
	state = generated_symbol('state'),
	frame = generated_symbol('frame'),
	previous_edge_id = generated_symbol('previous_edge_id'),
	evaluation_serial = generated_symbol('evaluation_serial'),
	pressed = generated_symbol('pressed'),
	just_pressed = generated_symbol('just_pressed'),
	just_released = generated_symbol('just_released'),
	all_just_pressed = generated_symbol('all_just_pressed'),
	all_just_released = generated_symbol('all_just_released'),
	consumed = generated_symbol('consumed'),
	has_press_time = generated_symbol('has_press_time'),
	press_time = generated_symbol('press_time'),
	press_id = generated_symbol('press_id'),
	value_q16 = generated_symbol('value_q16'),
	value_x_q16 = generated_symbol('value_x_q16'),
	value_y_q16 = generated_symbol('value_y_q16'),
	min_press_delta = generated_symbol('min_press_delta'),
	min_release_delta = generated_symbol('min_release_delta'),
	sources = generated_symbol('sources'),
	source_index = generated_symbol('source_index'),
	list = generated_symbol('list'),
	source_all_just_pressed = generated_symbol('source_all_just_pressed'),
	source_all_just_released = generated_symbol('source_all_just_released'),
	source_value_q16 = generated_symbol('source_value_q16'),
	source_value_x_q16 = generated_symbol('source_value_x_q16'),
	source_value_y_q16 = generated_symbol('source_value_y_q16'),
	button_index = generated_symbol('button_index'),
	button = generated_symbol('button'),
	button_pressed = generated_symbol('button_pressed'),
	button_press_edge_id = generated_symbol('button_press_edge_id'),
	button_release_edge_id = generated_symbol('button_release_edge_id'),
	button_just_pressed = generated_symbol('button_just_pressed'),
	button_just_released = generated_symbol('button_just_released'),
	button_consumed = generated_symbol('button_consumed'),
	press_delta = generated_symbol('press_delta'),
	release_delta = generated_symbol('release_delta'),
	button_press_time = generated_symbol('button_press_time'),
	button_value_q16 = generated_symbol('button_value_q16'),
	button_value_x_q16 = generated_symbol('button_value_x_q16'),
	button_value_y_q16 = generated_symbol('button_value_y_q16'),
}

-- Runtime fields keep their table keys; accumulator references retain their
-- independently owned lexical symbols.
local direct_state_fields<const> = {
	{ key = 'pressed', symbol = symbols.pressed },
	{ key = 'just_pressed', symbol = symbols.just_pressed },
	{ key = 'just_released', symbol = symbols.just_released },
	{ key = 'all_just_pressed', symbol = symbols.all_just_pressed },
	{ key = 'all_just_released', symbol = symbols.all_just_released },
	{ key = 'consumed', symbol = symbols.consumed },
	{ key = 'press_time', symbol = symbols.press_time },
	{ key = 'press_id', symbol = symbols.press_id },
	{ key = 'value_q16', symbol = symbols.value_q16 },
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
		or shape.press_delta
		or shape.consumed
	shape.button_just_pressed = shape.just_pressed
		or shape.all_just_pressed
		or shape.press_id
		or shape.consumed
	shape.button_just_released = shape.just_released
		or shape.all_just_released
		or shape.release_delta
		or shape.consumed
	return shape
end

local emit_accumulator_locals<const> = function(statements, shape)
	if shape.pressed then
		statements[#statements + 1] = local_statement(
			reference(symbols.pressed),
			boolean_literal(false),
			false
		)
	end
	if shape.just_pressed then
		statements[#statements + 1] = local_statement(
			reference(symbols.just_pressed),
			boolean_literal(false),
			false
		)
	end
	if shape.just_released then
		statements[#statements + 1] = local_statement(
			reference(symbols.just_released),
			boolean_literal(false),
			false
		)
	end
	if shape.all_just_pressed then
		statements[#statements + 1] = local_statement(
			reference(symbols.all_just_pressed),
			boolean_literal(false),
			false
		)
	end
	if shape.all_just_released then
		statements[#statements + 1] = local_statement(
			reference(symbols.all_just_released),
			boolean_literal(false),
			false
		)
	end
	if shape.consumed then
		statements[#statements + 1] = local_statement(
			reference(symbols.consumed),
			boolean_literal(false),
			false
		)
	end
	if shape.press_time then
		statements[#statements + 1] = local_statement(
			reference(symbols.has_press_time),
			boolean_literal(false),
			false
		)
		statements[#statements + 1] = local_statement(
			reference(symbols.press_time),
			numeric_literal(0),
			false
		)
	end
	if shape.press_id then
		statements[#statements + 1] = local_statement(
			reference(symbols.press_id),
			numeric_literal(0),
			false
		)
	end
	if shape.value_q16 then
		statements[#statements + 1] = local_statement(
			reference(symbols.value_q16),
			numeric_literal(0),
			false
		)
	end
	if shape.vector_q16 then
		statements[#statements + 1] = local_statement(
			reference(symbols.value_x_q16),
			numeric_literal(0),
			false
		)
		statements[#statements + 1] = local_statement(
			reference(symbols.value_y_q16),
			numeric_literal(0),
			false
		)
	end
	if shape.press_delta then
		statements[#statements + 1] = local_statement(
			reference(symbols.min_press_delta),
			numeric_literal(no_edge_delta),
			false
		)
	end
	if shape.release_delta then
		statements[#statements + 1] = local_statement(
			reference(symbols.min_release_delta),
			numeric_literal(no_edge_delta),
			false
		)
	end
end

local emit_button_captures<const> = function(statements, shape)
	statements[#statements + 1] = local_statement(
		reference(symbols.button),
		index_expression(reference(symbols.list), reference(symbols.button_index)),
		true
	)
	if shape.button_pressed then
		statements[#statements + 1] = local_statement(
			reference(symbols.button_pressed),
			member_expression(reference(symbols.button), 'pressed'),
			true
		)
	end
	if shape.button_just_pressed then
		statements[#statements + 1] = local_statement(
			reference(symbols.button_press_edge_id),
			member_expression(reference(symbols.button), 'press_edge_id'),
			true
		)
		statements[#statements + 1] = local_statement(
			reference(symbols.button_just_pressed),
			binary_expression(
				syntax.binary_greater,
				reference(symbols.button_press_edge_id),
				reference(symbols.previous_edge_id)
			),
			true
		)
	end
	if shape.button_just_released then
		statements[#statements + 1] = local_statement(
			reference(symbols.button_release_edge_id),
			member_expression(reference(symbols.button), 'release_edge_id'),
			true
		)
		statements[#statements + 1] = local_statement(
			reference(symbols.button_just_released),
			binary_expression(
				syntax.binary_greater,
				reference(symbols.button_release_edge_id),
				reference(symbols.previous_edge_id)
			),
			true
		)
	end
	if shape.consumed then
		statements[#statements + 1] = local_statement(
			reference(symbols.button_consumed),
			binary_expression(
				syntax.binary_and,
				binary_expression(
					syntax.binary_equal,
					member_expression(reference(symbols.button), 'consumed_press_id'),
					reference(symbols.button_press_edge_id)
				),
				binary_expression(
					syntax.binary_or,
					reference(symbols.button_pressed),
					binary_expression(
						syntax.binary_or,
						reference(symbols.button_just_pressed),
						reference(symbols.button_just_released)
					)
				)
			),
			true
		)
	end
end

local emit_boolean_aggregation<const> = function(statements, shape)
	if shape.pressed then
		statements[#statements + 1] = assignment_statement(
			reference(symbols.pressed),
			binary_expression(
				syntax.binary_or,
				reference(symbols.pressed),
				reference(symbols.button_pressed)
			)
		)
	end
	if shape.just_pressed then
		statements[#statements + 1] = assignment_statement(
			reference(symbols.just_pressed),
			binary_expression(
				syntax.binary_or,
				reference(symbols.just_pressed),
				reference(symbols.button_just_pressed)
			)
		)
	end
	if shape.just_released then
		statements[#statements + 1] = assignment_statement(
			reference(symbols.just_released),
			binary_expression(
				syntax.binary_or,
				reference(symbols.just_released),
				reference(symbols.button_just_released)
			)
		)
	end
	if shape.all_just_pressed then
		statements[#statements + 1] = assignment_statement(
			reference(symbols.source_all_just_pressed),
			binary_expression(
				syntax.binary_and,
				reference(symbols.source_all_just_pressed),
				reference(symbols.button_just_pressed)
			)
		)
	end
	if shape.all_just_released then
		statements[#statements + 1] = assignment_statement(
			reference(symbols.source_all_just_released),
			binary_expression(
				syntax.binary_and,
				reference(symbols.source_all_just_released),
				reference(symbols.button_just_released)
			)
		)
	end
	if shape.consumed then
		statements[#statements + 1] = assignment_statement(
			reference(symbols.consumed),
			binary_expression(
				syntax.binary_or,
				reference(symbols.consumed),
				reference(symbols.button_consumed)
			)
		)
	end
end

local emit_delta_aggregation<const> = function(statements, shape)
	if shape.press_delta then
		statements[#statements + 1] = local_statement(
			reference(symbols.press_delta),
			binary_expression(
				syntax.binary_subtract,
				reference(symbols.frame),
				member_expression(reference(symbols.button), 'last_press_frame')
			),
			false
		)
		statements[#statements + 1] = if_statement({
			if_clause(reference(symbols.button_pressed), block({
				assignment_statement(reference(symbols.press_delta), numeric_literal(-1)),
			})),
		})
		statements[#statements + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_less,
					reference(symbols.press_delta),
					reference(symbols.min_press_delta)
				),
				block({
					assignment_statement(
						reference(symbols.min_press_delta),
						reference(symbols.press_delta)
					),
				})
			),
		})
	end
	if shape.release_delta then
		statements[#statements + 1] = local_statement(
			reference(symbols.release_delta),
			binary_expression(
				syntax.binary_subtract,
				reference(symbols.frame),
				member_expression(reference(symbols.button), 'last_release_frame')
			),
			false
		)
		statements[#statements + 1] = if_statement({
			if_clause(reference(symbols.button_just_released), block({
				assignment_statement(reference(symbols.release_delta), numeric_literal(-1)),
			})),
		})
		statements[#statements + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_less,
					reference(symbols.release_delta),
					reference(symbols.min_release_delta)
				),
				block({
					assignment_statement(
						reference(symbols.min_release_delta),
						reference(symbols.release_delta)
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
	if shape.press_time then
		local body<const> = {}
		body[#body + 1] = local_statement(
			reference(symbols.button_press_time),
			binary_expression(
				syntax.binary_subtract,
				reference(symbols.frame),
				member_expression(reference(symbols.button), 'press_start_frame')
			),
			true
		)
		body[#body + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_or,
					unary_expression(syntax.unary_not, reference(symbols.has_press_time)),
					binary_expression(
						syntax.binary_less,
						reference(symbols.button_press_time),
						reference(symbols.press_time)
					)
				),
				block({
					assignment_statement(reference(symbols.has_press_time), boolean_literal(true)),
					assignment_statement(reference(symbols.press_time), reference(symbols.button_press_time)),
				})
			),
		})
		statements[#statements + 1] = if_statement({
			if_clause(reference(symbols.button_pressed), block(body)),
		})
	end
	if shape.press_id then
		statements[#statements + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_and,
					reference(symbols.button_just_pressed),
					binary_expression(
						syntax.binary_greater,
						reference(symbols.button_press_edge_id),
						reference(symbols.press_id)
					)
				),
				block({
					assignment_statement(
						reference(symbols.press_id),
						reference(symbols.button_press_edge_id)
					),
				})
			),
		})
	end
end

local emit_value_aggregation<const> = function(statements, shape)
	if shape.value_q16 then
		statements[#statements + 1] = local_statement(
			reference(symbols.button_value_q16),
			member_expression(reference(symbols.button), 'value_q16'),
			true
		)
		statements[#statements + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_not_equal,
					reference(symbols.button_value_q16),
					numeric_literal(0)
				),
				block({
					assignment_statement(
						reference(symbols.source_value_q16),
						reference(symbols.button_value_q16)
					),
				})
			),
		})
	end
	if shape.vector_q16 then
		statements[#statements + 1] = local_statement(
			reference(symbols.button_value_x_q16),
			member_expression(reference(symbols.button), 'value_x_q16'),
			true
		)
		statements[#statements + 1] = local_statement(
			reference(symbols.button_value_y_q16),
			member_expression(reference(symbols.button), 'value_y_q16'),
			true
		)
		statements[#statements + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_or,
					binary_expression(
						syntax.binary_not_equal,
						reference(symbols.button_value_x_q16),
						numeric_literal(0)
					),
					binary_expression(
						syntax.binary_not_equal,
						reference(symbols.button_value_y_q16),
						numeric_literal(0)
					)
				),
				block({
					assignment_statement(
						reference(symbols.source_value_x_q16),
						reference(symbols.button_value_x_q16)
					),
					assignment_statement(
						reference(symbols.source_value_y_q16),
						reference(symbols.button_value_y_q16)
					),
				})
			),
		})
	end
end

local emit_source_locals<const> = function(statements, shape)
	if shape.all_just_pressed then
		statements[#statements + 1] = local_statement(
			reference(symbols.source_all_just_pressed),
			boolean_literal(true),
			false
		)
	end
	if shape.all_just_released then
		statements[#statements + 1] = local_statement(
			reference(symbols.source_all_just_released),
			boolean_literal(true),
			false
		)
	end
	if shape.value_q16 then
		statements[#statements + 1] = local_statement(
			reference(symbols.source_value_q16),
			numeric_literal(0),
			false
		)
	end
	if shape.vector_q16 then
		statements[#statements + 1] = local_statement(
			reference(symbols.source_value_x_q16),
			numeric_literal(0),
			false
		)
		statements[#statements + 1] = local_statement(
			reference(symbols.source_value_y_q16),
			numeric_literal(0),
			false
		)
	end
end

local emit_source_fold<const> = function(statements, shape)
	if shape.all_just_pressed then
		statements[#statements + 1] = assignment_statement(
			reference(symbols.all_just_pressed),
			binary_expression(
				syntax.binary_or,
				reference(symbols.all_just_pressed),
				reference(symbols.source_all_just_pressed)
			)
		)
	end
	if shape.all_just_released then
		statements[#statements + 1] = assignment_statement(
			reference(symbols.all_just_released),
			binary_expression(
				syntax.binary_or,
				reference(symbols.all_just_released),
				reference(symbols.source_all_just_released)
			)
		)
	end
	if shape.value_q16 then
		statements[#statements + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_equal,
					reference(symbols.value_q16),
					numeric_literal(0)
				),
				block({
					assignment_statement(reference(symbols.value_q16), reference(symbols.source_value_q16)),
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
						reference(symbols.value_x_q16),
						numeric_literal(0)
					),
					binary_expression(
						syntax.binary_equal,
						reference(symbols.value_y_q16),
						numeric_literal(0)
					)
				),
				block({
					assignment_statement(
						reference(symbols.value_x_q16),
						reference(symbols.source_value_x_q16)
					),
					assignment_statement(
						reference(symbols.value_y_q16),
						reference(symbols.source_value_y_q16)
					),
				})
			),
		})
	end
end

local emit_source_loop<const> = function(statements, shape)
	statements[#statements + 1] = local_statement(
		reference(symbols.sources),
		member_expression(reference(symbols.state), 'resolved_sources'),
		true
	)
	local source_body<const> = {
		local_statement(
			reference(symbols.list),
			index_expression(reference(symbols.sources), reference(symbols.source_index)),
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
		reference(symbols.button_index),
		numeric_literal(1),
		unary_expression(syntax.unary_length, reference(symbols.list)),
		nil,
		block(button_body)
	)
	emit_source_fold(source_body, shape)
	statements[#statements + 1] = numeric_for_statement(
		reference(symbols.source_index),
		numeric_literal(1),
		member_expression(reference(symbols.state), 'resolved_source_count'),
		nil,
		block(source_body)
	)
end

local emit_state_writes<const> = function(statements, shape)
	for index = 1, #direct_state_fields do
		local field<const> = direct_state_fields[index]
		if shape[field.key] then
			statements[#statements + 1] = assignment_statement(
				member_expression(reference(symbols.state), field.key),
				reference(field.symbol)
			)
		end
	end
	if shape.press_delta then
		statements[#statements + 1] = assignment_statement(
			member_expression(reference(symbols.state), 'min_press_delta'),
			reference(symbols.min_press_delta)
		)
	end
	if shape.release_delta then
		statements[#statements + 1] = assignment_statement(
			member_expression(reference(symbols.state), 'min_release_delta'),
			reference(symbols.min_release_delta)
		)
	end
	if shape.vector_q16 then
		statements[#statements + 1] = assignment_statement(
			member_expression(reference(symbols.state), 'value_x_q16'),
			reference(symbols.value_x_q16)
		)
		statements[#statements + 1] = assignment_statement(
			member_expression(reference(symbols.state), 'value_y_q16'),
			reference(symbols.value_y_q16)
		)
	end
	if shape.guarded_just_pressed then
		statements[#statements + 1] = call_statement(call_expression(
			identifier('evaluate_guard'),
			{ reference(symbols.state), reference(symbols.frame) }
		))
	end
	if shape.repeat_state then
		statements[#statements + 1] = call_statement(call_expression(
			identifier('evaluate_repeat'),
			{ reference(symbols.state), reference(symbols.frame) }
		))
	end
	statements[#statements + 1] = assignment_statement(
		member_expression(reference(symbols.state), 'evaluation_serial'),
		reference(symbols.evaluation_serial)
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
				{
					reference(symbols.state),
					reference(symbols.frame),
					reference(symbols.previous_edge_id),
					reference(symbols.evaluation_serial),
				},
				block(body)
			),
		}),
	}))
end

return action_state_program_syntax
