-- Admission-only lowering for step-track traversal. Playback receives the
-- monotone cursor datapath; positioning reconstructs the destination state.
local syntax_factory<const> = lua_compiler.syntax_factory

local step_track_syntax<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local generated_symbol<const> = syntax_factory.generated_symbol
local reference<const> = syntax_factory.reference
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

local step_symbols<const> = {
	apply_step_bucket = generated_symbol('apply_step_bucket'),
	sample_step_tracks = generated_symbol('sample_step_tracks'),
	sample_time_step_tracks = generated_symbol('sample_time_step_tracks'),
	state = generated_symbol('state'),
	keys = generated_symbol('keys'),
	index = generated_symbol('index'),
	key = generated_symbol('key'),
	previous_key = generated_symbol('previous_key'),
	next_key = generated_symbol('next_key'),
}

function step_track_syntax.emit_dependency_captures(statements, values)
	if values.has_frame_steps then
		statements[#statements + 1] = local_statement(
			reference(step_symbols.apply_step_bucket),
			identifier('apply_step_bucket'),
			true
		)
		statements[#statements + 1] = local_statement(
			reference(step_symbols.sample_step_tracks),
			identifier('sample_step_tracks'),
			true
		)
	end
	if values.has_time_steps then
		statements[#statements + 1] = local_statement(
			reference(step_symbols.sample_time_step_tracks),
			identifier('sample_time_step_tracks'),
			true
		)
	end
end

local flag_set_expression<const> = function(flag, runner_symbols)
	return binary_expression(
		syntax.binary_not_equal,
		binary_expression(
			syntax.binary_bitwise_and,
			reference(runner_symbols.flags),
			numeric_literal(flag)
		),
		numeric_literal(0)
	)
end

local emit_position_frame_steps<const> = function(statements, values, runner_symbols)
	statements[#statements + 1] = if_statement({
		if_clause(
			flag_set_expression(values.sample_flag, runner_symbols),
			block({
				call_statement(call_expression(reference(step_symbols.sample_step_tracks), {
					reference(runner_symbols.entry),
					reference(runner_symbols.steps),
					reference(runner_symbols.frame),
					reference(runner_symbols.params),
					reference(runner_symbols.evaluation),
				})),
			})
		),
	})
end

local emit_play_frame_steps<const> = function(statements, values, runner_symbols)
	local sample_body<const> = {}
	local discontinuity<const> = binary_expression(
		syntax.binary_or,
		binary_expression(
			syntax.binary_or,
			flag_set_expression(values.reset_step_flags, runner_symbols),
			binary_expression(
				syntax.binary_greater,
				reference(runner_symbols.frame),
				binary_expression(
					syntax.binary_add,
					reference(runner_symbols.previous_frame),
					numeric_literal(1)
				)
			)
		),
		binary_expression(
			syntax.binary_less,
			reference(runner_symbols.frame),
			binary_expression(
				syntax.binary_subtract,
				reference(runner_symbols.previous_frame),
				numeric_literal(1)
			)
		)
	)
	sample_body[#sample_body + 1] = if_statement({
		if_clause(
			discontinuity,
			block({
				call_statement(call_expression(reference(step_symbols.sample_step_tracks), {
					reference(runner_symbols.entry),
					reference(runner_symbols.steps),
					reference(runner_symbols.frame),
					reference(runner_symbols.params),
					reference(runner_symbols.evaluation),
				})),
			})
		),
		if_clause(
			binary_expression(
				syntax.binary_greater,
				reference(runner_symbols.direction),
				numeric_literal(0)
			),
			block({
				call_statement(call_expression(reference(step_symbols.apply_step_bucket), {
					reference(runner_symbols.entry),
					index_expression(
						member_expression(reference(runner_symbols.steps), 'by_frame'),
						reference(runner_symbols.frame)
					),
					reference(runner_symbols.params),
					reference(runner_symbols.evaluation),
				})),
			})
		),
		if_clause(
			binary_expression(
				syntax.binary_less,
				reference(runner_symbols.direction),
				numeric_literal(0)
			),
			block({
				call_statement(call_expression(reference(step_symbols.apply_step_bucket), {
					reference(runner_symbols.entry),
					index_expression(
						member_expression(reference(runner_symbols.steps), 'reverse_by_frame'),
						reference(runner_symbols.previous_frame)
					),
					reference(runner_symbols.params),
					reference(runner_symbols.evaluation),
				})),
			})
		),
	})
	statements[#statements + 1] = if_statement({
		if_clause(flag_set_expression(values.sample_flag, runner_symbols), block(sample_body)),
	})
end

local apply_time_boundary_state_statements<const> = function(runner_symbols)
	return {
		local_statement(
			reference(step_symbols.state),
			member_expression(reference(runner_symbols.steps), 'end_time_step_state'),
			false
		),
		if_statement({
			if_clause(
				binary_expression(
					syntax.binary_equal,
					reference(runner_symbols.time_ms),
					numeric_literal(0)
				),
				block({
					assignment_statement(
						reference(step_symbols.state),
						member_expression(reference(runner_symbols.steps), 'start_time_step_state')
					),
				})
			),
		}),
		local_statement(
			reference(step_symbols.keys),
			member_expression(reference(step_symbols.state), 'keys'),
			true
		),
		numeric_for_statement(
			reference(step_symbols.index),
			numeric_literal(1),
			member_expression(reference(step_symbols.state), 'key_count'),
			nil,
			block({
				local_statement(
					reference(step_symbols.key),
					index_expression(reference(step_symbols.keys), reference(step_symbols.index)),
					true
				),
				call_statement(call_expression(member_expression(reference(step_symbols.key), 'apply'), {
					reference(runner_symbols.entry),
					member_expression(reference(step_symbols.key), 'value'),
					reference(runner_symbols.params),
					reference(runner_symbols.evaluation),
				})),
			})
		),
		assignment_statement(
			member_expression(reference(runner_symbols.entry), 'previous_time_step_key'),
			member_expression(reference(step_symbols.state), 'previous_time_key')
		),
		assignment_statement(
			member_expression(reference(runner_symbols.entry), 'next_time_step_key'),
			member_expression(reference(step_symbols.state), 'next_time_key')
		),
	}
end

local advance_time_step_statements<const> = function(runner_symbols)
	return {
		local_statement(
			reference(step_symbols.key),
			member_expression(reference(runner_symbols.entry), 'next_time_step_key'),
			false
		),
		if_statement({
			if_clause(
				binary_expression(
					syntax.binary_and,
					binary_expression(
						syntax.binary_not_equal,
						reference(step_symbols.key),
						nil_literal()
					),
					binary_expression(
						syntax.binary_less_equal,
						member_expression(reference(step_symbols.key), 'time_ms'),
						reference(runner_symbols.time_ms)
					)
				),
				block({
					local_statement(reference(step_symbols.previous_key), nil, false),
					while_statement(
						binary_expression(
							syntax.binary_and,
							binary_expression(
								syntax.binary_not_equal,
								reference(step_symbols.key),
								nil_literal()
							),
							binary_expression(
								syntax.binary_less_equal,
								member_expression(reference(step_symbols.key), 'time_ms'),
								reference(runner_symbols.time_ms)
							)
						),
						block({
							call_statement(call_expression(member_expression(reference(step_symbols.key), 'apply'), {
								reference(runner_symbols.entry),
								member_expression(reference(step_symbols.key), 'value'),
								reference(runner_symbols.params),
								reference(runner_symbols.evaluation),
							})),
							assignment_statement(reference(step_symbols.previous_key), reference(step_symbols.key)),
							assignment_statement(
								reference(step_symbols.key),
								member_expression(reference(step_symbols.key), 'next_time_key')
							),
						})
					),
					assignment_statement(
						member_expression(reference(runner_symbols.entry), 'previous_time_step_key'),
						reference(step_symbols.previous_key)
					),
					assignment_statement(
						member_expression(reference(runner_symbols.entry), 'next_time_step_key'),
						reference(step_symbols.key)
					),
				})
			),
		}),
	}
end

local retreat_time_step_statements<const> = function(runner_symbols)
	return {
		local_statement(
			reference(step_symbols.key),
			member_expression(reference(runner_symbols.entry), 'previous_time_step_key'),
			false
		),
		if_statement({
			if_clause(
				binary_expression(
					syntax.binary_and,
					binary_expression(
						syntax.binary_not_equal,
						reference(step_symbols.key),
						nil_literal()
					),
					binary_expression(
						syntax.binary_greater,
						member_expression(reference(step_symbols.key), 'time_ms'),
						reference(runner_symbols.time_ms)
					)
				),
				block({
					local_statement(reference(step_symbols.next_key), nil, false),
					while_statement(
						binary_expression(
							syntax.binary_and,
							binary_expression(
								syntax.binary_not_equal,
								reference(step_symbols.key),
								nil_literal()
							),
							binary_expression(
								syntax.binary_greater,
								member_expression(reference(step_symbols.key), 'time_ms'),
								reference(runner_symbols.time_ms)
							)
						),
						block({
							local_statement(
								reference(step_symbols.previous_key),
								member_expression(reference(step_symbols.key), 'previous_key'),
								true
							),
							if_statement({
								if_clause(
									binary_expression(
										syntax.binary_not_equal,
										reference(step_symbols.previous_key),
										nil_literal()
									),
									block({
										call_statement(call_expression(
											member_expression(reference(step_symbols.previous_key), 'apply'),
											{
												reference(runner_symbols.entry),
												member_expression(reference(step_symbols.previous_key), 'value'),
												reference(runner_symbols.params),
												reference(runner_symbols.evaluation),
											}
										)),
									})
								),
							}),
							assignment_statement(reference(step_symbols.next_key), reference(step_symbols.key)),
							assignment_statement(
								reference(step_symbols.key),
								member_expression(reference(step_symbols.key), 'previous_time_key')
							),
						})
					),
					assignment_statement(
						member_expression(reference(runner_symbols.entry), 'previous_time_step_key'),
						reference(step_symbols.key)
					),
					assignment_statement(
						member_expression(reference(runner_symbols.entry), 'next_time_step_key'),
						reference(step_symbols.next_key)
					),
				})
			),
		}),
	}
end

local emit_play_time_steps<const> = function(statements, values, runner_symbols)
	local reset_body<const> = {}
	reset_body[#reset_body + 1] = if_statement({
		if_clause(
			flag_set_expression(values.wrapped_flag, runner_symbols),
			block(apply_time_boundary_state_statements(runner_symbols))
		),
		else_clause(block({
			call_statement(call_expression(reference(step_symbols.sample_time_step_tracks), {
				reference(runner_symbols.entry),
				reference(runner_symbols.steps),
				reference(runner_symbols.time_ms),
				reference(runner_symbols.params),
				reference(runner_symbols.evaluation),
			})),
		})),
	})
	statements[#statements + 1] = if_statement({
		if_clause(flag_set_expression(values.reset_step_flags, runner_symbols), block(reset_body)),
		if_clause(
			binary_expression(
				syntax.binary_greater,
				reference(runner_symbols.time_ms),
				reference(runner_symbols.previous_time_ms)
			),
			block(advance_time_step_statements(runner_symbols))
		),
		if_clause(
			binary_expression(
				syntax.binary_less,
				reference(runner_symbols.time_ms),
				reference(runner_symbols.previous_time_ms)
			),
			block(retreat_time_step_statements(runner_symbols))
		),
	})
end

local emit_position_time_steps<const> = function(statements, runner_symbols)
	statements[#statements + 1] = call_statement(call_expression(
		reference(step_symbols.sample_time_step_tracks),
		{
			reference(runner_symbols.entry),
			reference(runner_symbols.steps),
			reference(runner_symbols.time_ms),
			reference(runner_symbols.params),
			reference(runner_symbols.evaluation),
		}
	))
end

function step_track_syntax.emit_play(statements, values, runner_symbols)
	if values.has_frame_steps then
		emit_play_frame_steps(statements, values, runner_symbols)
	end
	if values.has_time_steps then
		emit_play_time_steps(statements, values, runner_symbols)
	end
end

function step_track_syntax.emit_position(statements, values, runner_symbols)
	if values.has_frame_steps then
		emit_position_frame_steps(statements, values, runner_symbols)
	end
	if values.has_time_steps then
		emit_position_time_steps(statements, runner_symbols)
	end
end

return step_track_syntax
