-- Admission-only lowering for clip time transforms. The compiled function maps
-- parent time and commits the child transport in one datapath; authored modes,
-- child timing and boundary capabilities never branch in the 50 Hz dispatcher.
local child_transport_syntax<const> = require('cartlib/timeline/child_transport_syntax')
local syntax_factory<const> = lua_compiler.syntax_factory

local time_transform_syntax<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
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

local target_member<const> = function(name)
	return member_expression(identifier('target'), name)
end

local instance_member<const> = function(name)
	return member_expression(identifier('instance'), name)
end

local clip_member<const> = function(name)
	return member_expression(identifier('clip'), name)
end

local mapped_time_expression<const> = function(parent_time_name, affine)
	if affine == affine_identity then
		return identifier(parent_time_name)
	end
	if affine == affine_translation then
		return binary_expression(
			syntax.binary_add,
			identifier(parent_time_name),
			identifier('time_offset_ms')
		)
	end
	return binary_expression(
		syntax.binary_add,
		binary_expression(
			syntax.binary_multiply,
			identifier(parent_time_name),
			identifier('time_scale')
		),
		identifier('time_offset_ms')
	)
end

local emit_once_time_mapping<const> = function(statements, values)
	if values.affine == affine_translation then
		statements[#statements + 1] = local_statement(
			identifier('time_offset_ms'),
			member_expression(target_member('clip'), 'time_offset_ms'),
			true
		)
	elseif values.affine ~= affine_identity then
		statements[#statements + 1] = local_statement(
			identifier('clip'),
			target_member('clip'),
			true
		)
		statements[#statements + 1] = local_statement(
			identifier('time_scale'),
			clip_member('time_scale'),
			true
		)
		statements[#statements + 1] = local_statement(
			identifier('time_offset_ms'),
			clip_member('time_offset_ms'),
			true
		)
	end
	statements[#statements + 1] = local_statement(
		identifier('previous_time_ms'),
		mapped_time_expression('previous_parent_time_ms', values.affine),
		not values.bounded
	)
	statements[#statements + 1] = local_statement(
		identifier('time_ms'),
		mapped_time_expression('parent_time_ms', values.affine),
		not values.bounded
	)
end

local emit_cyclic_captures<const> = function(statements, values)
	statements[#statements + 1] = local_statement(
		identifier('clip'),
		target_member('clip'),
		true
	)
	if values.affine ~= affine_identity then
		statements[#statements + 1] = local_statement(
			identifier('time_offset_ms'),
			clip_member('time_offset_ms'),
			true
		)
	end
	if values.affine ~= affine_identity and values.affine ~= affine_translation then
		statements[#statements + 1] = local_statement(
			identifier('time_scale'),
			clip_member('time_scale'),
			true
		)
	end
	statements[#statements + 1] = local_statement(
		identifier('duration_ms'),
		target_member('duration_ms'),
		true
	)
end

local clamp_time_statement<const> = function(name)
	return if_statement({
		if_clause(
			binary_expression(
				syntax.binary_less,
				identifier(name),
				numeric_literal(0)
			),
			block({ assignment_statement(identifier(name), numeric_literal(0)) })
		),
		if_clause(
			binary_expression(
				syntax.binary_greater,
				identifier(name),
				identifier('duration_ms')
			),
			block({
				assignment_statement(identifier(name), identifier('duration_ms')),
			})
		),
	})
end

local emit_bounds<const> = function(statements, bounded)
	if not bounded then
		return
	end
	statements[#statements + 1] = local_statement(
		identifier('duration_ms'),
		target_member('duration_ms'),
		true
	)
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_not_equal,
				identifier('duration_ms'),
				nil_literal()
			),
			block({
				clamp_time_statement('previous_time_ms'),
				clamp_time_statement('time_ms'),
			})
		),
	})
end

local emit_direction<const> = function(statements)
	statements[#statements + 1] = local_statement(
		identifier('direction'),
		numeric_literal(0),
		false
	)
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_greater,
				identifier('time_ms'),
				identifier('previous_time_ms')
			),
			block({ assignment_statement(identifier('direction'), numeric_literal(1)) })
		),
		if_clause(
			binary_expression(
				syntax.binary_less,
				identifier('time_ms'),
				identifier('previous_time_ms')
			),
			block({ assignment_statement(identifier('direction'), numeric_literal(-1)) })
		),
	})
end

local emit_transport_captures<const> = child_transport_syntax.emit_captures
local emit_child_range<const> = child_transport_syntax.emit_range
local transform_parameters<const> = function(position, active)
	local parameters<const> = {
		identifier('target'),
		identifier('owner'),
		identifier('previous_parent_time_ms'),
		identifier('parent_time_ms'),
	}
	if position then
		parameters[#parameters + 1] = identifier('evaluate')
	end
	if not active then
		parameters[#parameters + 1] = identifier('initial')
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
	emit_transport_captures(statements, values)
	emit_child_range(
		statements,
		values,
		'previous_time_ms',
		'time_ms',
		values.direction,
		values.direction == 0,
		values.boundary_none
	)
	return transform_chunk(statements, values.direction == 0, values.active)
end

local emit_loop_position<const> = function(statements, values)
	emit_cyclic_captures(statements, values)
	emit_transport_captures(statements, values)
	statements[#statements + 1] = assignment_statement(
		instance_member('wrapped'),
		boolean_literal(false)
	)
	statements[#statements + 1] = local_statement(
		identifier('previous_time_ms'),
		binary_expression(
			syntax.binary_modulus,
			mapped_time_expression('previous_parent_time_ms', values.affine),
			identifier('duration_ms')
		),
		true
	)
	statements[#statements + 1] = local_statement(
		identifier('time_ms'),
		binary_expression(
			syntax.binary_modulus,
			mapped_time_expression('parent_time_ms', values.affine),
			identifier('duration_ms')
		),
		true
	)
	emit_direction(statements)
	emit_child_range(
		statements,
		values,
		'previous_time_ms',
		'time_ms',
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
			identifier('parent_time_ms'),
			identifier('previous_parent_time_ms')
		)
	else
		delta = binary_expression(
			syntax.binary_subtract,
			identifier('previous_parent_time_ms'),
			identifier('parent_time_ms')
		)
	end
	if values.affine == affine_identity or values.affine == affine_translation then
		return delta
	end
	return binary_expression(
		syntax.binary_multiply,
		delta,
		identifier('time_scale')
	)
end

local emit_loop_play<const> = function(statements, values)
	emit_cyclic_captures(statements, values)
	emit_transport_captures(statements, values)
	statements[#statements + 1] = assignment_statement(
		instance_member('wrapped'),
		boolean_literal(false)
	)
	if values.active then
		statements[#statements + 1] = local_statement(
			identifier('previous_time_ms'),
			instance_member('position_ms'),
			false
		)
	else
		statements[#statements + 1] = local_statement(identifier('previous_time_ms'), nil, false)
		statements[#statements + 1] = if_statement({
			if_clause(identifier('initial'), block({
				assignment_statement(
					identifier('previous_time_ms'),
					binary_expression(
						syntax.binary_modulus,
						mapped_time_expression('previous_parent_time_ms', values.affine),
						identifier('duration_ms')
					)
				),
			})),
			else_clause(block({
				assignment_statement(identifier('previous_time_ms'), instance_member('position_ms')),
			})),
		})
	end
	statements[#statements + 1] = local_statement(
		identifier('remaining_ms'),
		loop_delta_expression(values),
		false
	)
	statements[#statements + 1] = local_statement(
		identifier('evaluated'),
		boolean_literal(false),
		false
	)
	local initial_distance
	if values.direction > 0 then
		initial_distance = binary_expression(
			syntax.binary_subtract,
			identifier('duration_ms'),
			identifier('previous_time_ms')
		)
	else
		initial_distance = identifier('previous_time_ms')
	end
	statements[#statements + 1] = local_statement(
		identifier('distance_ms'),
		initial_distance,
		false
	)
	local loop_body<const> = {
		assignment_statement(
			identifier('remaining_ms'),
			binary_expression(
				syntax.binary_subtract,
				identifier('remaining_ms'),
				identifier('distance_ms')
			)
		),
		assignment_statement(instance_member('wrapped'), boolean_literal(true)),
	}
	local boundary_time
	if values.direction > 0 then
		boundary_time = numeric_literal(0)
	else
		boundary_time = identifier('duration_ms')
	end
	loop_body[#loop_body + 1] = local_statement(
		identifier('time_ms'),
		boundary_time,
		true
	)
	emit_child_range(
		loop_body,
		values,
		'previous_time_ms',
		'time_ms',
		values.direction,
		false,
		values.loop_boundary_flags
	)
	if not values.active then
		loop_body[#loop_body + 1] = assignment_statement(identifier('initial'), boolean_literal(false))
	end
	loop_body[#loop_body + 1] = assignment_statement(identifier('evaluated'), boolean_literal(true))
	loop_body[#loop_body + 1] = assignment_statement(
		identifier('previous_time_ms'),
		identifier('time_ms')
	)
	loop_body[#loop_body + 1] = assignment_statement(identifier('distance_ms'), identifier('duration_ms'))
	local loop_operator<const> = values.direction > 0
		and syntax.binary_greater_equal
		or syntax.binary_greater
	statements[#statements + 1] = while_statement(
		binary_expression(
			loop_operator,
			identifier('remaining_ms'),
			identifier('distance_ms')
		),
		block(loop_body)
	)
	local final_body<const> = {}
	local final_time
	if values.direction > 0 then
		final_time = binary_expression(
			syntax.binary_add,
			identifier('previous_time_ms'),
			identifier('remaining_ms')
		)
	else
		final_time = binary_expression(
			syntax.binary_subtract,
			identifier('previous_time_ms'),
			identifier('remaining_ms')
		)
	end
	final_body[#final_body + 1] = local_statement(identifier('time_ms'), final_time, true)
	emit_child_range(
		final_body,
		values,
		'previous_time_ms',
		'time_ms',
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
					identifier('remaining_ms'),
					numeric_literal(0)
				),
				unary_expression(syntax.unary_not, identifier('evaluated'))
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

local emit_pingpong_time<const> = function(statements, values, parent_time_name, phase_name, time_name)
	statements[#statements + 1] = local_statement(
		identifier(phase_name),
		binary_expression(
			syntax.binary_modulus,
			mapped_time_expression(parent_time_name, values.affine),
			identifier('period_ms')
		),
		true
	)
	statements[#statements + 1] = local_statement(identifier(time_name), nil, false)
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_less_equal,
				identifier(phase_name),
				identifier('duration_ms')
			),
			block({ assignment_statement(identifier(time_name), identifier(phase_name)) })
		),
		else_clause(block({
			assignment_statement(
				identifier(time_name),
				binary_expression(
					syntax.binary_subtract,
					identifier('period_ms'),
					identifier(phase_name)
				)
			),
		})),
	})
end

local emit_pingpong_position<const> = function(statements, values)
	emit_cyclic_captures(statements, values)
	emit_transport_captures(statements, values)
	statements[#statements + 1] = local_statement(
		identifier('period_ms'),
		binary_expression(
			syntax.binary_multiply,
			identifier('duration_ms'),
			numeric_literal(2)
		),
		true
	)
	emit_pingpong_time(
		statements,
		values,
		'previous_parent_time_ms',
		'previous_phase_ms',
		'previous_time_ms'
	)
	emit_pingpong_time(statements, values, 'parent_time_ms', 'phase_ms', 'time_ms')
	emit_direction(statements)
	emit_child_range(
		statements,
		values,
		'previous_time_ms',
		'time_ms',
		0,
		true,
		values.boundary_none
	)
end

local emit_pingpong_initial_segment<const> = function(statements, backward)
	statements[#statements + 1] = local_statement(
		identifier('cursor_ms'),
		identifier('previous_time_ms'),
		false
	)
	statements[#statements + 1] = local_statement(
		identifier('segment'),
		binary_expression(
			syntax.binary_floor_divide,
			identifier('cursor_ms'),
			identifier('duration_ms')
		),
		not backward
	)
	statements[#statements + 1] = local_statement(
		identifier('segment_start_ms'),
		binary_expression(
			syntax.binary_multiply,
			identifier('segment'),
			identifier('duration_ms')
		),
		not backward
	)
	statements[#statements + 1] = local_statement(
		identifier('segment_offset_ms'),
		binary_expression(
			syntax.binary_subtract,
			identifier('cursor_ms'),
			identifier('segment_start_ms')
		),
		not backward
	)
	if backward then
		statements[#statements + 1] = if_statement({
			if_clause(
				binary_expression(
					syntax.binary_equal,
					identifier('segment_offset_ms'),
					numeric_literal(0)
				),
				block({
					assignment_statement(
						identifier('segment'),
						binary_expression(
							syntax.binary_subtract,
							identifier('segment'),
							numeric_literal(1)
						)
					),
					assignment_statement(
						identifier('segment_start_ms'),
						binary_expression(
							syntax.binary_subtract,
							identifier('segment_start_ms'),
							identifier('duration_ms')
						)
					),
					assignment_statement(identifier('segment_offset_ms'), identifier('duration_ms')),
				})
			),
		})
	end
	statements[#statements + 1] = local_statement(identifier('previous_local_ms'), nil, false)
	statements[#statements + 1] = local_statement(identifier('direction'), nil, false)
	local even_direction<const> = backward and -1 or 1
	local odd_direction<const> = -even_direction
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_equal,
				binary_expression(
					syntax.binary_bitwise_and,
					identifier('segment'),
					numeric_literal(1)
				),
				numeric_literal(0)
			),
			block({
				assignment_statement(identifier('previous_local_ms'), identifier('segment_offset_ms')),
				assignment_statement(identifier('direction'), numeric_literal(even_direction)),
			})
		),
		else_clause(block({
			assignment_statement(
				identifier('previous_local_ms'),
				binary_expression(
					syntax.binary_subtract,
					identifier('duration_ms'),
					identifier('segment_offset_ms')
				)
			),
			assignment_statement(identifier('direction'), numeric_literal(odd_direction)),
		})),
	})
end

local emit_pingpong_play<const> = function(statements, values)
	local backward<const> = values.direction < 0
	emit_cyclic_captures(statements, values)
	emit_transport_captures(statements, values)
	statements[#statements + 1] = local_statement(
		identifier('previous_time_ms'),
		mapped_time_expression('previous_parent_time_ms', values.affine),
		true
	)
	statements[#statements + 1] = local_statement(
		identifier('time_ms'),
		mapped_time_expression('parent_time_ms', values.affine),
		true
	)
	emit_pingpong_initial_segment(statements, backward)
	local boundary_initial
	if backward then
		boundary_initial = identifier('segment_start_ms')
	else
		boundary_initial = binary_expression(
			syntax.binary_add,
			identifier('segment_start_ms'),
			identifier('duration_ms')
		)
	end
	statements[#statements + 1] = local_statement(
		identifier('boundary_ms'),
		boundary_initial,
		false
	)
	local loop_body<const> = {
		local_statement(identifier('local_time_ms'), numeric_literal(0), false),
		if_statement({
			if_clause(
				binary_expression(
					syntax.binary_greater,
					identifier('direction'),
					numeric_literal(0)
				),
				block({
					assignment_statement(identifier('local_time_ms'), identifier('duration_ms')),
				})
			),
		}),
	}
	emit_child_range(
		loop_body,
		values,
		'previous_local_ms',
		'local_time_ms',
		0,
		true,
		values.boundary_turn
	)
	if not values.active then
		loop_body[#loop_body + 1] = assignment_statement(identifier('initial'), boolean_literal(false))
	end
	loop_body[#loop_body + 1] = assignment_statement(identifier('cursor_ms'), identifier('boundary_ms'))
	loop_body[#loop_body + 1] = assignment_statement(identifier('previous_local_ms'), identifier('local_time_ms'))
	loop_body[#loop_body + 1] = assignment_statement(
		identifier('direction'),
		unary_expression(syntax.unary_negate, identifier('direction'))
	)
	local boundary_step_operator<const> = backward and syntax.binary_subtract or syntax.binary_add
	loop_body[#loop_body + 1] = assignment_statement(
		identifier('boundary_ms'),
		binary_expression(
			boundary_step_operator,
			identifier('boundary_ms'),
			identifier('duration_ms')
		)
	)
	local loop_comparison<const> = backward and syntax.binary_greater_equal or syntax.binary_less_equal
	statements[#statements + 1] = while_statement(
		binary_expression(
			loop_comparison,
			identifier('boundary_ms'),
			identifier('time_ms')
		),
		block(loop_body)
	)
	local final_body<const> = {}
	local distance
	if backward then
		distance = binary_expression(
			syntax.binary_subtract,
			identifier('cursor_ms'),
			identifier('time_ms')
		)
	else
		distance = binary_expression(
			syntax.binary_subtract,
			identifier('time_ms'),
			identifier('cursor_ms')
		)
	end
	final_body[#final_body + 1] = local_statement(
		identifier('local_time_ms'),
		binary_expression(
			syntax.binary_add,
			identifier('previous_local_ms'),
			binary_expression(
				syntax.binary_multiply,
				distance,
				identifier('direction')
			)
		),
		true
	)
	emit_child_range(
		final_body,
		values,
		'previous_local_ms',
		'local_time_ms',
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
					identifier('cursor_ms'),
					identifier('time_ms')
				),
				binary_expression(
					syntax.binary_equal,
					identifier('cursor_ms'),
					identifier('previous_time_ms')
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
