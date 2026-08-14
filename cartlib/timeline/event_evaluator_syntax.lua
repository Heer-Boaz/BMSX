-- Event tracks are lowered into the owning method evaluator. Direction and
-- frame/time lane presence are definition facts, so absent lanes contribute no
-- lookup, count check, helper call or intermediate closure during evaluation.
local syntax_factory<const> = lua_compiler.syntax_factory
local event_lane_shape<const> = require('cartlib/timeline/event_lane_shape')

local event_evaluator_syntax<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local numeric_literal<const> = syntax_factory.number_literal
local boolean_literal<const> = syntax_factory.boolean_literal
local nil_literal<const> = syntax_factory.nil_literal
local member_expression<const> = syntax_factory.member_expression
local index_expression<const> = syntax_factory.index_expression
local call_expression<const> = syntax_factory.call_expression
local binary_expression<const> = syntax_factory.binary_expression
local unary_expression<const> = syntax_factory.unary_expression
local local_statement<const> = syntax_factory.local_statement
local call_statement<const> = syntax_factory.call_statement
local if_clause<const> = syntax_factory.if_clause
local else_clause<const> = syntax_factory.else_clause
local if_statement<const> = syntax_factory.if_statement
local numeric_for_statement<const> = syntax_factory.numeric_for_statement
local generated_symbol<const> = syntax_factory.generated_symbol
local reference<const> = syntax_factory.reference
local include_previous_never<const> = 0
local include_previous_always<const> = 1
local include_previous_initial<const> = 2

-- Factory captures and evaluator bodies share generated-symbol identity. The
-- spelling is diagnostic metadata; it is not the binding contract.
local new_method_symbols<const> = function()
	return {
		lanes = generated_symbol('event_lanes'),
		forward = {
			lane = generated_symbol('event_lane'),
			time_key = generated_symbol('event_time_key'),
			time_ms = generated_symbol('event_time_ms'),
		},
		backward = {
			lane = generated_symbol('event_lane'),
			time_key = generated_symbol('event_time_key'),
			time_ms = generated_symbol('event_time_ms'),
		},
	}
end

local symbols<const> = {
	play = new_method_symbols(),
	jump = new_method_symbols(),
	scrub = new_method_symbols(),
}

local intersects<const> = function(shape, mask)
	return shape & mask ~= 0
end

local flag_set_expression<const> = function(flag)
	return binary_expression(
		syntax.binary_not_equal,
		binary_expression(
			syntax.binary_bitwise_and,
			identifier('flags'),
			numeric_literal(flag)
		),
		numeric_literal(0)
	)
end

local event_range_statement<const> = function(
	lane_symbols,
	previous,
	current,
	direction,
	include_previous
)
	return call_statement(call_expression(identifier('emit_event_range'), {
		reference(lane_symbols.lane),
		identifier('owner'),
		previous,
		current,
		direction,
		include_previous,
	}))
end

-- A nil time operand denotes the timeline origin. Every call creates owned AST
-- occurrences because semantic binding annotates generated syntax in place.
local time_operand<const> = function(name)
	if name == nil then
		return numeric_literal(0)
	end
	return identifier(name)
end

local include_previous_expression<const> = function(mode, initial_flag)
	if mode == include_previous_never then
		return boolean_literal(false)
	end
	if mode == include_previous_always then
		return boolean_literal(true)
	end
	return flag_set_expression(initial_flag)
end

local singleton_time_intersection<const> = function(
	lane_symbols,
	previous_name,
	current_name,
	forward,
	include_previous,
	initial_flag
)
	local previous_operator = forward and syntax.binary_less or syntax.binary_greater
	if include_previous == include_previous_always then
		previous_operator = forward and syntax.binary_less_equal or syntax.binary_greater_equal
	end
	local previous_intersects = binary_expression(
		previous_operator,
		time_operand(previous_name),
		reference(lane_symbols.time_ms)
	)
	if include_previous == include_previous_initial then
		previous_intersects = binary_expression(
			syntax.binary_or,
			previous_intersects,
			binary_expression(
				syntax.binary_and,
				binary_expression(
					syntax.binary_equal,
					time_operand(previous_name),
					reference(lane_symbols.time_ms)
				),
				flag_set_expression(initial_flag)
			)
		)
	end
	return binary_expression(
		syntax.binary_and,
		binary_expression(
			forward and syntax.binary_greater_equal or syntax.binary_less_equal,
			time_operand(current_name),
			reference(lane_symbols.time_ms)
		),
		previous_intersects
	)
end

local time_event_range_statement<const> = function(
	lane_symbols,
	previous_name,
	current_name,
	forward,
	dynamic_direction,
	include_previous,
	initial_flag,
	singleton
)
	local direction_expression
	if dynamic_direction then
		direction_expression = identifier('direction')
	else
		direction_expression = numeric_literal(forward and 1 or -1)
	end
	if not singleton then
		return call_statement(call_expression(identifier('emit_time_event_range'), {
			reference(lane_symbols.lane),
			identifier('owner'),
			time_operand(previous_name),
			time_operand(current_name),
			direction_expression,
			include_previous_expression(include_previous, initial_flag),
		}))
	end
	local intersection<const> = singleton_time_intersection(
		lane_symbols,
		previous_name,
		current_name,
		forward,
		include_previous,
		initial_flag
	)
	local condition = intersection
	if dynamic_direction and not forward then
		condition = binary_expression(
			syntax.binary_and,
			binary_expression(
				syntax.binary_less,
				identifier('direction'),
				numeric_literal(0)
			),
			intersection
		)
	end
	return if_statement({
		if_clause(
			condition,
			block({
				call_statement(call_expression(
					member_expression(identifier('owner'), 'events'),
					{
						member_expression(reference(lane_symbols.time_key), 'event'),
						member_expression(reference(lane_symbols.time_key), 'payload'),
					},
					'emit'
				)),
			})
		),
	})
end

local event_dispatch_loop<const> = function(lane_symbols, reverse)
	local start_expression<const> = reverse
		and unary_expression(syntax.unary_length, identifier('bucket'))
		or numeric_literal(1)
	local limit_expression<const> = reverse
		and numeric_literal(1)
		or unary_expression(syntax.unary_length, identifier('bucket'))
	local step_expression = nil
	if reverse then
		step_expression = numeric_literal(-1)
	end
	return {
		local_statement(
			identifier('bucket'),
			index_expression(
				member_expression(reference(lane_symbols.lane), 'by_frame'),
				identifier('frame')
			),
			true
		),
		if_statement({
			if_clause(
				binary_expression(
					syntax.binary_not_equal,
					identifier('bucket'),
					nil_literal()
				),
				block({
					local_statement(
						identifier('event_port'),
						member_expression(identifier('owner'), 'events'),
						true
					),
					local_statement(
						identifier('emit'),
						member_expression(identifier('event_port'), 'emit'),
						true
					),
					numeric_for_statement(
						identifier('event_index'),
						start_expression,
						limit_expression,
						step_expression,
						block({
							local_statement(
								identifier('event_key'),
								index_expression(
									identifier('bucket'),
									identifier('event_index')
								),
								true
							),
							call_statement(call_expression(identifier('emit'), {
								identifier('event_port'),
								member_expression(identifier('event_key'), 'event'),
								member_expression(identifier('event_key'), 'payload'),
							})),
						})
					),
				})
			),
		}),
	}
end

local frame_direction_statements<const> = function(
	lane_symbols,
	forward,
	wrapped_flag,
	initial_flag
)
	local wrapped_ranges
	local adjacent_condition
	if forward then
		wrapped_ranges = {
			event_range_statement(
				lane_symbols,
				identifier('previous_frame'),
				identifier('event_last_frame'),
				numeric_literal(1),
				flag_set_expression(initial_flag)
			),
			event_range_statement(
				lane_symbols,
				numeric_literal(0),
				identifier('frame'),
				numeric_literal(1),
				boolean_literal(true)
			),
		}
		adjacent_condition = binary_expression(
			syntax.binary_equal,
			identifier('frame'),
			binary_expression(
				syntax.binary_add,
				identifier('previous_frame'),
				numeric_literal(1)
			)
		)
	else
		wrapped_ranges = {
			event_range_statement(
				lane_symbols,
				identifier('previous_frame'),
				numeric_literal(0),
				numeric_literal(-1),
				flag_set_expression(initial_flag)
			),
			event_range_statement(
				lane_symbols,
				identifier('event_last_frame'),
				identifier('frame'),
				numeric_literal(-1),
				boolean_literal(true)
			),
		}
		adjacent_condition = binary_expression(
			syntax.binary_and,
			binary_expression(
				syntax.binary_less,
				identifier('direction'),
				numeric_literal(0)
			),
			binary_expression(
				syntax.binary_equal,
				identifier('frame'),
				binary_expression(
					syntax.binary_subtract,
					identifier('previous_frame'),
					numeric_literal(1)
				)
			)
		)
	end
	return {
		if_statement({
			if_clause(flag_set_expression(wrapped_flag), block(wrapped_ranges)),
			if_clause(
				flag_set_expression(initial_flag),
				block({
					event_range_statement(
						lane_symbols,
						identifier('previous_frame'),
						identifier('frame'),
						identifier('direction'),
						boolean_literal(true)
					),
				})
			),
			if_clause(
				binary_expression(
					syntax.binary_not_equal,
					identifier('previous_frame'),
					identifier('frame')
				),
				block({
					if_statement({
						if_clause(
							adjacent_condition,
							block(event_dispatch_loop(lane_symbols, not forward))
						),
						else_clause(block({
							event_range_statement(
								lane_symbols,
								identifier('previous_frame'),
								identifier('frame'),
								identifier('direction'),
								boolean_literal(false)
							),
						})),
					}),
				})
			),
		}),
	}
end

local time_direction_statements<const> = function(
	lane_symbols,
	forward,
	wrapped_flag,
	initial_flag,
	singleton
)
	local wrapped_ranges
	if forward then
		wrapped_ranges = {
			time_event_range_statement(
				lane_symbols,
				'previous_time_ms',
				'event_duration_ms',
				true,
				false,
				include_previous_initial,
				initial_flag,
				singleton
			),
			time_event_range_statement(
				lane_symbols,
				nil,
				'time_ms',
				true,
				false,
				include_previous_always,
				initial_flag,
				singleton
			),
		}
	else
		wrapped_ranges = {
			time_event_range_statement(
				lane_symbols,
				'previous_time_ms',
				nil,
				false,
				false,
				include_previous_initial,
				initial_flag,
				singleton
			),
			time_event_range_statement(
				lane_symbols,
				'event_duration_ms',
				'time_ms',
				false,
				false,
				include_previous_always,
				initial_flag,
				singleton
			),
		}
	end
	return {
		if_statement({
			if_clause(flag_set_expression(wrapped_flag), block(wrapped_ranges)),
			if_clause(
				flag_set_expression(initial_flag),
				block({
					time_event_range_statement(
						lane_symbols,
						'previous_time_ms',
						'time_ms',
						forward,
						true,
						include_previous_always,
						initial_flag,
						singleton
					),
				})
			),
			else_clause(block({
				time_event_range_statement(
					lane_symbols,
					'previous_time_ms',
					'time_ms',
					forward,
					true,
					include_previous_never,
					initial_flag,
					singleton
				),
			})),
		}),
	}
end

local emit_directional_domain<const> = function(
	statements,
	method_symbols,
	has_forward,
	has_backward,
	build_direction,
	wrapped_flag,
	initial_flag,
	forward_specialization,
	backward_specialization
)
	local forward_block
	local backward_block
	if has_forward then
		forward_block = block(build_direction(
			method_symbols.forward,
			true,
			wrapped_flag,
			initial_flag,
			forward_specialization
		))
	end
	if has_backward then
		backward_block = block(build_direction(
			method_symbols.backward,
			false,
			wrapped_flag,
			initial_flag,
			backward_specialization
		))
	end
	local clauses<const> = {}
	if has_forward then
		clauses[1] = if_clause(
			binary_expression(
				syntax.binary_greater,
				identifier('direction'),
				numeric_literal(0)
			),
			forward_block
		)
		if has_backward then
			clauses[2] = else_clause(backward_block)
		end
	else
		clauses[1] = if_clause(
			binary_expression(
				syntax.binary_less_equal,
				identifier('direction'),
				numeric_literal(0)
			),
			backward_block
		)
	end
	statements[#statements + 1] = if_statement(clauses)
end

local any_frame_domain<const> = function(values)
	return (values.play_event_shape
		| values.seek_event_shape
		| values.scrub_event_shape) & event_lane_shape.frame_mask ~= 0
end

local any_time_domain<const> = function(values)
	return (values.play_event_shape
		| values.seek_event_shape
		| values.scrub_event_shape) & event_lane_shape.time_mask ~= 0
end

local has_multi_time_lane<const> = function(shape)
	return (intersects(shape, event_lane_shape.forward_time)
		and not intersects(shape, event_lane_shape.forward_single_time))
		or (intersects(shape, event_lane_shape.backward_time)
			and not intersects(shape, event_lane_shape.backward_single_time))
end

local any_multi_time_domain<const> = function(values)
	return has_multi_time_lane(values.play_event_shape)
		or has_multi_time_lane(values.seek_event_shape)
		or has_multi_time_lane(values.scrub_event_shape)
end

function event_evaluator_syntax.capture_dependencies(statements, values)
	if any_frame_domain(values) then
		statements[#statements + 1] = local_statement(
			identifier('emit_event_range'),
			identifier('emit_event_range'),
			true
		)
	end
	if any_multi_time_domain(values) then
		statements[#statements + 1] = local_statement(
			identifier('emit_time_event_range'),
			identifier('emit_time_event_range'),
			true
		)
	end
end

local capture_direction_lane<const> = function(
	statements,
	lanes_symbol,
	lane_symbols,
	forward,
	present,
	single_time
)
	if not present then
		return
	end
	local member_name<const> = forward and 'forward' or 'backward'
	statements[#statements + 1] = local_statement(
		reference(lane_symbols.lane),
		member_expression(reference(lanes_symbol), member_name),
		true
	)
	if single_time then
		statements[#statements + 1] = local_statement(
			reference(lane_symbols.time_key),
			index_expression(
				member_expression(reference(lane_symbols.lane), 'time_keys'),
				numeric_literal(1)
			),
			true
		)
		statements[#statements + 1] = local_statement(
			reference(lane_symbols.time_ms),
			member_expression(reference(lane_symbols.time_key), 'time_ms'),
			true
		)
	end
end

local capture_event_lanes<const> = function(
	statements,
	events_name,
	method_symbols,
	method,
	shape
)
	statements[#statements + 1] = local_statement(
		reference(method_symbols.lanes),
		index_expression(identifier(events_name), numeric_literal(method + 1)),
		true
	)
	capture_direction_lane(
		statements,
		method_symbols.lanes,
		method_symbols.forward,
		true,
		intersects(shape, event_lane_shape.forward_mask),
		intersects(shape, event_lane_shape.forward_single_time)
	)
	capture_direction_lane(
		statements,
		method_symbols.lanes,
		method_symbols.backward,
		false,
		intersects(shape, event_lane_shape.backward_mask),
		intersects(shape, event_lane_shape.backward_single_time)
	)
end

function event_evaluator_syntax.capture_program(statements, values)
	local has_frame<const> = any_frame_domain(values)
	local has_time<const> = any_time_domain(values)
	if not has_frame and not has_time then
		return
	end
	local events_name<const> = 'timeline_events'
	statements[#statements + 1] = local_statement(
		identifier(events_name),
		member_expression(member_expression(identifier('program'), 'tracks'), 'events'),
		true
	)
	if has_frame then
		statements[#statements + 1] = local_statement(
			identifier('event_last_frame'),
			member_expression(identifier('program'), 'last_frame'),
			true
		)
	end
	if has_time then
		statements[#statements + 1] = local_statement(
			identifier('event_duration_ms'),
			member_expression(identifier('program'), 'duration_ms'),
			true
		)
	end
	capture_event_lanes(
		statements,
		events_name,
		symbols.play,
		values.play_method,
		values.play_event_shape
	)
	if values.seek_event_shape ~= 0 then
		capture_event_lanes(
			statements,
			events_name,
			symbols.jump,
			values.jump_method,
			values.seek_event_shape
		)
	end
	if values.scrub_event_shape ~= 0 then
		capture_event_lanes(
			statements,
			events_name,
			symbols.scrub,
			values.scrub_method,
			values.scrub_event_shape
		)
	end
end

local emit_domains<const> = function(
	statements,
	method_symbols,
	shape,
	values
)
	local has_forward_frame<const> = intersects(shape, event_lane_shape.forward_frame)
	local has_backward_frame<const> = intersects(shape, event_lane_shape.backward_frame)
	local has_forward_time<const> = intersects(shape, event_lane_shape.forward_time)
	local has_backward_time<const> = intersects(shape, event_lane_shape.backward_time)
	if has_forward_frame or has_backward_frame then
		emit_directional_domain(
			statements,
			method_symbols,
			has_forward_frame,
			has_backward_frame,
			frame_direction_statements,
			values.wrapped_flag,
			values.initial_flag,
			false,
			false
		)
	end
	if has_forward_time or has_backward_time then
		emit_directional_domain(
			statements,
			method_symbols,
			has_forward_time,
			has_backward_time,
			time_direction_statements,
			values.wrapped_flag,
			values.initial_flag,
			intersects(shape, event_lane_shape.forward_single_time),
			intersects(shape, event_lane_shape.backward_single_time)
		)
	end
end

function event_evaluator_syntax.emit(statements, values, evaluator_name, method)
	if evaluator_name == 'play' then
		emit_domains(
			statements,
			symbols.play,
			values.play_event_shape,
			values
		)
	elseif method == values.jump_method and values.seek_event_shape ~= 0 then
		emit_domains(
			statements,
			symbols.jump,
			values.seek_event_shape,
			values
		)
	elseif method == values.scrub_method and values.scrub_event_shape ~= 0 then
		emit_domains(
			statements,
			symbols.scrub,
			values.scrub_event_shape,
			values
		)
	end
end

return event_evaluator_syntax
