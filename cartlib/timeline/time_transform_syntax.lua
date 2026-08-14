-- Admission-only lowering for clip time transforms. The compiled function maps
-- parent time and commits the child transport in one datapath; authored modes,
-- child timing and boundary capabilities never branch in the 50 Hz dispatcher.
local child_transport_syntax<const> = require('cartlib/timeline/child_transport_syntax')
local syntax_factory<const> = lua_compiler.syntax_factory

local time_transform_syntax<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local generated_symbol<const> = syntax_factory.generated_symbol
local reference<const> = syntax_factory.reference
local numeric_literal<const> = syntax_factory.number_literal
local boolean_literal<const> = syntax_factory.boolean_literal
local nil_literal<const> = syntax_factory.nil_literal
local member_expression<const> = syntax_factory.member_expression
local binary_expression<const> = syntax_factory.binary_expression
local unary_expression<const> = syntax_factory.unary_expression
local function_expression<const> = syntax_factory.function_expression
local assignment_statement<const> = syntax_factory.assignment_statement
local local_statement<const> = syntax_factory.local_statement
local if_clause<const> = syntax_factory.if_clause
local else_clause<const> = syntax_factory.else_clause
local if_statement<const> = syntax_factory.if_statement
local while_statement<const> = syntax_factory.while_statement
local return_statement<const> = syntax_factory.return_statement

local affine_identity<const> = 0
local affine_translation<const> = 1

-- One transform owns every lexical binding emitted into its function, including
-- the child-transport fragment. Names remain diagnostic metadata only.
local symbols<const> = {
	target = generated_symbol('target'),
	owner = generated_symbol('owner'),
	previous_parent_time_ms = generated_symbol('previous_parent_time_ms'),
	parent_time_ms = generated_symbol('parent_time_ms'),
	evaluate = generated_symbol('evaluate'),
	initial = generated_symbol('initial'),
	clip = generated_symbol('clip'),
	time_scale = generated_symbol('time_scale'),
	time_offset_ms = generated_symbol('time_offset_ms'),
	previous_time_ms = generated_symbol('previous_time_ms'),
	time_ms = generated_symbol('time_ms'),
	duration_ms = generated_symbol('duration_ms'),
	direction = generated_symbol('direction'),
	remaining_ms = generated_symbol('remaining_ms'),
	evaluated = generated_symbol('evaluated'),
	distance_ms = generated_symbol('distance_ms'),
	period_ms = generated_symbol('period_ms'),
	previous_phase_ms = generated_symbol('previous_phase_ms'),
	phase_ms = generated_symbol('phase_ms'),
	cursor_ms = generated_symbol('cursor_ms'),
	segment = generated_symbol('segment'),
	segment_start_ms = generated_symbol('segment_start_ms'),
	segment_offset_ms = generated_symbol('segment_offset_ms'),
	previous_local_ms = generated_symbol('previous_local_ms'),
	boundary_ms = generated_symbol('boundary_ms'),
	local_time_ms = generated_symbol('local_time_ms'),
	program = generated_symbol('program'),
	frame_duration = generated_symbol('frame_duration'),
	last_frame = generated_symbol('last_frame'),
	context = generated_symbol('context'),
	flags = generated_symbol('flags'),
	previous_frame = generated_symbol('previous_frame'),
	frame = generated_symbol('frame'),
}

local target_member<const> = function(name)
	return member_expression(reference(symbols.target), name)
end

local clip_member<const> = function(name)
	return member_expression(reference(symbols.clip), name)
end

local mapped_time_expression<const> = function(parent_time_symbol, affine)
	if affine == affine_identity then
		return reference(parent_time_symbol)
	end
	if affine == affine_translation then
		return binary_expression(
			syntax.binary_add,
			reference(parent_time_symbol),
			reference(symbols.time_offset_ms)
		)
	end
	return binary_expression(
		syntax.binary_add,
		binary_expression(
			syntax.binary_multiply,
			reference(parent_time_symbol),
			reference(symbols.time_scale)
		),
		reference(symbols.time_offset_ms)
	)
end

local emit_once_time_mapping<const> = function(statements, values)
	if values.affine == affine_translation then
		statements[#statements + 1] = local_statement(
			reference(symbols.time_offset_ms),
			member_expression(target_member('clip'), 'time_offset_ms'),
			true
		)
	elseif values.affine ~= affine_identity then
		statements[#statements + 1] = local_statement(
			reference(symbols.clip),
			target_member('clip'),
			true
		)
		statements[#statements + 1] = local_statement(
			reference(symbols.time_scale),
			clip_member('time_scale'),
			true
		)
		statements[#statements + 1] = local_statement(
			reference(symbols.time_offset_ms),
			clip_member('time_offset_ms'),
			true
		)
	end
	statements[#statements + 1] = local_statement(
		reference(symbols.previous_time_ms),
		mapped_time_expression(symbols.previous_parent_time_ms, values.affine),
		not values.bounded
	)
	statements[#statements + 1] = local_statement(
		reference(symbols.time_ms),
		mapped_time_expression(symbols.parent_time_ms, values.affine),
		not values.bounded
	)
end

local emit_cyclic_captures<const> = function(statements, values)
	statements[#statements + 1] = local_statement(
		reference(symbols.clip),
		target_member('clip'),
		true
	)
	if values.affine ~= affine_identity then
		statements[#statements + 1] = local_statement(
			reference(symbols.time_offset_ms),
			clip_member('time_offset_ms'),
			true
		)
	end
	if values.affine ~= affine_identity and values.affine ~= affine_translation then
		statements[#statements + 1] = local_statement(
			reference(symbols.time_scale),
			clip_member('time_scale'),
			true
		)
	end
	statements[#statements + 1] = local_statement(
		reference(symbols.duration_ms),
		target_member('duration_ms'),
		true
	)
end

local clamp_time_statement<const> = function(time_symbol)
	return if_statement({
		if_clause(
			binary_expression(
				syntax.binary_less,
				reference(time_symbol),
				numeric_literal(0)
			),
			block({ assignment_statement(reference(time_symbol), numeric_literal(0)) })
		),
		if_clause(
			binary_expression(
				syntax.binary_greater,
				reference(time_symbol),
				reference(symbols.duration_ms)
			),
			block({
				assignment_statement(reference(time_symbol), reference(symbols.duration_ms)),
			})
		),
	})
end

local emit_bounds<const> = function(statements, bounded)
	if not bounded then
		return
	end
	statements[#statements + 1] = local_statement(
		reference(symbols.duration_ms),
		target_member('duration_ms'),
		true
	)
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_not_equal,
				reference(symbols.duration_ms),
				nil_literal()
			),
			block({
				clamp_time_statement(symbols.previous_time_ms),
				clamp_time_statement(symbols.time_ms),
			})
		),
	})
end

local emit_direction<const> = function(statements)
	statements[#statements + 1] = local_statement(
		reference(symbols.direction),
		numeric_literal(0),
		false
	)
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_greater,
				reference(symbols.time_ms),
				reference(symbols.previous_time_ms)
			),
			block({ assignment_statement(reference(symbols.direction), numeric_literal(1)) })
		),
		if_clause(
			binary_expression(
				syntax.binary_less,
				reference(symbols.time_ms),
				reference(symbols.previous_time_ms)
			),
			block({ assignment_statement(reference(symbols.direction), numeric_literal(-1)) })
		),
	})
end

local emit_transport_captures<const> = child_transport_syntax.emit_captures
local emit_child_range<const> = child_transport_syntax.emit_range
local transform_parameters<const> = function(position, active)
	local parameters<const> = {
		reference(symbols.target),
		reference(symbols.owner),
		reference(symbols.previous_parent_time_ms),
		reference(symbols.parent_time_ms),
	}
	if position then
		parameters[#parameters + 1] = reference(symbols.evaluate)
	end
	if not active then
		parameters[#parameters + 1] = reference(symbols.initial)
	end
	return parameters
end

local transform_chunk<const> = function(statements, position, active)
	return syntax_factory.chunk(block({
		return_statement({
			function_expression(transform_parameters(position, active), block(statements)),
		}),
	}))
end

function time_transform_syntax.build_once(values)
	local statements<const> = {}
	emit_once_time_mapping(statements, values)
	emit_bounds(statements, values.bounded)
	if values.direction == 0 then
		emit_direction(statements)
	end
	emit_transport_captures(statements, values, symbols)
	emit_child_range(
		statements,
		values,
		symbols,
		symbols.previous_time_ms,
		symbols.time_ms,
		values.direction,
		values.direction == 0,
		values.boundary_none
	)
	return transform_chunk(statements, values.direction == 0, values.active)
end

local emit_loop_position<const> = function(statements, values)
	emit_cyclic_captures(statements, values)
	emit_transport_captures(statements, values, symbols)
	statements[#statements + 1] = assignment_statement(
		target_member('wrapped'),
		boolean_literal(false)
	)
	statements[#statements + 1] = local_statement(
		reference(symbols.previous_time_ms),
		binary_expression(
			syntax.binary_modulus,
			mapped_time_expression(symbols.previous_parent_time_ms, values.affine),
			reference(symbols.duration_ms)
		),
		true
	)
	statements[#statements + 1] = local_statement(
		reference(symbols.time_ms),
		binary_expression(
			syntax.binary_modulus,
			mapped_time_expression(symbols.parent_time_ms, values.affine),
			reference(symbols.duration_ms)
		),
		true
	)
	emit_direction(statements)
	emit_child_range(
		statements,
		values,
		symbols,
		symbols.previous_time_ms,
		symbols.time_ms,
		0,
		true,
		values.boundary_none
	)
end

local loop_delta_expression<const> = function(values)
	local delta
	if values.direction > 0 then
		delta = binary_expression(
			syntax.binary_subtract,
			reference(symbols.parent_time_ms),
			reference(symbols.previous_parent_time_ms)
		)
	else
		delta = binary_expression(
			syntax.binary_subtract,
			reference(symbols.previous_parent_time_ms),
			reference(symbols.parent_time_ms)
		)
	end
	if values.affine == affine_identity or values.affine == affine_translation then
		return delta
	end
	return binary_expression(
		syntax.binary_multiply,
		delta,
		reference(symbols.time_scale)
	)
end

local emit_loop_play<const> = function(statements, values)
	emit_cyclic_captures(statements, values)
	emit_transport_captures(statements, values, symbols)
	statements[#statements + 1] = assignment_statement(
		target_member('wrapped'),
		boolean_literal(false)
	)
	if values.active then
		statements[#statements + 1] = local_statement(
			reference(symbols.previous_time_ms),
			target_member('position_ms'),
			false
		)
	else
		statements[#statements + 1] = local_statement(reference(symbols.previous_time_ms), nil, false)
		statements[#statements + 1] = if_statement({
			if_clause(reference(symbols.initial), block({
				assignment_statement(
					reference(symbols.previous_time_ms),
					binary_expression(
						syntax.binary_modulus,
						mapped_time_expression(symbols.previous_parent_time_ms, values.affine),
						reference(symbols.duration_ms)
					)
				),
			})),
			else_clause(block({
				assignment_statement(reference(symbols.previous_time_ms), target_member('position_ms')),
			})),
		})
	end
	statements[#statements + 1] = local_statement(
		reference(symbols.remaining_ms),
		loop_delta_expression(values),
		false
	)
	statements[#statements + 1] = local_statement(
		reference(symbols.evaluated),
		boolean_literal(false),
		false
	)
	local initial_distance
	if values.direction > 0 then
		initial_distance = binary_expression(
			syntax.binary_subtract,
			reference(symbols.duration_ms),
			reference(symbols.previous_time_ms)
		)
	else
		initial_distance = reference(symbols.previous_time_ms)
	end
	statements[#statements + 1] = local_statement(
		reference(symbols.distance_ms),
		initial_distance,
		false
	)
	local loop_body<const> = {
		assignment_statement(
			reference(symbols.remaining_ms),
			binary_expression(
				syntax.binary_subtract,
				reference(symbols.remaining_ms),
				reference(symbols.distance_ms)
			)
		),
		assignment_statement(target_member('wrapped'), boolean_literal(true)),
	}
	local boundary_time
	if values.direction > 0 then
		boundary_time = numeric_literal(0)
	else
		boundary_time = reference(symbols.duration_ms)
	end
	loop_body[#loop_body + 1] = local_statement(
		reference(symbols.time_ms),
		boundary_time,
		true
	)
	emit_child_range(
		loop_body,
		values,
		symbols,
		symbols.previous_time_ms,
		symbols.time_ms,
		values.direction,
		false,
		values.loop_boundary_flags
	)
	if not values.active then
		loop_body[#loop_body + 1] = assignment_statement(reference(symbols.initial), boolean_literal(false))
	end
	loop_body[#loop_body + 1] = assignment_statement(reference(symbols.evaluated), boolean_literal(true))
	loop_body[#loop_body + 1] = assignment_statement(
		reference(symbols.previous_time_ms),
		reference(symbols.time_ms)
	)
	loop_body[#loop_body + 1] = assignment_statement(
		reference(symbols.distance_ms),
		reference(symbols.duration_ms)
	)
	local loop_operator<const> = values.direction > 0
		and syntax.binary_greater_equal
		or syntax.binary_greater
	statements[#statements + 1] = while_statement(
		binary_expression(
			loop_operator,
			reference(symbols.remaining_ms),
			reference(symbols.distance_ms)
		),
		block(loop_body)
	)
	local final_body<const> = {}
	local final_time
	if values.direction > 0 then
		final_time = binary_expression(
			syntax.binary_add,
			reference(symbols.previous_time_ms),
			reference(symbols.remaining_ms)
		)
	else
		final_time = binary_expression(
			syntax.binary_subtract,
			reference(symbols.previous_time_ms),
			reference(symbols.remaining_ms)
		)
	end
	final_body[#final_body + 1] = local_statement(reference(symbols.time_ms), final_time, true)
	emit_child_range(
		final_body,
		values,
		symbols,
		symbols.previous_time_ms,
		symbols.time_ms,
		values.direction,
		false,
		values.boundary_none
	)
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_or,
				binary_expression(
					syntax.binary_greater,
					reference(symbols.remaining_ms),
					numeric_literal(0)
				),
				unary_expression(syntax.unary_not, reference(symbols.evaluated))
			),
			block(final_body)
		),
	})
end

function time_transform_syntax.build_loop(values)
	local statements<const> = {}
	if values.direction == 0 then
		emit_loop_position(statements, values)
	else
		emit_loop_play(statements, values)
	end
	return transform_chunk(statements, values.direction == 0, values.active)
end

local emit_pingpong_time<const> = function(
	statements,
	values,
	parent_time_symbol,
	phase_symbol,
	time_symbol
)
	statements[#statements + 1] = local_statement(
		reference(phase_symbol),
		binary_expression(
			syntax.binary_modulus,
			mapped_time_expression(parent_time_symbol, values.affine),
			reference(symbols.period_ms)
		),
		true
	)
	statements[#statements + 1] = local_statement(reference(time_symbol), nil, false)
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_less_equal,
				reference(phase_symbol),
				reference(symbols.duration_ms)
			),
			block({ assignment_statement(reference(time_symbol), reference(phase_symbol)) })
		),
		else_clause(block({
			assignment_statement(
				reference(time_symbol),
				binary_expression(
					syntax.binary_subtract,
					reference(symbols.period_ms),
					reference(phase_symbol)
				)
			),
		})),
	})
end

local emit_pingpong_position<const> = function(statements, values)
	emit_cyclic_captures(statements, values)
	emit_transport_captures(statements, values, symbols)
	statements[#statements + 1] = local_statement(
		reference(symbols.period_ms),
		binary_expression(
			syntax.binary_multiply,
			reference(symbols.duration_ms),
			numeric_literal(2)
		),
		true
	)
	emit_pingpong_time(
		statements,
		values,
		symbols.previous_parent_time_ms,
		symbols.previous_phase_ms,
		symbols.previous_time_ms
	)
	emit_pingpong_time(
		statements,
		values,
		symbols.parent_time_ms,
		symbols.phase_ms,
		symbols.time_ms
	)
	emit_direction(statements)
	emit_child_range(
		statements,
		values,
		symbols,
		symbols.previous_time_ms,
		symbols.time_ms,
		0,
		true,
		values.boundary_none
	)
end

local emit_pingpong_initial_segment<const> = function(statements, backward)
	statements[#statements + 1] = local_statement(
		reference(symbols.cursor_ms),
		reference(symbols.previous_time_ms),
		false
	)
	statements[#statements + 1] = local_statement(
		reference(symbols.segment),
		binary_expression(
			syntax.binary_floor_divide,
			reference(symbols.cursor_ms),
			reference(symbols.duration_ms)
		),
		not backward
	)
	statements[#statements + 1] = local_statement(
		reference(symbols.segment_start_ms),
		binary_expression(
			syntax.binary_multiply,
			reference(symbols.segment),
			reference(symbols.duration_ms)
		),
		not backward
	)
	statements[#statements + 1] = local_statement(
		reference(symbols.segment_offset_ms),
		binary_expression(
			syntax.binary_subtract,
			reference(symbols.cursor_ms),
			reference(symbols.segment_start_ms)
		),
		not backward
	)
	if backward then
		statements[#statements + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_equal,
					reference(symbols.segment_offset_ms),
					numeric_literal(0)
				),
				block({
					assignment_statement(
						reference(symbols.segment),
						binary_expression(
							syntax.binary_subtract,
							reference(symbols.segment),
							numeric_literal(1)
						)
					),
					assignment_statement(
						reference(symbols.segment_start_ms),
						binary_expression(
							syntax.binary_subtract,
							reference(symbols.segment_start_ms),
							reference(symbols.duration_ms)
						)
					),
					assignment_statement(reference(symbols.segment_offset_ms), reference(symbols.duration_ms)),
				})
			),
		})
	end
	statements[#statements + 1] = local_statement(reference(symbols.previous_local_ms), nil, false)
	statements[#statements + 1] = local_statement(reference(symbols.direction), nil, false)
	local even_direction<const> = backward and -1 or 1
	local odd_direction<const> = -even_direction
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_equal,
				binary_expression(
					syntax.binary_bitwise_and,
					reference(symbols.segment),
					numeric_literal(1)
				),
				numeric_literal(0)
			),
			block({
				assignment_statement(reference(symbols.previous_local_ms), reference(symbols.segment_offset_ms)),
				assignment_statement(reference(symbols.direction), numeric_literal(even_direction)),
			})
		),
		else_clause(block({
			assignment_statement(
				reference(symbols.previous_local_ms),
				binary_expression(
					syntax.binary_subtract,
					reference(symbols.duration_ms),
					reference(symbols.segment_offset_ms)
				)
			),
			assignment_statement(reference(symbols.direction), numeric_literal(odd_direction)),
		})),
	})
end

local emit_pingpong_play<const> = function(statements, values)
	local backward<const> = values.direction < 0
	emit_cyclic_captures(statements, values)
	emit_transport_captures(statements, values, symbols)
	statements[#statements + 1] = local_statement(
		reference(symbols.previous_time_ms),
		mapped_time_expression(symbols.previous_parent_time_ms, values.affine),
		true
	)
	statements[#statements + 1] = local_statement(
		reference(symbols.time_ms),
		mapped_time_expression(symbols.parent_time_ms, values.affine),
		true
	)
	emit_pingpong_initial_segment(statements, backward)
	local boundary_initial
	if backward then
		boundary_initial = reference(symbols.segment_start_ms)
	else
		boundary_initial = binary_expression(
			syntax.binary_add,
			reference(symbols.segment_start_ms),
			reference(symbols.duration_ms)
		)
	end
	statements[#statements + 1] = local_statement(
		reference(symbols.boundary_ms),
		boundary_initial,
		false
	)
	local loop_body<const> = {
		local_statement(reference(symbols.local_time_ms), numeric_literal(0), false),
		if_statement({
			if_clause(
				binary_expression(
					syntax.binary_greater,
					reference(symbols.direction),
					numeric_literal(0)
				),
				block({
					assignment_statement(reference(symbols.local_time_ms), reference(symbols.duration_ms)),
				})
			),
		}),
	}
	emit_child_range(
		loop_body,
		values,
		symbols,
		symbols.previous_local_ms,
		symbols.local_time_ms,
		0,
		true,
		values.boundary_turn
	)
	if not values.active then
		loop_body[#loop_body + 1] = assignment_statement(reference(symbols.initial), boolean_literal(false))
	end
	loop_body[#loop_body + 1] = assignment_statement(
		reference(symbols.cursor_ms),
		reference(symbols.boundary_ms)
	)
	loop_body[#loop_body + 1] = assignment_statement(
		reference(symbols.previous_local_ms),
		reference(symbols.local_time_ms)
	)
	loop_body[#loop_body + 1] = assignment_statement(
		reference(symbols.direction),
		unary_expression(syntax.unary_negate, reference(symbols.direction))
	)
	local boundary_step_operator<const> = backward and syntax.binary_subtract or syntax.binary_add
	loop_body[#loop_body + 1] = assignment_statement(
		reference(symbols.boundary_ms),
		binary_expression(
			boundary_step_operator,
			reference(symbols.boundary_ms),
			reference(symbols.duration_ms)
		)
	)
	local loop_comparison<const> = backward and syntax.binary_greater_equal or syntax.binary_less_equal
	statements[#statements + 1] = while_statement(
		binary_expression(
			loop_comparison,
			reference(symbols.boundary_ms),
			reference(symbols.time_ms)
		),
		block(loop_body)
	)
	local final_body<const> = {}
	local distance
	if backward then
		distance = binary_expression(
			syntax.binary_subtract,
			reference(symbols.cursor_ms),
			reference(symbols.time_ms)
		)
	else
		distance = binary_expression(
			syntax.binary_subtract,
			reference(symbols.time_ms),
			reference(symbols.cursor_ms)
		)
	end
	final_body[#final_body + 1] = local_statement(
		reference(symbols.local_time_ms),
		binary_expression(
			syntax.binary_add,
			reference(symbols.previous_local_ms),
			binary_expression(
				syntax.binary_multiply,
				distance,
				reference(symbols.direction)
			)
		),
		true
	)
	emit_child_range(
		final_body,
		values,
		symbols,
		symbols.previous_local_ms,
		symbols.local_time_ms,
		0,
		true,
		values.boundary_none
	)
	local final_comparison<const> = backward and syntax.binary_greater or syntax.binary_less
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_or,
				binary_expression(
					final_comparison,
					reference(symbols.cursor_ms),
					reference(symbols.time_ms)
				),
				binary_expression(
					syntax.binary_equal,
					reference(symbols.cursor_ms),
					reference(symbols.previous_time_ms)
				)
			),
			block(final_body)
		),
	})
end

function time_transform_syntax.build_pingpong(values)
	local statements<const> = {}
	if values.direction == 0 then
		emit_pingpong_position(statements, values)
	else
		emit_pingpong_play(statements, values)
	end
	return transform_chunk(statements, values.direction == 0, values.active)
end

return time_transform_syntax
