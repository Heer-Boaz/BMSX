-- Admission-only lowering for nested child transport commits. Time transforms
-- compose these statements directly, so playback has no writer dispatch and
-- authored child timing/callback capabilities do not branch in the hot path.
local syntax_factory<const> = lua_compiler.syntax_factory

local child_transport_syntax<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local numeric_literal<const> = syntax_factory.number_literal
local member_expression<const> = syntax_factory.member_expression
local call_expression<const> = syntax_factory.call_expression
local binary_expression<const> = syntax_factory.binary_expression
local assignment_statement<const> = syntax_factory.assignment_statement
local local_statement<const> = syntax_factory.local_statement
local call_statement<const> = syntax_factory.call_statement
local if_clause<const> = syntax_factory.if_clause
local if_statement<const> = syntax_factory.if_statement

local target_member<const> = function(name)
	return member_expression(identifier('target'), name)
end

local program_member<const> = function(name)
	return member_expression(identifier('program'), name)
end

function child_transport_syntax.emit_captures(statements, values)
	if not values.position then
		statements[#statements + 1] = local_statement(
			identifier('evaluate'),
			target_member('evaluate_play'),
			true
		)
	end
	if not values.continuous
	or (values.has_boundary_callback and not values.has_evaluation_callbacks) then
		statements[#statements + 1] = local_statement(
			identifier('program'),
			target_member('program'),
			true
		)
	end
	if not values.continuous then
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
	end
end

local direction_expression<const> = function(direction, dynamic_direction)
	if dynamic_direction then
		return identifier('direction')
	end
	return numeric_literal(direction)
end

local emit_boundary_callback<const> = function(
	statements,
	values,
	previous_frame_name,
	frame_name,
	previous_time_name,
	time_name,
	direction,
	dynamic_direction
)
	if not values.has_boundary_callback then
		return
	end
	statements[#statements + 1] = local_statement(
		identifier('context'),
		target_member('evaluation_context'),
		true
	)
	if not values.has_evaluation_callbacks then
		local previous_frame
		local frame
		if previous_frame_name == nil then
			previous_frame = numeric_literal(0)
			frame = numeric_literal(0)
		else
			previous_frame = identifier(previous_frame_name)
			frame = identifier(frame_name)
		end
		statements[#statements + 1] = call_statement(call_expression(
			identifier('write_evaluation_context'),
			{
				identifier('context'),
				identifier('program'),
				numeric_literal(values.play_method),
				previous_frame,
				frame,
				identifier(previous_time_name),
				identifier(time_name),
				direction_expression(direction, dynamic_direction),
				binary_expression(
					syntax.binary_not_equal,
					binary_expression(
						syntax.binary_bitwise_and,
						identifier('flags'),
						numeric_literal(values.sample_flag)
					),
					numeric_literal(0)
				),
				identifier('flags'),
			}
		))
	end
	statements[#statements + 1] = call_statement(call_expression(
		member_expression(identifier('clip'), values.boundary_callback_member),
		{
			target_member('primary_binding'),
			identifier('context'),
		}
	))
end

local emit_continuous_range<const> = function(
	statements,
	values,
	previous_time_name,
	time_name,
	direction,
	dynamic_direction,
	range_flags
)
	if values.active then
		statements[#statements + 1] = local_statement(
			identifier('flags'),
			numeric_literal(range_flags | values.sample_flag),
			true
		)
	else
		statements[#statements + 1] = local_statement(
			identifier('flags'),
			numeric_literal(range_flags | values.sample_flag),
			false
		)
		statements[#statements + 1] = if_statement({
			if_clause(identifier('initial'), block({
				assignment_statement(target_member('head'), numeric_literal(0)),
				assignment_statement(
					identifier('flags'),
					numeric_literal(range_flags | values.sample_flag | values.initial_flag)
				),
			})),
		})
	end
	statements[#statements + 1] = assignment_statement(
		target_member('position_ms'),
		identifier(time_name)
	)
	statements[#statements + 1] = assignment_statement(
		target_member('direction'),
		direction_expression(direction, dynamic_direction)
	)
	statements[#statements + 1] = call_statement(call_expression(identifier('evaluate'), {
		identifier('target'),
		identifier('owner'),
		numeric_literal(0),
		numeric_literal(0),
		identifier(previous_time_name),
		identifier(time_name),
		direction_expression(direction, dynamic_direction),
		identifier('flags'),
	}))
	if range_flags ~= values.boundary_none then
		emit_boundary_callback(
			statements,
			values,
			nil,
			nil,
			previous_time_name,
			time_name,
			direction,
			dynamic_direction
		)
	end
end

local emit_frame_range<const> = function(
	statements,
	values,
	previous_time_name,
	time_name,
	direction,
	dynamic_direction,
	range_flags
)
	statements[#statements + 1] = local_statement(
		identifier('previous_frame'),
		target_member('head'),
		values.active
	)
	if not values.active then
		statements[#statements + 1] = if_statement({
			if_clause(identifier('initial'), block({
				assignment_statement(
					identifier('previous_frame'),
					binary_expression(
						syntax.binary_floor_divide,
						identifier(previous_time_name),
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
	end
	statements[#statements + 1] = local_statement(
		identifier('frame'),
		binary_expression(
			syntax.binary_floor_divide,
			identifier(time_name),
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
			block({ assignment_statement(identifier('frame'), identifier('last_frame')) })
		),
	})
	statements[#statements + 1] = assignment_statement(target_member('head'), identifier('frame'))
	statements[#statements + 1] = assignment_statement(
		target_member('frame_elapsed'),
		binary_expression(
			syntax.binary_subtract,
			identifier(time_name),
			binary_expression(
				syntax.binary_multiply,
				identifier('frame'),
				identifier('frame_duration')
			)
		)
	)
	statements[#statements + 1] = assignment_statement(
		target_member('position_ms'),
		identifier(time_name)
	)
	statements[#statements + 1] = assignment_statement(
		target_member('direction'),
		direction_expression(direction, dynamic_direction)
	)
	statements[#statements + 1] = local_statement(
		identifier('flags'),
		numeric_literal(range_flags),
		false
	)
	local frame_changed<const> = binary_expression(
		syntax.binary_not_equal,
		identifier('frame'),
		identifier('previous_frame')
	)
	local sample = frame_changed
	if not values.active then
		sample = binary_expression(syntax.binary_or, identifier('initial'), frame_changed)
	end
	statements[#statements + 1] = if_statement({
		if_clause(sample, block({
			assignment_statement(
				identifier('flags'),
				numeric_literal(range_flags | values.sample_flag)
			),
		})),
	})
	if not values.active then
		statements[#statements + 1] = if_statement({
			if_clause(identifier('initial'), block({
				assignment_statement(
					identifier('flags'),
					numeric_literal(range_flags | values.sample_flag | values.initial_flag)
				),
			})),
		})
	end
	statements[#statements + 1] = call_statement(call_expression(identifier('evaluate'), {
		identifier('target'),
		identifier('owner'),
		identifier('previous_frame'),
		identifier('frame'),
		identifier(previous_time_name),
		identifier(time_name),
		direction_expression(direction, dynamic_direction),
		identifier('flags'),
	}))
	if range_flags ~= values.boundary_none then
		emit_boundary_callback(
			statements,
			values,
			'previous_frame',
			'frame',
			previous_time_name,
			time_name,
			direction,
			dynamic_direction
		)
	end
end

function child_transport_syntax.emit_range(
	statements,
	values,
	previous_time_name,
	time_name,
	direction,
	dynamic_direction,
	range_flags
)
	if values.continuous then
		emit_continuous_range(
			statements,
			values,
			previous_time_name,
			time_name,
			direction,
			dynamic_direction,
			range_flags
		)
	else
		emit_frame_range(
			statements,
			values,
			previous_time_name,
			time_name,
			direction,
			dynamic_direction,
			range_flags
		)
	end
end

return child_transport_syntax
