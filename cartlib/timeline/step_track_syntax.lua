-- Admission-only lowering for step-track traversal. Playback receives the
-- monotone cursor datapath; positioning reconstructs the destination state.
local syntax_factory<const> = lua_compiler.syntax_factory

local step_track_syntax<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local numeric_literal<const> = syntax_factory.number_literal
local nil_literal<const> = syntax_factory.nil_literal
local member_expression<const> = syntax_factory.member_expression
local index_expression<const> = syntax_factory.index_expression
local call_expression<const> = syntax_factory.call_expression
local binary_expression<const> = syntax_factory.binary_expression
local assignment_statement<const> = syntax_factory.assignment_statement
local local_statement<const> = syntax_factory.local_statement
local call_statement<const> = syntax_factory.call_statement
local if_clause<const> = syntax_factory.if_clause
local else_clause<const> = syntax_factory.else_clause
local if_statement<const> = syntax_factory.if_statement
local while_statement<const> = syntax_factory.while_statement
local numeric_for_statement<const> = syntax_factory.numeric_for_statement

function step_track_syntax.emit_dependency_captures(statements, values)
	if values.has_frame_steps then
		statements[#statements + 1] = local_statement(
			identifier('apply_step_bucket'),
			identifier('apply_step_bucket'),
			true
		)
		statements[#statements + 1] = local_statement(
			identifier('sample_step_tracks'),
			identifier('sample_step_tracks'),
			true
		)
	end
	if values.has_time_steps then
		statements[#statements + 1] = local_statement(
			identifier('sample_time_step_tracks'),
			identifier('sample_time_step_tracks'),
			true
		)
	end
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

local emit_position_frame_steps<const> = function(statements, values)
	statements[#statements + 1] = if_statement({
		if_clause(
			flag_set_expression(values.sample_flag),
			block({
				call_statement(call_expression(identifier('sample_step_tracks'), {
					identifier('entry'),
					identifier('steps'),
					identifier('frame'),
					identifier('params'),
					identifier('evaluation'),
				})),
			})
		),
	})
end

local emit_play_frame_steps<const> = function(statements, values)
	local sample_body<const> = {}
	local discontinuity<const> = binary_expression(
		syntax.binary_or,
		binary_expression(
			syntax.binary_or,
			flag_set_expression(values.reset_step_flags),
			binary_expression(
				syntax.binary_greater,
				identifier('frame'),
				binary_expression(
					syntax.binary_add,
					identifier('previous_frame'),
					numeric_literal(1)
				)
			)
		),
		binary_expression(
			syntax.binary_less,
			identifier('frame'),
			binary_expression(
				syntax.binary_subtract,
				identifier('previous_frame'),
				numeric_literal(1)
			)
		)
	)
	sample_body[#sample_body + 1] = if_statement({
		if_clause(
			discontinuity,
			block({
				call_statement(call_expression(identifier('sample_step_tracks'), {
					identifier('entry'),
					identifier('steps'),
					identifier('frame'),
					identifier('params'),
					identifier('evaluation'),
				})),
			})
		),
		if_clause(
			binary_expression(
				syntax.binary_greater,
				identifier('direction'),
				numeric_literal(0)
			),
			block({
				call_statement(call_expression(identifier('apply_step_bucket'), {
					identifier('entry'),
					index_expression(
						member_expression(identifier('steps'), 'by_frame'),
						identifier('frame')
					),
					identifier('params'),
					identifier('evaluation'),
				})),
			})
		),
		if_clause(
			binary_expression(
				syntax.binary_less,
				identifier('direction'),
				numeric_literal(0)
			),
			block({
				call_statement(call_expression(identifier('apply_step_bucket'), {
					identifier('entry'),
					index_expression(
						member_expression(identifier('steps'), 'reverse_by_frame'),
						identifier('previous_frame')
					),
					identifier('params'),
					identifier('evaluation'),
				})),
			})
		),
	})
	statements[#statements + 1] = if_statement({
		if_clause(flag_set_expression(values.sample_flag), block(sample_body)),
	})
end

local apply_time_boundary_state_statements<const> = function()
	return {
		local_statement(
			identifier('state'),
			member_expression(identifier('steps'), 'end_time_step_state'),
			false
		),
		if_statement({
			if_clause(
				binary_expression(
					syntax.binary_equal,
					identifier('time_ms'),
					numeric_literal(0)
				),
				block({
					assignment_statement(
						identifier('state'),
						member_expression(identifier('steps'), 'start_time_step_state')
					),
				})
			),
		}),
		local_statement(
			identifier('keys'),
			member_expression(identifier('state'), 'keys'),
			true
		),
		numeric_for_statement(
			identifier('index'),
			numeric_literal(1),
			member_expression(identifier('state'), 'key_count'),
			nil,
			block({
				local_statement(
					identifier('key'),
					index_expression(identifier('keys'), identifier('index')),
					true
				),
				call_statement(call_expression(member_expression(identifier('key'), 'apply'), {
					identifier('entry'),
					member_expression(identifier('key'), 'value'),
					identifier('params'),
					identifier('evaluation'),
				})),
			})
		),
		assignment_statement(
			member_expression(identifier('entry'), 'previous_time_step_key'),
			member_expression(identifier('state'), 'previous_time_key')
		),
		assignment_statement(
			member_expression(identifier('entry'), 'next_time_step_key'),
			member_expression(identifier('state'), 'next_time_key')
		),
	}
end

local advance_time_step_statements<const> = function()
	return {
		local_statement(
			identifier('key'),
			member_expression(identifier('entry'), 'next_time_step_key'),
			false
		),
		if_statement({
			if_clause(
				binary_expression(
					syntax.binary_and,
					binary_expression(
						syntax.binary_not_equal,
						identifier('key'),
						nil_literal()
					),
					binary_expression(
						syntax.binary_less_equal,
						member_expression(identifier('key'), 'time_ms'),
						identifier('time_ms')
					)
				),
				block({
					local_statement(identifier('previous_key'), nil, false),
					while_statement(
						binary_expression(
							syntax.binary_and,
							binary_expression(
								syntax.binary_not_equal,
								identifier('key'),
								nil_literal()
							),
							binary_expression(
								syntax.binary_less_equal,
								member_expression(identifier('key'), 'time_ms'),
								identifier('time_ms')
							)
						),
						block({
							call_statement(call_expression(member_expression(identifier('key'), 'apply'), {
								identifier('entry'),
								member_expression(identifier('key'), 'value'),
								identifier('params'),
								identifier('evaluation'),
							})),
							assignment_statement(identifier('previous_key'), identifier('key')),
							assignment_statement(
								identifier('key'),
								member_expression(identifier('key'), 'next_time_key')
							),
						})
					),
					assignment_statement(
						member_expression(identifier('entry'), 'previous_time_step_key'),
						identifier('previous_key')
					),
					assignment_statement(
						member_expression(identifier('entry'), 'next_time_step_key'),
						identifier('key')
					),
				})
			),
		}),
	}
end

local retreat_time_step_statements<const> = function()
	return {
		local_statement(
			identifier('key'),
			member_expression(identifier('entry'), 'previous_time_step_key'),
			false
		),
		if_statement({
			if_clause(
				binary_expression(
					syntax.binary_and,
					binary_expression(
						syntax.binary_not_equal,
						identifier('key'),
						nil_literal()
					),
					binary_expression(
						syntax.binary_greater,
						member_expression(identifier('key'), 'time_ms'),
						identifier('time_ms')
					)
				),
				block({
					local_statement(identifier('next_key'), nil, false),
					while_statement(
						binary_expression(
							syntax.binary_and,
							binary_expression(
								syntax.binary_not_equal,
								identifier('key'),
								nil_literal()
							),
							binary_expression(
								syntax.binary_greater,
								member_expression(identifier('key'), 'time_ms'),
								identifier('time_ms')
							)
						),
						block({
							local_statement(
								identifier('previous_key'),
								member_expression(identifier('key'), 'previous_key'),
								true
							),
							if_statement({
								if_clause(
									binary_expression(
										syntax.binary_not_equal,
										identifier('previous_key'),
										nil_literal()
									),
									block({
										call_statement(call_expression(
											member_expression(identifier('previous_key'), 'apply'),
											{
												identifier('entry'),
												member_expression(identifier('previous_key'), 'value'),
												identifier('params'),
												identifier('evaluation'),
											}
										)),
									})
								),
							}),
							assignment_statement(identifier('next_key'), identifier('key')),
							assignment_statement(
								identifier('key'),
								member_expression(identifier('key'), 'previous_time_key')
							),
						})
					),
					assignment_statement(
						member_expression(identifier('entry'), 'previous_time_step_key'),
						identifier('key')
					),
					assignment_statement(
						member_expression(identifier('entry'), 'next_time_step_key'),
						identifier('next_key')
					),
				})
			),
		}),
	}
end

local emit_play_time_steps<const> = function(statements, values)
	local reset_body<const> = {}
	reset_body[#reset_body + 1] = if_statement({
		if_clause(
			flag_set_expression(values.wrapped_flag),
			block(apply_time_boundary_state_statements())
		),
		else_clause(block({
			call_statement(call_expression(identifier('sample_time_step_tracks'), {
				identifier('entry'),
				identifier('steps'),
				identifier('time_ms'),
				identifier('params'),
				identifier('evaluation'),
			})),
		})),
	})
	statements[#statements + 1] = if_statement({
		if_clause(flag_set_expression(values.reset_step_flags), block(reset_body)),
		if_clause(
			binary_expression(
				syntax.binary_greater,
				identifier('time_ms'),
				identifier('previous_time_ms')
			),
			block(advance_time_step_statements())
		),
		if_clause(
			binary_expression(
				syntax.binary_less,
				identifier('time_ms'),
				identifier('previous_time_ms')
			),
			block(retreat_time_step_statements())
		),
	})
end

local emit_position_time_steps<const> = function(statements)
	statements[#statements + 1] = call_statement(call_expression(
		identifier('sample_time_step_tracks'),
		{
			identifier('entry'),
			identifier('steps'),
			identifier('time_ms'),
			identifier('params'),
			identifier('evaluation'),
		}
	))
end

function step_track_syntax.emit_play(statements, values)
	if values.has_frame_steps then
		emit_play_frame_steps(statements, values)
	end
	if values.has_time_steps then
		emit_play_time_steps(statements, values)
	end
end

function step_track_syntax.emit_position(statements, values)
	if values.has_frame_steps then
		emit_position_frame_steps(statements, values)
	end
	if values.has_time_steps then
		emit_position_time_steps(statements)
	end
end

return step_track_syntax
