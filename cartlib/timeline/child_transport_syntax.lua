-- Admission-only lowering for nested child transport commits. Time transforms
-- compose these statements directly, so playback has no writer dispatch and
-- authored child timing/callback capabilities do not branch in the hot path.
local syntax_factory<const> = lua_compiler.syntax_factory

local child_transport_syntax<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local reference<const> = syntax_factory.reference
local numeric_literal<const> = syntax_factory.number_literal
local member_expression<const> = syntax_factory.member_expression
local call_expression<const> = syntax_factory.call_expression
local binary_expression<const> = syntax_factory.binary_expression
local assignment_statement<const> = syntax_factory.assignment_statement
local local_statement<const> = syntax_factory.local_statement
local call_statement<const> = syntax_factory.call_statement
local if_clause<const> = syntax_factory.if_clause
local if_statement<const> = syntax_factory.if_statement

local target_member<const> = function(symbols, name)
	return member_expression(reference(symbols.target), name)
end

local program_member<const> = function(symbols, name)
	return member_expression(reference(symbols.program), name)
end

function child_transport_syntax.emit_captures(statements, values, symbols)
	if not values.position then
		statements[#statements + 1] = local_statement(
			reference(symbols.evaluate),
			target_member(symbols, 'evaluate_play'),
			true
		)
	end
	if not values.continuous
	or (values.has_boundary_callback and not values.has_evaluation_callbacks) then
		statements[#statements + 1] = local_statement(
			reference(symbols.program),
			target_member(symbols, 'program'),
			true
		)
	end
	if not values.continuous then
		statements[#statements + 1] = local_statement(
			reference(symbols.frame_duration),
			program_member(symbols, 'frame_duration'),
			true
		)
		statements[#statements + 1] = local_statement(
			reference(symbols.last_frame),
			program_member(symbols, 'last_frame'),
			true
		)
	end
end

local direction_expression<const> = function(direction, dynamic_direction, symbols)
	if dynamic_direction then
		return reference(symbols.direction)
	end
	return numeric_literal(direction)
end

local emit_boundary_callback<const> = function(
	statements,
	values,
	symbols,
	previous_frame_symbol,
	frame_symbol,
	previous_time_symbol,
	time_symbol,
	direction,
	dynamic_direction
)
	if not values.has_boundary_callback then
		return
	end
	statements[#statements + 1] = local_statement(
		reference(symbols.context),
		target_member(symbols, 'evaluation_context'),
		true
	)
	if not values.has_evaluation_callbacks then
		local previous_frame
		local frame
		if previous_frame_symbol == nil then
			previous_frame = numeric_literal(0)
			frame = numeric_literal(0)
		else
			previous_frame = reference(previous_frame_symbol)
			frame = reference(frame_symbol)
		end
		statements[#statements + 1] = call_statement(call_expression(
			identifier('write_evaluation_context'),
			{
				reference(symbols.context),
				reference(symbols.program),
				numeric_literal(values.play_method),
				previous_frame,
				frame,
				reference(previous_time_symbol),
				reference(time_symbol),
				direction_expression(direction, dynamic_direction, symbols),
				binary_expression(
					syntax.binary_not_equal,
					binary_expression(
						syntax.binary_bitwise_and,
						reference(symbols.flags),
						numeric_literal(values.sample_flag)
					),
					numeric_literal(0)
				),
				reference(symbols.flags),
			}
		))
	end
	statements[#statements + 1] = call_statement(call_expression(
		member_expression(reference(symbols.clip), values.boundary_callback_member),
		{
			target_member(symbols, 'primary_binding'),
			reference(symbols.context),
		}
	))
end

local emit_continuous_range<const> = function(
	statements,
	values,
	symbols,
	previous_time_symbol,
	time_symbol,
	direction,
	dynamic_direction,
	range_flags
)
	if values.active then
		statements[#statements + 1] = local_statement(
			reference(symbols.flags),
			numeric_literal(range_flags | values.sample_flag),
			true
		)
	else
		statements[#statements + 1] = local_statement(
			reference(symbols.flags),
			numeric_literal(range_flags | values.sample_flag),
			false
		)
		statements[#statements + 1] = if_statement({
			if_clause(reference(symbols.initial), block({
				assignment_statement(target_member(symbols, 'head'), numeric_literal(0)),
				assignment_statement(
					reference(symbols.flags),
					numeric_literal(range_flags | values.sample_flag | values.initial_flag)
				),
			})),
		})
	end
	statements[#statements + 1] = assignment_statement(
		target_member(symbols, 'position_ms'),
		reference(time_symbol)
	)
	statements[#statements + 1] = assignment_statement(
		target_member(symbols, 'direction'),
		direction_expression(direction, dynamic_direction, symbols)
	)
	statements[#statements + 1] = call_statement(call_expression(reference(symbols.evaluate), {
		reference(symbols.target),
		reference(symbols.owner),
		numeric_literal(0),
		numeric_literal(0),
		reference(previous_time_symbol),
		reference(time_symbol),
		direction_expression(direction, dynamic_direction, symbols),
		reference(symbols.flags),
	}))
	if range_flags ~= values.boundary_none then
			emit_boundary_callback(
				statements,
				values,
				symbols,
				nil,
				nil,
				previous_time_symbol,
				time_symbol,
				direction,
				dynamic_direction
		)
	end
end

local emit_frame_range<const> = function(
	statements,
	values,
	symbols,
	previous_time_symbol,
	time_symbol,
	direction,
	dynamic_direction,
	range_flags
)
	statements[#statements + 1] = local_statement(
		reference(symbols.previous_frame),
		target_member(symbols, 'head'),
		values.active
	)
	if not values.active then
		statements[#statements + 1] = if_statement({
			if_clause(reference(symbols.initial), block({
				assignment_statement(
					reference(symbols.previous_frame),
					binary_expression(
						syntax.binary_floor_divide,
						reference(previous_time_symbol),
						reference(symbols.frame_duration)
					)
				),
				if_statement({
					if_clause(
						binary_expression(
							syntax.binary_greater,
							reference(symbols.previous_frame),
							reference(symbols.last_frame)
						),
						block({
							assignment_statement(
								reference(symbols.previous_frame),
								reference(symbols.last_frame)
							),
						})
					),
				}),
			})),
		})
	end
	statements[#statements + 1] = local_statement(
		reference(symbols.frame),
		binary_expression(
			syntax.binary_floor_divide,
			reference(time_symbol),
			reference(symbols.frame_duration)
		),
		false
	)
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_greater,
				reference(symbols.frame),
				reference(symbols.last_frame)
			),
			block({ assignment_statement(reference(symbols.frame), reference(symbols.last_frame)) })
		),
	})
	statements[#statements + 1] = assignment_statement(
		target_member(symbols, 'head'),
		reference(symbols.frame)
	)
	statements[#statements + 1] = assignment_statement(
		target_member(symbols, 'frame_elapsed'),
		binary_expression(
			syntax.binary_subtract,
			reference(time_symbol),
			binary_expression(
				syntax.binary_multiply,
				reference(symbols.frame),
				reference(symbols.frame_duration)
			)
		)
	)
	statements[#statements + 1] = assignment_statement(
		target_member(symbols, 'position_ms'),
		reference(time_symbol)
	)
	statements[#statements + 1] = assignment_statement(
		target_member(symbols, 'direction'),
		direction_expression(direction, dynamic_direction, symbols)
	)
	statements[#statements + 1] = local_statement(
		reference(symbols.flags),
		numeric_literal(range_flags),
		false
	)
	local frame_changed<const> = binary_expression(
		syntax.binary_not_equal,
		reference(symbols.frame),
		reference(symbols.previous_frame)
	)
	local sample = frame_changed
	if not values.active then
		sample = binary_expression(syntax.binary_or, reference(symbols.initial), frame_changed)
	end
	statements[#statements + 1] = if_statement({
		if_clause(sample, block({
			assignment_statement(
				reference(symbols.flags),
				numeric_literal(range_flags | values.sample_flag)
			),
		})),
	})
	if not values.active then
		statements[#statements + 1] = if_statement({
			if_clause(reference(symbols.initial), block({
				assignment_statement(
					reference(symbols.flags),
					numeric_literal(range_flags | values.sample_flag | values.initial_flag)
				),
			})),
		})
	end
	statements[#statements + 1] = call_statement(call_expression(reference(symbols.evaluate), {
		reference(symbols.target),
		reference(symbols.owner),
		reference(symbols.previous_frame),
		reference(symbols.frame),
		reference(previous_time_symbol),
		reference(time_symbol),
		direction_expression(direction, dynamic_direction, symbols),
		reference(symbols.flags),
	}))
	if range_flags ~= values.boundary_none then
		emit_boundary_callback(
			statements,
			values,
			symbols,
			symbols.previous_frame,
			symbols.frame,
			previous_time_symbol,
			time_symbol,
			direction,
			dynamic_direction
		)
	end
end

function child_transport_syntax.emit_range(
	statements,
	values,
	symbols,
	previous_time_symbol,
	time_symbol,
	direction,
	dynamic_direction,
	range_flags
)
	if values.continuous then
		emit_continuous_range(
			statements,
			values,
			symbols,
			previous_time_symbol,
			time_symbol,
			direction,
			dynamic_direction,
			range_flags
		)
	else
		emit_frame_range(
			statements,
			values,
			symbols,
			previous_time_symbol,
			time_symbol,
			direction,
			dynamic_direction,
			range_flags
		)
	end
end

return child_transport_syntax
