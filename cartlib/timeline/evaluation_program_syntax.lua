-- Admission-only lowering from a cooked timeline shape to its method-specific
-- evaluator. Playback does not branch over absent track families.
local syntax_factory<const> = lua_compiler.syntax_factory

local evaluation_program_syntax<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local numeric_literal<const> = syntax_factory.number_literal
local member_expression<const> = syntax_factory.member_expression
local index_expression<const> = syntax_factory.index_expression
local call_expression<const> = syntax_factory.call_expression
local binary_expression<const> = syntax_factory.binary_expression
local function_expression<const> = syntax_factory.function_expression
local local_statement<const> = syntax_factory.local_statement
local call_statement<const> = syntax_factory.call_statement
local if_clause<const> = syntax_factory.if_clause
local if_statement<const> = syntax_factory.if_statement
local return_statement<const> = syntax_factory.return_statement

local evaluator_parameters<const> = function()
	return {
		identifier('entry'),
		identifier('owner'),
		identifier('previous_frame'),
		identifier('frame'),
		identifier('previous_time_ms'),
		identifier('time_ms'),
		identifier('direction'),
		identifier('flags'),
	}
end

local build_dependency_captures<const> = function(values)
	local statements<const> = {}
	if values.has_tags then
		statements[#statements + 1] = local_statement(
			identifier('bind_play_tags'),
			identifier('bind_play_tags'),
			true
		)
		statements[#statements + 1] = local_statement(
			identifier('bind_position_tags'),
			identifier('bind_position_tags'),
			true
		)
	end
	if values.has_subsequences then
		statements[#statements + 1] = local_statement(
			identifier('bind_play_sequences'),
			identifier('bind_play_sequences'),
			true
		)
		statements[#statements + 1] = local_statement(
			identifier('bind_position_sequences'),
			identifier('bind_position_sequences'),
			true
		)
	end
	if values.has_play_events or values.has_seek_events or values.has_scrub_events then
		statements[#statements + 1] = local_statement(
			identifier('bind_events'),
			identifier('bind_events'),
			true
		)
	end
	if values.has_evaluation_context then
		statements[#statements + 1] = local_statement(
			identifier('write_evaluation_context'),
			identifier('write_evaluation_context'),
			true
		)
	elseif values.has_frame_appliers then
		statements[#statements + 1] = local_statement(
			identifier('frame_value'),
			identifier('frame_value'),
			true
		)
	end
	return statements
end

local build_program_captures<const> = function(values)
	local statements<const> = {}
	if values.has_values then
		statements[#statements + 1] = local_statement(
			identifier('play_value_runner'),
			member_expression(
				member_expression(identifier('program'), 'tracks'),
				'play_value_runner'
			),
			true
		)
		if values.has_position_values then
			statements[#statements + 1] = local_statement(
				identifier('position_value_runner'),
				member_expression(
					member_expression(identifier('program'), 'tracks'),
					'position_value_runner'
				),
				true
			)
		end
	end
	if values.has_apply_function then
		statements[#statements + 1] = local_statement(
			identifier('apply_function'),
			member_expression(identifier('program'), 'apply_function'),
			true
		)
	end
	if values.has_frame_appliers then
		statements[#statements + 1] = local_statement(
			identifier('frame_appliers'),
			member_expression(identifier('program'), 'frame_appliers'),
			true
		)
	end
	if values.has_tags then
		statements[#statements + 1] = local_statement(
			identifier('evaluate_play_tags'),
			call_expression(identifier('bind_play_tags'), { identifier('program') }),
			true
		)
		statements[#statements + 1] = local_statement(
			identifier('evaluate_position_tags'),
			call_expression(identifier('bind_position_tags'), { identifier('program') }),
			true
		)
	end
	if values.has_play_events then
		statements[#statements + 1] = local_statement(
			identifier('emit_play_events'),
			call_expression(identifier('bind_events'), {
				identifier('program'),
				numeric_literal(values.play_method),
			}),
			true
		)
	end
	if values.has_seek_events then
		statements[#statements + 1] = local_statement(
			identifier('emit_jump_events'),
			call_expression(identifier('bind_events'), {
				identifier('program'),
				numeric_literal(values.jump_method),
			}),
			true
		)
	end
	if values.has_scrub_events then
		statements[#statements + 1] = local_statement(
			identifier('emit_scrub_events'),
			call_expression(identifier('bind_events'), {
				identifier('program'),
				numeric_literal(values.scrub_method),
			}),
			true
		)
	end
	if values.has_subsequences then
		statements[#statements + 1] = local_statement(
			identifier('evaluate_play_sequences'),
			call_expression(identifier('bind_play_sequences'), { identifier('program') }),
			true
		)
		statements[#statements + 1] = local_statement(
			identifier('evaluate_jump_sequences'),
			call_expression(identifier('bind_position_sequences'), {
				identifier('program'),
				numeric_literal(values.jump_method),
			}),
			true
		)
		statements[#statements + 1] = local_statement(
			identifier('evaluate_scrub_sequences'),
			call_expression(identifier('bind_position_sequences'), {
				identifier('program'),
				numeric_literal(values.scrub_method),
			}),
			true
		)
	end
	return statements
end

local emit_evaluation_context<const> = function(statements, update_method)
	statements[#statements + 1] = local_statement(
		identifier('evaluation'),
		call_expression(identifier('write_evaluation_context'), {
			member_expression(identifier('entry'), 'evaluation_context'),
			identifier('program'),
			numeric_literal(update_method),
			identifier('previous_frame'),
			identifier('frame'),
			identifier('previous_time_ms'),
			identifier('time_ms'),
			identifier('direction'),
			identifier('flags'),
		}),
		true
	)
end

local emit_tags<const> = function(statements, evaluator_name)
	if evaluator_name == 'play' then
		statements[#statements + 1] = call_statement(call_expression(
			identifier('evaluate_play_tags'),
			{
				identifier('entry'),
				identifier('owner'),
				identifier('previous_frame'),
				identifier('frame'),
				identifier('previous_time_ms'),
				identifier('time_ms'),
				identifier('direction'),
				identifier('flags'),
			}
		))
	else
		statements[#statements + 1] = call_statement(call_expression(
			identifier('evaluate_position_tags'),
			{
				identifier('entry'),
				identifier('owner'),
				identifier('frame'),
				identifier('time_ms'),
			}
		))
	end
end

local emit_values<const> = function(statements, values, evaluator_name)
	local runner_name<const> = (evaluator_name == 'play' or not values.has_position_values)
		and 'play_value_runner'
		or 'position_value_runner'
	local arguments<const> = {
		identifier('entry'),
		identifier('previous_frame'),
		identifier('frame'),
		identifier('previous_time_ms'),
		identifier('time_ms'),
		identifier('direction'),
		identifier('flags'),
	}
	if values.has_evaluation_context then
		arguments[#arguments + 1] = identifier('evaluation')
	end
	statements[#statements + 1] = call_statement(call_expression(
		identifier(runner_name),
		arguments
	))
end

local emit_sample<const> = function(statements, values)
	local sample_statements<const> = {}
	if values.has_apply_function then
		sample_statements[#sample_statements + 1] = call_statement(call_expression(
			identifier('apply_function'),
			{
				member_expression(identifier('entry'), 'primary_binding'),
				member_expression(identifier('evaluation'), 'value'),
				member_expression(identifier('entry'), 'params'),
				identifier('evaluation'),
			}
		))
	end
	if values.has_frame_appliers then
		local frame_value
		if values.has_evaluation_context then
			frame_value = member_expression(identifier('evaluation'), 'value')
		else
			frame_value = call_expression(identifier('frame_value'), {
				identifier('program'),
				identifier('frame'),
			})
		end
		sample_statements[#sample_statements + 1] = call_statement(call_expression(
			index_expression(
				identifier('frame_appliers'),
				binary_expression(
					syntax.binary_add,
					identifier('frame'),
					numeric_literal(1)
				)
			),
			{
				member_expression(identifier('entry'), 'primary_binding'),
				frame_value,
			}
		))
	end
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_not_equal,
				binary_expression(
					syntax.binary_bitwise_and,
					identifier('flags'),
					numeric_literal(values.sample_flag)
				),
				numeric_literal(0)
			),
			block(sample_statements)
		),
	})
end

local emit_sequences<const> = function(statements, values, evaluator_name, update_method)
	if evaluator_name == 'play' then
		statements[#statements + 1] = call_statement(call_expression(
			identifier('evaluate_play_sequences'),
			{
				identifier('entry'),
				identifier('owner'),
				identifier('previous_frame'),
				identifier('previous_time_ms'),
				identifier('time_ms'),
				identifier('direction'),
				identifier('flags'),
			}
		))
		return
	end
	local evaluator<const> = update_method == values.jump_method
		and 'evaluate_jump_sequences'
		or 'evaluate_scrub_sequences'
	statements[#statements + 1] = call_statement(call_expression(identifier(evaluator), {
		identifier('entry'),
		identifier('owner'),
		identifier('previous_time_ms'),
		identifier('time_ms'),
	}))
end

local emit_events<const> = function(statements, values, evaluator_name, update_method)
	local emitter
	if evaluator_name == 'play' and values.has_play_events then
		emitter = 'emit_play_events'
	elseif update_method == values.jump_method and values.has_seek_events then
		emitter = 'emit_jump_events'
	elseif update_method == values.scrub_method and values.has_scrub_events then
		emitter = 'emit_scrub_events'
	else
		return
	end
	statements[#statements + 1] = call_statement(call_expression(identifier(emitter), {
		identifier('owner'),
		identifier('previous_frame'),
		identifier('frame'),
		identifier('previous_time_ms'),
		identifier('time_ms'),
		identifier('direction'),
		identifier('flags'),
	}))
end

local build_evaluator_body<const> = function(values, evaluator_name, update_method)
	local statements<const> = {}
	if values.has_evaluation_context then
		emit_evaluation_context(statements, update_method)
	end
	if values.has_tags then
		emit_tags(statements, evaluator_name)
	end
	if values.has_values then
		emit_values(statements, values, evaluator_name)
	end
	if values.has_apply_function or values.has_frame_appliers then
		emit_sample(statements, values)
	end
	if values.has_subsequences then
		emit_sequences(statements, values, evaluator_name, update_method)
	end
	emit_events(statements, values, evaluator_name, update_method)
	return statements
end

local build_evaluator_declaration<const> = function(name, body)
	return local_statement(
		identifier(name),
		function_expression(evaluator_parameters(), block(body)),
		true
	)
end

function evaluation_program_syntax.build(values)
	local statements<const> = build_dependency_captures(values)
	local factory_body<const> = build_program_captures(values)
	factory_body[#factory_body + 1] = build_evaluator_declaration(
		'evaluate_play',
		build_evaluator_body(values, 'play', values.play_method)
	)
	if not values.has_evaluation_context and values.jump_evaluator == 'play' then
		factory_body[#factory_body + 1] = local_statement(
			identifier('evaluate_jump'),
			identifier('evaluate_play'),
			true
		)
	else
		factory_body[#factory_body + 1] = build_evaluator_declaration(
			'evaluate_jump',
			build_evaluator_body(values, values.jump_evaluator, values.jump_method)
		)
	end
	if not values.has_evaluation_context and values.scrub_evaluator == 'play' then
		factory_body[#factory_body + 1] = local_statement(
			identifier('evaluate_scrub'),
			identifier('evaluate_play'),
			true
		)
	elseif not values.has_evaluation_context and values.scrub_evaluator == values.jump_evaluator then
		factory_body[#factory_body + 1] = local_statement(
			identifier('evaluate_scrub'),
			identifier('evaluate_jump'),
			true
		)
	else
		factory_body[#factory_body + 1] = build_evaluator_declaration(
			'evaluate_scrub',
			build_evaluator_body(values, values.scrub_evaluator, values.scrub_method)
		)
	end
	factory_body[#factory_body + 1] = return_statement({
		identifier('evaluate_play'),
		identifier('evaluate_jump'),
		identifier('evaluate_scrub'),
	})
	statements[#statements + 1] = return_statement({
		function_expression({ identifier('program') }, block(factory_body)),
	})
	return syntax_factory.chunk(block(statements))
end

return evaluation_program_syntax
