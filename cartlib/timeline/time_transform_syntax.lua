-- Admission-only lowering for straight-line once clips. The compiled function
-- maps parent time and commits the child transport in one datapath; cyclic
-- clips retain their boundary traversal in time_transform.lua.
local syntax_factory<const> = lua_compiler.syntax_factory

local time_transform_syntax<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local numeric_literal<const> = syntax_factory.number_literal
local nil_literal<const> = syntax_factory.nil_literal
local member_expression<const> = syntax_factory.member_expression
local call_expression<const> = syntax_factory.call_expression
local binary_expression<const> = syntax_factory.binary_expression
local function_expression<const> = syntax_factory.function_expression
local assignment_statement<const> = syntax_factory.assignment_statement
local local_statement<const> = syntax_factory.local_statement
local call_statement<const> = syntax_factory.call_statement
local if_clause<const> = syntax_factory.if_clause
local if_statement<const> = syntax_factory.if_statement
local return_statement<const> = syntax_factory.return_statement

local affine_identity<const> = 0
local affine_translation<const> = 1

local target_member<const> = function(name)
	return member_expression(identifier('target'), name)
end

local instance_member<const> = function(name)
	return member_expression(identifier('instance'), name)
end

local program_member<const> = function(name)
	return member_expression(identifier('program'), name)
end

local emit_time_mapping<const> = function(statements, values)
	local previous_parent_time<const> = identifier('previous_parent_time_ms')
	local parent_time<const> = identifier('parent_time_ms')
	local previous_time
	local time
	if values.affine == affine_identity then
		previous_time = previous_parent_time
		time = parent_time
	elseif values.affine == affine_translation then
		statements[#statements + 1] = local_statement(
			identifier('time_offset_ms'),
			member_expression(target_member('clip'), 'time_offset_ms'),
			true
		)
		previous_time = binary_expression(
			syntax.binary_add,
			previous_parent_time,
			identifier('time_offset_ms')
		)
		time = binary_expression(
			syntax.binary_add,
			parent_time,
			identifier('time_offset_ms')
		)
	else
		statements[#statements + 1] = local_statement(
			identifier('clip'),
			target_member('clip'),
			true
		)
		statements[#statements + 1] = local_statement(
			identifier('time_scale'),
			member_expression(identifier('clip'), 'time_scale'),
			true
		)
		statements[#statements + 1] = local_statement(
			identifier('time_offset_ms'),
			member_expression(identifier('clip'), 'time_offset_ms'),
			true
		)
		previous_time = binary_expression(
			syntax.binary_add,
			binary_expression(
				syntax.binary_multiply,
				previous_parent_time,
				identifier('time_scale')
			),
			identifier('time_offset_ms')
		)
		time = binary_expression(
			syntax.binary_add,
			binary_expression(
				syntax.binary_multiply,
				parent_time,
				identifier('time_scale')
			),
			identifier('time_offset_ms')
		)
	end
	statements[#statements + 1] = local_statement(
		identifier('previous_time_ms'),
		previous_time,
		not values.bounded
	)
	statements[#statements + 1] = local_statement(
		identifier('time_ms'),
		time,
		not values.bounded
	)
end

local clamp_time_statements<const> = function(name)
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
				clamp_time_statements('previous_time_ms'),
				clamp_time_statements('time_ms'),
			})
		),
	})
end

local emit_direction<const> = function(statements, direction)
	if direction ~= 0 then
		return
	end
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

local direction_expression<const> = function(direction)
	if direction == 0 then
		return identifier('direction')
	end
	return numeric_literal(direction)
end

local evaluator_expression<const> = function(statements, position)
	if position then
		return identifier('evaluate')
	end
	statements[#statements + 1] = local_statement(
		identifier('evaluate'),
		target_member('play_evaluator'),
		true
	)
	return identifier('evaluate')
end

local emit_continuous_write<const> = function(statements, values)
	statements[#statements + 1] = local_statement(
		identifier('instance'),
		target_member('instance'),
		true
	)
	local evaluate<const> = evaluator_expression(statements, values.direction == 0)
	statements[#statements + 1] = local_statement(
		identifier('flags'),
		numeric_literal(values.sample_flag),
		false
	)
	statements[#statements + 1] = if_statement({
		if_clause(identifier('initial'), block({
			assignment_statement(instance_member('head'), numeric_literal(0)),
			assignment_statement(
				identifier('flags'),
				numeric_literal(values.sample_flag | values.initial_flag)
			),
		})),
	})
	statements[#statements + 1] = assignment_statement(
		instance_member('position_ms'),
		identifier('time_ms')
	)
	statements[#statements + 1] = assignment_statement(
		instance_member('direction'),
		direction_expression(values.direction)
	)
	statements[#statements + 1] = call_statement(call_expression(evaluate, {
		identifier('target'),
		identifier('owner'),
		numeric_literal(0),
		numeric_literal(0),
		identifier('previous_time_ms'),
		identifier('time_ms'),
		direction_expression(values.direction),
		identifier('flags'),
	}))
end

local emit_frame_write<const> = function(statements, values)
	statements[#statements + 1] = local_statement(
		identifier('instance'),
		target_member('instance'),
		true
	)
	local evaluate<const> = evaluator_expression(statements, values.direction == 0)
	statements[#statements + 1] = local_statement(
		identifier('program'),
		instance_member('program'),
		true
	)
	statements[#statements + 1] = local_statement(
		identifier('frame_duration'),
		program_member('frame_duration'),
		true
	)
	statements[#statements + 1] = local_statement(
		identifier('last_frame'),
		program_member('last_frame'),
		true
	)
	statements[#statements + 1] = local_statement(
		identifier('previous_frame'),
		instance_member('head'),
		false
	)
	statements[#statements + 1] = if_statement({
		if_clause(identifier('initial'), block({
			assignment_statement(
				identifier('previous_frame'),
				binary_expression(
					syntax.binary_floor_divide,
					identifier('previous_time_ms'),
					identifier('frame_duration')
				)
			),
			if_statement({
				if_clause(
					binary_expression(
						syntax.binary_greater,
						identifier('previous_frame'),
						identifier('last_frame')
					),
					block({
						assignment_statement(
							identifier('previous_frame'),
							identifier('last_frame')
						),
					})
				),
			}),
		})),
	})
	statements[#statements + 1] = local_statement(
		identifier('frame'),
		binary_expression(
			syntax.binary_floor_divide,
			identifier('time_ms'),
			identifier('frame_duration')
		),
		false
	)
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_greater,
				identifier('frame'),
				identifier('last_frame')
			),
			block({
				assignment_statement(identifier('frame'), identifier('last_frame')),
			})
		),
	})
	statements[#statements + 1] = assignment_statement(instance_member('head'), identifier('frame'))
	statements[#statements + 1] = assignment_statement(
		instance_member('frame_elapsed'),
		binary_expression(
			syntax.binary_subtract,
			identifier('time_ms'),
			binary_expression(
				syntax.binary_multiply,
				identifier('frame'),
				identifier('frame_duration')
			)
		)
	)
	statements[#statements + 1] = assignment_statement(
		instance_member('position_ms'),
		identifier('time_ms')
	)
	statements[#statements + 1] = assignment_statement(
		instance_member('direction'),
		direction_expression(values.direction)
	)
	statements[#statements + 1] = local_statement(
		identifier('flags'),
		numeric_literal(0),
		false
	)
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_or,
				identifier('initial'),
				binary_expression(
					syntax.binary_not_equal,
					identifier('frame'),
					identifier('previous_frame')
				)
			),
			block({
				assignment_statement(identifier('flags'), numeric_literal(values.sample_flag)),
			})
		),
	})
	statements[#statements + 1] = if_statement({
		if_clause(identifier('initial'), block({
			assignment_statement(
				identifier('flags'),
				numeric_literal(values.sample_flag | values.initial_flag)
			),
		})),
	})
	statements[#statements + 1] = call_statement(call_expression(evaluate, {
		identifier('target'),
		identifier('owner'),
		identifier('previous_frame'),
		identifier('frame'),
		identifier('previous_time_ms'),
		identifier('time_ms'),
		direction_expression(values.direction),
		identifier('flags'),
	}))
end

function time_transform_syntax.build(values)
	local statements<const> = {}
	emit_time_mapping(statements, values)
	emit_bounds(statements, values.bounded)
	emit_direction(statements, values.direction)
	if values.continuous then
		emit_continuous_write(statements, values)
	else
		emit_frame_write(statements, values)
	end
	local parameters<const> = {
		identifier('target'),
		identifier('owner'),
		identifier('previous_parent_time_ms'),
		identifier('parent_time_ms'),
	}
	if values.direction == 0 then
		parameters[#parameters + 1] = identifier('evaluate')
	end
	parameters[#parameters + 1] = identifier('initial')
	return syntax_factory.chunk(block({
		return_statement({ function_expression(parameters, block(statements)) }),
	}))
end

return time_transform_syntax
