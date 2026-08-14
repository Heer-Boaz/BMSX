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
	emit_event_range = generated_symbol('emit_event_range'),
	emit_time_event_range = generated_symbol('emit_time_event_range'),
	events = generated_symbol('timeline_events'),
	last_frame = generated_symbol('event_last_frame'),
	duration_ms = generated_symbol('event_duration_ms'),
	bucket = generated_symbol('event_bucket'),
	port = generated_symbol('event_port'),
	emit = generated_symbol('emit_event'),
	index = generated_symbol('event_index'),
	key = generated_symbol('event_key'),
	play = new_method_symbols(),
	jump = new_method_symbols(),
	scrub = new_method_symbols(),
}

local intersects<const> = function(shape, mask)
	return shape & mask ~= 0
end

local flag_set_expression<const> = function(flag, evaluation_symbols)
	return binary_expression(
		syntax.binary_not_equal,
		binary_expression(
			syntax.binary_bitwise_and,
			reference(evaluation_symbols.flags),
			numeric_literal(flag)
		),
		numeric_literal(0)
	)
end

local event_range_statement<const> = function(
	lane_symbols,
	evaluation_symbols,
	previous,
	current,
	direction,
	include_previous
)
	return call_statement(call_expression(reference(symbols.emit_event_range), {
		reference(lane_symbols.lane),
		reference(evaluation_symbols.owner),
		previous,
		current,
		direction,
		include_previous,
	}))
end

-- A nil time operand denotes the timeline origin. Every call creates owned AST
-- occurrences because semantic binding annotates generated syntax in place.
local time_operand<const> = function(symbol)
	if symbol == nil then
		return numeric_literal(0)
	end
	return reference(symbol)
end

local include_previous_expression<const> = function(mode, initial_flag, evaluation_symbols)
	if mode == include_previous_never then
		return boolean_literal(false)
	end
	if mode == include_previous_always then
		return boolean_literal(true)
	end
	return flag_set_expression(initial_flag, evaluation_symbols)
end

local singleton_time_intersection<const> = function(
	lane_symbols,
	evaluation_symbols,
	previous_symbol,
	current_symbol,
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
		time_operand(previous_symbol),
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
					time_operand(previous_symbol),
					reference(lane_symbols.time_ms)
				),
				flag_set_expression(initial_flag, evaluation_symbols)
			)
		)
	end
	return binary_expression(
		syntax.binary_and,
		binary_expression(
			forward and syntax.binary_greater_equal or syntax.binary_less_equal,
			time_operand(current_symbol),
			reference(lane_symbols.time_ms)
		),
		previous_intersects
	)
end

local time_event_range_statement<const> = function(
	lane_symbols,
	evaluation_symbols,
	previous_symbol,
	current_symbol,
	forward,
	dynamic_direction,
	include_previous,
	initial_flag,
	singleton
)
	local direction_expression
	if dynamic_direction then
		direction_expression = reference(evaluation_symbols.direction)
	else
		direction_expression = numeric_literal(forward and 1 or -1)
	end
	if not singleton then
		return call_statement(call_expression(reference(symbols.emit_time_event_range), {
			reference(lane_symbols.lane),
			reference(evaluation_symbols.owner),
			time_operand(previous_symbol),
			time_operand(current_symbol),
			direction_expression,
			include_previous_expression(
				include_previous,
				initial_flag,
				evaluation_symbols
			),
		}))
	end
	local intersection<const> = singleton_time_intersection(
		lane_symbols,
		evaluation_symbols,
		previous_symbol,
		current_symbol,
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
				reference(evaluation_symbols.direction),
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
					member_expression(reference(evaluation_symbols.owner), 'events'),
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

local event_dispatch_loop<const> = function(lane_symbols, evaluation_symbols, reverse)
	local start_expression<const> = reverse
		and unary_expression(syntax.unary_length, reference(symbols.bucket))
		or numeric_literal(1)
	local limit_expression<const> = reverse
		and numeric_literal(1)
		or unary_expression(syntax.unary_length, reference(symbols.bucket))
	local step_expression = nil
	if reverse then
		step_expression = numeric_literal(-1)
	end
	return {
		local_statement(
			reference(symbols.bucket),
			index_expression(
				member_expression(reference(lane_symbols.lane), 'by_frame'),
				reference(evaluation_symbols.frame)
			),
			true
		),
		if_statement({
			if_clause(
				binary_expression(
					syntax.binary_not_equal,
					reference(symbols.bucket),
					nil_literal()
				),
				block({
					local_statement(
						reference(symbols.port),
						member_expression(reference(evaluation_symbols.owner), 'events'),
						true
					),
					local_statement(
						reference(symbols.emit),
						member_expression(reference(symbols.port), 'emit'),
						true
					),
					numeric_for_statement(
						reference(symbols.index),
						start_expression,
						limit_expression,
						step_expression,
						block({
							local_statement(
								reference(symbols.key),
								index_expression(
									reference(symbols.bucket),
									reference(symbols.index)
								),
								true
							),
							call_statement(call_expression(reference(symbols.emit), {
								reference(symbols.port),
								member_expression(reference(symbols.key), 'event'),
								member_expression(reference(symbols.key), 'payload'),
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
	evaluation_symbols,
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
				evaluation_symbols,
				reference(evaluation_symbols.previous_frame),
				reference(symbols.last_frame),
				numeric_literal(1),
				flag_set_expression(initial_flag, evaluation_symbols)
			),
			event_range_statement(
				lane_symbols,
				evaluation_symbols,
				numeric_literal(0),
				reference(evaluation_symbols.frame),
				numeric_literal(1),
				boolean_literal(true)
			),
		}
		adjacent_condition = binary_expression(
			syntax.binary_equal,
			reference(evaluation_symbols.frame),
			binary_expression(
				syntax.binary_add,
				reference(evaluation_symbols.previous_frame),
				numeric_literal(1)
			)
		)
	else
		wrapped_ranges = {
			event_range_statement(
				lane_symbols,
				evaluation_symbols,
				reference(evaluation_symbols.previous_frame),
				numeric_literal(0),
				numeric_literal(-1),
				flag_set_expression(initial_flag, evaluation_symbols)
			),
			event_range_statement(
				lane_symbols,
				evaluation_symbols,
				reference(symbols.last_frame),
				reference(evaluation_symbols.frame),
				numeric_literal(-1),
				boolean_literal(true)
			),
		}
		adjacent_condition = binary_expression(
			syntax.binary_and,
			binary_expression(
				syntax.binary_less,
				reference(evaluation_symbols.direction),
				numeric_literal(0)
			),
			binary_expression(
				syntax.binary_equal,
				reference(evaluation_symbols.frame),
				binary_expression(
					syntax.binary_subtract,
					reference(evaluation_symbols.previous_frame),
					numeric_literal(1)
				)
			)
		)
	end
	return {
		if_statement({
			if_clause(
				flag_set_expression(wrapped_flag, evaluation_symbols),
				block(wrapped_ranges)
			),
			if_clause(
				flag_set_expression(initial_flag, evaluation_symbols),
				block({
					event_range_statement(
						lane_symbols,
						evaluation_symbols,
						reference(evaluation_symbols.previous_frame),
						reference(evaluation_symbols.frame),
						reference(evaluation_symbols.direction),
						boolean_literal(true)
					),
				})
			),
			if_clause(
				binary_expression(
					syntax.binary_not_equal,
					reference(evaluation_symbols.previous_frame),
					reference(evaluation_symbols.frame)
				),
				block({
					if_statement({
						if_clause(
							adjacent_condition,
							block(event_dispatch_loop(
								lane_symbols,
								evaluation_symbols,
								not forward
							))
						),
						else_clause(block({
							event_range_statement(
								lane_symbols,
								evaluation_symbols,
								reference(evaluation_symbols.previous_frame),
								reference(evaluation_symbols.frame),
								reference(evaluation_symbols.direction),
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
	evaluation_symbols,
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
				evaluation_symbols,
				evaluation_symbols.previous_time_ms,
				symbols.duration_ms,
				true,
				false,
				include_previous_initial,
				initial_flag,
				singleton
			),
			time_event_range_statement(
				lane_symbols,
				evaluation_symbols,
				nil,
				evaluation_symbols.time_ms,
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
				evaluation_symbols,
				evaluation_symbols.previous_time_ms,
				nil,
				false,
				false,
				include_previous_initial,
				initial_flag,
				singleton
			),
			time_event_range_statement(
				lane_symbols,
				evaluation_symbols,
				symbols.duration_ms,
				evaluation_symbols.time_ms,
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
			if_clause(
				flag_set_expression(wrapped_flag, evaluation_symbols),
				block(wrapped_ranges)
			),
			if_clause(
				flag_set_expression(initial_flag, evaluation_symbols),
				block({
					time_event_range_statement(
						lane_symbols,
						evaluation_symbols,
						evaluation_symbols.previous_time_ms,
						evaluation_symbols.time_ms,
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
					evaluation_symbols,
					evaluation_symbols.previous_time_ms,
					evaluation_symbols.time_ms,
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
	evaluation_symbols,
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
			evaluation_symbols,
			true,
			wrapped_flag,
			initial_flag,
			forward_specialization
		))
	end
	if has_backward then
		backward_block = block(build_direction(
			method_symbols.backward,
			evaluation_symbols,
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
				reference(evaluation_symbols.direction),
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
				reference(evaluation_symbols.direction),
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
			reference(symbols.emit_event_range),
			identifier('emit_event_range'),
			true
		)
	end
	if any_multi_time_domain(values) then
		statements[#statements + 1] = local_statement(
			reference(symbols.emit_time_event_range),
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
	method_symbols,
	method,
	shape
)
	statements[#statements + 1] = local_statement(
		reference(method_symbols.lanes),
		index_expression(reference(symbols.events), numeric_literal(method + 1)),
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

function event_evaluator_syntax.capture_program(statements, values, evaluation_symbols)
	local has_frame<const> = any_frame_domain(values)
	local has_time<const> = any_time_domain(values)
	if not has_frame and not has_time then
		return
	end
	statements[#statements + 1] = local_statement(
		reference(symbols.events),
		member_expression(
			member_expression(reference(evaluation_symbols.program), 'tracks'),
			'events'
		),
		true
	)
	if has_frame then
		statements[#statements + 1] = local_statement(
			reference(symbols.last_frame),
			member_expression(reference(evaluation_symbols.program), 'last_frame'),
			true
		)
	end
	if has_time then
		statements[#statements + 1] = local_statement(
			reference(symbols.duration_ms),
			member_expression(reference(evaluation_symbols.program), 'duration_ms'),
			true
		)
	end
	capture_event_lanes(
		statements,
		symbols.play,
		values.play_method,
		values.play_event_shape
	)
	if values.seek_event_shape ~= 0 then
		capture_event_lanes(
			statements,
			symbols.jump,
			values.jump_method,
			values.seek_event_shape
		)
	end
	if values.scrub_event_shape ~= 0 then
		capture_event_lanes(
			statements,
			symbols.scrub,
			values.scrub_method,
			values.scrub_event_shape
		)
	end
end

local emit_domains<const> = function(
	statements,
	method_symbols,
	evaluation_symbols,
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
			evaluation_symbols,
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
			evaluation_symbols,
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

function event_evaluator_syntax.emit(
	statements,
	values,
	evaluation_symbols,
	evaluator_name,
	method
)
	if evaluator_name == 'play' then
		emit_domains(
			statements,
			symbols.play,
			evaluation_symbols,
			values.play_event_shape,
			values
		)
	elseif method == values.jump_method and values.seek_event_shape ~= 0 then
		emit_domains(
			statements,
			symbols.jump,
			evaluation_symbols,
			values.seek_event_shape,
			values
		)
	elseif method == values.scrub_method and values.scrub_event_shape ~= 0 then
		emit_domains(
			statements,
			symbols.scrub,
			evaluation_symbols,
			values.scrub_event_shape,
			values
		)
	end
end

return event_evaluator_syntax
