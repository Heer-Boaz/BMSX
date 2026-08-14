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
	lane_name,
	previous,
	current,
	direction,
	include_previous
)
	return call_statement(call_expression(identifier('emit_event_range'), {
		identifier(lane_name),
		identifier('owner'),
		previous,
		current,
		direction,
		include_previous,
	}))
end

local time_event_range_statement<const> = function(
	lane_name,
	previous,
	current,
	direction,
	include_previous
)
	return call_statement(call_expression(identifier('emit_time_event_range'), {
		identifier(lane_name),
		identifier('owner'),
		previous,
		current,
		direction,
		include_previous,
	}))
end

local event_dispatch_loop<const> = function(lane_name, reverse)
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
				member_expression(identifier(lane_name), 'by_frame'),
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
	lane_name,
	forward,
	wrapped_flag,
	initial_flag
)
	local wrapped_ranges
	local adjacent_condition
	if forward then
		wrapped_ranges = {
			event_range_statement(
				lane_name,
				identifier('previous_frame'),
				identifier('event_last_frame'),
				numeric_literal(1),
				flag_set_expression(initial_flag)
			),
			event_range_statement(
				lane_name,
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
				lane_name,
				identifier('previous_frame'),
				numeric_literal(0),
				numeric_literal(-1),
				flag_set_expression(initial_flag)
			),
			event_range_statement(
				lane_name,
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
						lane_name,
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
							block(event_dispatch_loop(lane_name, not forward))
						),
						else_clause(block({
							event_range_statement(
								lane_name,
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
	lane_name,
	forward,
	wrapped_flag,
	initial_flag
)
	local wrapped_ranges
	if forward then
		wrapped_ranges = {
			time_event_range_statement(
				lane_name,
				identifier('previous_time_ms'),
				identifier('event_duration_ms'),
				numeric_literal(1),
				flag_set_expression(initial_flag)
			),
			time_event_range_statement(
				lane_name,
				numeric_literal(0),
				identifier('time_ms'),
				numeric_literal(1),
				boolean_literal(true)
			),
		}
	else
		wrapped_ranges = {
			time_event_range_statement(
				lane_name,
				identifier('previous_time_ms'),
				numeric_literal(0),
				numeric_literal(-1),
				flag_set_expression(initial_flag)
			),
			time_event_range_statement(
				lane_name,
				identifier('event_duration_ms'),
				identifier('time_ms'),
				numeric_literal(-1),
				boolean_literal(true)
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
						lane_name,
						identifier('previous_time_ms'),
						identifier('time_ms'),
						identifier('direction'),
						boolean_literal(true)
					),
				})
			),
			else_clause(block({
				time_event_range_statement(
					lane_name,
					identifier('previous_time_ms'),
					identifier('time_ms'),
					identifier('direction'),
					boolean_literal(false)
				),
			})),
		}),
	}
end

local emit_directional_domain<const> = function(
	statements,
	prefix,
	has_forward,
	has_backward,
	build_direction,
	wrapped_flag,
	initial_flag
)
	local forward_block
	local backward_block
	if has_forward then
		forward_block = block(build_direction(
			prefix .. '_event_forward',
			true,
			wrapped_flag,
			initial_flag
		))
	end
	if has_backward then
		backward_block = block(build_direction(
			prefix .. '_event_backward',
			false,
			wrapped_flag,
			initial_flag
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

function event_evaluator_syntax.capture_dependencies(statements, values)
	if any_frame_domain(values) then
		statements[#statements + 1] = local_statement(
			identifier('emit_event_range'),
			identifier('emit_event_range'),
			true
		)
	end
	if any_time_domain(values) then
		statements[#statements + 1] = local_statement(
			identifier('emit_time_event_range'),
			identifier('emit_time_event_range'),
			true
		)
	end
end

local capture_event_lanes<const> = function(
	statements,
	events_name,
	prefix,
	method,
	has_forward,
	has_backward
)
	local lanes_name<const> = prefix .. '_event_lanes'
	statements[#statements + 1] = local_statement(
		identifier(lanes_name),
		index_expression(identifier(events_name), numeric_literal(method + 1)),
		true
	)
	if has_forward then
		statements[#statements + 1] = local_statement(
			identifier(prefix .. '_event_forward'),
			member_expression(identifier(lanes_name), 'forward'),
			true
		)
	end
	if has_backward then
		statements[#statements + 1] = local_statement(
			identifier(prefix .. '_event_backward'),
			member_expression(identifier(lanes_name), 'backward'),
			true
		)
	end
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
		'play',
		values.play_method,
		intersects(values.play_event_shape, event_lane_shape.forward_mask),
		intersects(values.play_event_shape, event_lane_shape.backward_mask)
	)
	if values.seek_event_shape ~= 0 then
		capture_event_lanes(
			statements,
			events_name,
			'jump',
			values.jump_method,
			intersects(values.seek_event_shape, event_lane_shape.forward_mask),
			intersects(values.seek_event_shape, event_lane_shape.backward_mask)
		)
	end
	if values.scrub_event_shape ~= 0 then
		capture_event_lanes(
			statements,
			events_name,
			'scrub',
			values.scrub_method,
			intersects(values.scrub_event_shape, event_lane_shape.forward_mask),
			intersects(values.scrub_event_shape, event_lane_shape.backward_mask)
		)
	end
end

local emit_domains<const> = function(
	statements,
	prefix,
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
			prefix,
			has_forward_frame,
			has_backward_frame,
			frame_direction_statements,
			values.wrapped_flag,
			values.initial_flag
		)
	end
	if has_forward_time or has_backward_time then
		emit_directional_domain(
			statements,
			prefix,
			has_forward_time,
			has_backward_time,
			time_direction_statements,
			values.wrapped_flag,
			values.initial_flag
		)
	end
end

function event_evaluator_syntax.emit(statements, values, evaluator_name, method)
	if evaluator_name == 'play' then
		emit_domains(
			statements,
			'play',
			values.play_event_shape,
			values
		)
	elseif method == values.jump_method and values.seek_event_shape ~= 0 then
		emit_domains(
			statements,
			'jump',
			values.seek_event_shape,
			values
		)
	elseif method == values.scrub_method and values.scrub_event_shape ~= 0 then
		emit_domains(
			statements,
			'scrub',
			values.scrub_event_shape,
			values
		)
	end
end

return event_evaluator_syntax
