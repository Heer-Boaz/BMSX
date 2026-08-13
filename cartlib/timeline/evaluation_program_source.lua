local lua_syntax<const> = require('cartlib/codegen/lua_syntax')

local evaluation_program_source<const> = {}
local binary_operator<const> = lua_syntax.binary_operator
local identifier<const> = lua_syntax.identifier
local numeric_literal<const> = lua_syntax.numeric_literal
local member_expression<const> = lua_syntax.member_expression
local call_expression<const> = lua_syntax.call_expression
local binary_expression<const> = lua_syntax.binary_expression
local function_expression<const> = lua_syntax.function_expression
local local_declaration_statement<const> = lua_syntax.local_declaration_statement
local call_statement<const> = lua_syntax.call_statement
local if_statement<const> = lua_syntax.if_statement
local return_statement<const> = lua_syntax.return_statement

local entry<const> = identifier('entry')
local owner<const> = identifier('owner')
local program<const> = identifier('program')
local previous_frame<const> = identifier('previous_frame')
local frame<const> = identifier('frame')
local previous_time_ms<const> = identifier('previous_time_ms')
local time_ms<const> = identifier('time_ms')
local direction<const> = identifier('direction')
local flags<const> = identifier('flags')
local evaluation<const> = identifier('evaluation')
local entry_primary_binding<const> = member_expression(entry, 'primary_binding')
local source_statement<const> = {}
local evaluator_parameters<const> = {
	'entry',
	'owner',
	'previous_frame',
	'frame',
	'previous_time_ms',
	'time_ms',
	'direction',
	'flags',
}

local tag_dependency_captures<const> = {
	local_declaration_statement({ 'bind_play_tags' }, { identifier('bind_play_tags') }, true),
	local_declaration_statement({ 'bind_position_tags' }, { identifier('bind_position_tags') }, true),
}

local sequence_dependency_captures<const> = {
	local_declaration_statement({ 'bind_play_sequences' }, { identifier('bind_play_sequences') }, true),
	local_declaration_statement({ 'bind_position_sequences' }, { identifier('bind_position_sequences') }, true),
}

source_statement.event_dependency_capture = local_declaration_statement(
	{ 'bind_events' },
	{ identifier('bind_events') },
	true
)

source_statement.context_dependency_capture = local_declaration_statement(
	{ 'write_evaluation_context' },
	{ identifier('write_evaluation_context') },
	true
)

source_statement.frame_value_dependency_capture = local_declaration_statement(
	{ 'frame_value' },
	{ identifier('frame_value') },
	true
)

source_statement.play_value_runner_capture = local_declaration_statement(
	{ 'play_value_runner' },
	{ member_expression(member_expression(program, 'tracks'), 'play_value_runner') },
	true
)

source_statement.position_value_runner_capture = local_declaration_statement(
	{ 'position_value_runner' },
	{ member_expression(member_expression(program, 'tracks'), 'position_value_runner') },
	true
)

source_statement.apply_function_capture = local_declaration_statement(
	{ 'apply_function' },
	{ member_expression(program, 'apply_function') },
	true
)

source_statement.frame_appliers_capture = local_declaration_statement(
	{ 'frame_appliers' },
	{ member_expression(program, 'frame_appliers') },
	true
)

local tag_bindings<const> = {
	local_declaration_statement(
		{ 'evaluate_play_tags' },
		{ call_expression(identifier('bind_play_tags'), { program }) },
		true
	),
	local_declaration_statement(
		{ 'evaluate_position_tags' },
		{ call_expression(identifier('bind_position_tags'), { program }) },
		true
	),
}

source_statement.play_tags = call_statement(call_expression(identifier('evaluate_play_tags'), {
	entry,
	owner,
	previous_frame,
	frame,
	previous_time_ms,
	time_ms,
	direction,
	flags,
}))

source_statement.position_tags = call_statement(call_expression(identifier('evaluate_position_tags'), {
	entry,
	owner,
	frame,
	time_ms,
}))

source_statement.play_values = call_statement(call_expression(identifier('play_value_runner'), {
	entry,
	previous_frame,
	frame,
	previous_time_ms,
	time_ms,
	direction,
	flags,
}))

source_statement.play_values_with_context = call_statement(call_expression(identifier('play_value_runner'), {
	entry,
	previous_frame,
	frame,
	previous_time_ms,
	time_ms,
	direction,
	flags,
	evaluation,
}))

source_statement.position_values = call_statement(call_expression(identifier('position_value_runner'), {
	entry,
	previous_frame,
	frame,
	previous_time_ms,
	time_ms,
	direction,
	flags,
}))

source_statement.position_values_with_context = call_statement(call_expression(identifier('position_value_runner'), {
	entry,
	previous_frame,
	frame,
	previous_time_ms,
	time_ms,
	direction,
	flags,
	evaluation,
}))

source_statement.apply_function = call_statement(call_expression(identifier('apply_function'), {
	entry_primary_binding,
	member_expression(evaluation, 'value'),
	member_expression(entry, 'params'),
	evaluation,
}))

source_statement.frame_appliers = call_statement(call_expression(
	lua_syntax.index_expression(
		identifier('frame_appliers'),
		binary_expression(binary_operator.add, frame, numeric_literal(1))
	),
	{
		entry_primary_binding,
		call_expression(identifier('frame_value'), { program, frame }),
	}
))

source_statement.frame_appliers_with_context = call_statement(call_expression(
	lua_syntax.index_expression(
		identifier('frame_appliers'),
		binary_expression(binary_operator.add, frame, numeric_literal(1))
	),
	{ entry_primary_binding, member_expression(evaluation, 'value') }
))

source_statement.play_sequences = call_statement(call_expression(identifier('evaluate_play_sequences'), {
	entry,
	owner,
	previous_frame,
	previous_time_ms,
	time_ms,
	direction,
	flags,
}))

source_statement.jump_sequences = call_statement(call_expression(identifier('evaluate_jump_sequences'), {
	entry,
	owner,
	previous_time_ms,
	time_ms,
}))

source_statement.scrub_sequences = call_statement(call_expression(identifier('evaluate_scrub_sequences'), {
	entry,
	owner,
	previous_time_ms,
	time_ms,
}))

source_statement.play_events = call_statement(call_expression(identifier('emit_play_events'), {
	owner,
	previous_frame,
	frame,
	previous_time_ms,
	time_ms,
	direction,
	flags,
}))

source_statement.jump_events = call_statement(call_expression(identifier('emit_jump_events'), {
	owner,
	previous_frame,
	frame,
	previous_time_ms,
	time_ms,
	direction,
	flags,
}))

source_statement.scrub_events = call_statement(call_expression(identifier('emit_scrub_events'), {
	owner,
	previous_frame,
	frame,
	previous_time_ms,
	time_ms,
	direction,
	flags,
}))

local append_statements<const> = function(target, source)
	for index = 1, #source do
		target[#target + 1] = source[index]
	end
end

local build_dependency_captures<const> = function(values)
	local statements<const> = {}
	if values.has_tags then
		append_statements(statements, tag_dependency_captures)
	end
	if values.has_subsequences then
		append_statements(statements, sequence_dependency_captures)
	end
	if values.has_play_events or values.has_seek_events or values.has_scrub_events then
		statements[#statements + 1] = source_statement.event_dependency_capture
	end
	if values.has_evaluation_context then
		statements[#statements + 1] = source_statement.context_dependency_capture
	elseif values.has_frame_appliers then
		statements[#statements + 1] = source_statement.frame_value_dependency_capture
	end
	return statements
end

local build_program_captures<const> = function(values)
	local statements<const> = {}
	if values.has_values then
		statements[#statements + 1] = source_statement.play_value_runner_capture
		if values.has_position_values then
			statements[#statements + 1] = source_statement.position_value_runner_capture
		end
	end
	if values.has_apply_function then
		statements[#statements + 1] = source_statement.apply_function_capture
	end
	if values.has_frame_appliers then
		statements[#statements + 1] = source_statement.frame_appliers_capture
	end
	if values.has_tags then
		append_statements(statements, tag_bindings)
	end
	if values.has_play_events then
		statements[#statements + 1] = local_declaration_statement(
			{ 'emit_play_events' },
			{ call_expression(identifier('bind_events'), { program, numeric_literal(values.play_method) }) },
			true
		)
	end
	if values.has_seek_events then
		statements[#statements + 1] = local_declaration_statement(
			{ 'emit_jump_events' },
			{ call_expression(identifier('bind_events'), { program, numeric_literal(values.jump_method) }) },
			true
		)
	end
	if values.has_scrub_events then
		statements[#statements + 1] = local_declaration_statement(
			{ 'emit_scrub_events' },
			{ call_expression(identifier('bind_events'), { program, numeric_literal(values.scrub_method) }) },
			true
		)
	end
	if values.has_subsequences then
		statements[#statements + 1] = local_declaration_statement(
			{ 'evaluate_play_sequences' },
			{ call_expression(identifier('bind_play_sequences'), { program }) },
			true
		)
		statements[#statements + 1] = local_declaration_statement(
			{ 'evaluate_jump_sequences' },
			{
				call_expression(identifier('bind_position_sequences'), {
					program,
					numeric_literal(values.jump_method),
				}),
			},
			true
		)
		statements[#statements + 1] = local_declaration_statement(
			{ 'evaluate_scrub_sequences' },
			{
				call_expression(identifier('bind_position_sequences'), {
					program,
					numeric_literal(values.scrub_method),
				}),
			},
			true
		)
	end
	return statements
end

local build_evaluator_body<const> = function(values, evaluator_name, update_method)
	local statements<const> = {}
	if values.has_evaluation_context then
		statements[#statements + 1] = local_declaration_statement(
			{ 'evaluation' },
			{
				call_expression(identifier('write_evaluation_context'), {
					member_expression(entry, 'evaluation_context'),
					program,
					numeric_literal(update_method),
					previous_frame,
					frame,
					previous_time_ms,
					time_ms,
					direction,
					flags,
				}),
			},
			true
		)
	end
	if values.has_tags then
		statements[#statements + 1] = evaluator_name == 'play'
			and source_statement.play_tags
			or source_statement.position_tags
	end
	if values.has_values then
		if evaluator_name == 'play' or not values.has_position_values then
			statements[#statements + 1] = values.has_evaluation_context
				and source_statement.play_values_with_context
				or source_statement.play_values
		else
			statements[#statements + 1] = values.has_evaluation_context
				and source_statement.position_values_with_context
				or source_statement.position_values
		end
	end
	if values.has_apply_function or values.has_frame_appliers then
		local sample_statements<const> = {}
		if values.has_apply_function then
			sample_statements[#sample_statements + 1] = source_statement.apply_function
		end
		if values.has_frame_appliers then
			sample_statements[#sample_statements + 1] = values.has_evaluation_context
				and source_statement.frame_appliers_with_context
				or source_statement.frame_appliers
		end
		statements[#statements + 1] = if_statement({
			{
				binary_expression(
					binary_operator.not_equal,
					binary_expression(
						binary_operator.bitwise_and,
						flags,
						numeric_literal(values.sample_flag)
					),
					numeric_literal(0)
				),
				sample_statements,
			},
		})
	end
	if values.has_subsequences then
		if evaluator_name == 'play' then
			statements[#statements + 1] = source_statement.play_sequences
		elseif update_method == values.jump_method then
			statements[#statements + 1] = source_statement.jump_sequences
		else
			statements[#statements + 1] = source_statement.scrub_sequences
		end
	end
	if evaluator_name == 'play' and values.has_play_events then
		statements[#statements + 1] = source_statement.play_events
	elseif update_method == values.jump_method and values.has_seek_events then
		statements[#statements + 1] = source_statement.jump_events
	elseif update_method == values.scrub_method and values.has_scrub_events then
		statements[#statements + 1] = source_statement.scrub_events
	end
	return statements
end

local build_evaluator_declaration<const> = function(name, body)
	return local_declaration_statement(
		{ name },
		{ function_expression(evaluator_parameters, body) },
		true
	)
end

function evaluation_program_source.build(values)
	local statements<const> = build_dependency_captures(values)
	local factory_body<const> = build_program_captures(values)
	factory_body[#factory_body + 1] = build_evaluator_declaration(
		'evaluate_play',
		build_evaluator_body(values, 'play', values.play_method)
	)
	if not values.has_evaluation_context and values.jump_evaluator == 'play' then
		factory_body[#factory_body + 1] = local_declaration_statement(
			{ 'evaluate_jump' },
			{ identifier('evaluate_play') },
			true
		)
	else
		factory_body[#factory_body + 1] = build_evaluator_declaration(
			'evaluate_jump',
			build_evaluator_body(values, values.jump_evaluator, values.jump_method)
		)
	end
	if not values.has_evaluation_context and values.scrub_evaluator == 'play' then
		factory_body[#factory_body + 1] = local_declaration_statement(
			{ 'evaluate_scrub' },
			{ identifier('evaluate_play') },
			true
		)
	elseif not values.has_evaluation_context and values.scrub_evaluator == values.jump_evaluator then
		factory_body[#factory_body + 1] = local_declaration_statement(
			{ 'evaluate_scrub' },
			{ identifier('evaluate_jump') },
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
		function_expression({ 'program' }, factory_body),
	})
	return lua_syntax.chunk(statements)
end

return evaluation_program_source
