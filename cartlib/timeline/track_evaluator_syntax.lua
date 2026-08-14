-- Admission-only lowering from cooked track capabilities to canonical firmware
-- syntax. Runtime evaluation contains only the selected traversal phases.
-- Authored wave scalars become literal operands; equal callback and easing
-- identities share one captured function.
local syntax_factory<const> = lua_compiler.syntax_factory
local step_track_syntax<const> = require('cartlib/timeline/step_track_syntax')

local track_evaluator_syntax<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local numeric_literal<const> = syntax_factory.number_literal
local string_literal<const> = syntax_factory.string_literal
local member_expression<const> = syntax_factory.member_expression
local index_expression<const> = syntax_factory.index_expression
local index_path<const> = syntax_factory.index_path
local call_expression<const> = syntax_factory.call_expression
local binary_expression<const> = syntax_factory.binary_expression
local function_expression<const> = syntax_factory.function_expression
local assignment_statement<const> = syntax_factory.assignment_statement
local local_statement<const> = syntax_factory.local_statement
local call_statement<const> = syntax_factory.call_statement
local if_clause<const> = syntax_factory.if_clause
local if_statement<const> = syntax_factory.if_statement
local return_statement<const> = syntax_factory.return_statement

local sample_function_name<const> = function(index)
	return 'sample_function_' .. index
end

local identifiers<const> = function(names)
	local parameters<const> = {}
	for index = 1, #names do
		parameters[index] = identifier(names[index])
	end
	return parameters
end

local scalar_runner_arguments<const> = function(values)
	local arguments<const> = { identifier('entry') }
	if values.has_scalar_frame_channels then
		arguments[#arguments + 1] = identifier('frame')
	end
	if values.has_scalar_time_channels then
		arguments[#arguments + 1] = identifier('time_ms')
	end
	if values.has_scalar_frame_channels and not values.value_has_evaluation_context then
		arguments[#arguments + 1] = identifier('flags')
	end
	if values.has_scalar_frame_channels and values.value_has_evaluation_context then
		arguments[#arguments + 1] = identifier('sample')
	end
	if values.value_has_evaluation_context then
		arguments[#arguments + 1] = identifier('evaluation')
	end
	return arguments
end

local emit_dependency_captures<const> = function(statements, values)
	step_track_syntax.emit_dependency_captures(statements, values)
	if values.sample_functions ~= nil then
		statements[#statements + 1] = local_statement(
			identifier('sample_functions'),
			identifier('sample_functions'),
			true
		)
	end
	if values.has_pingpong_tracks then
		statements[#statements + 1] = local_statement(
			identifier('pingpong01'),
			identifier('pingpong01'),
			true
		)
	end
	if values.has_sin_tracks then
		statements[#statements + 1] = local_statement(
			identifier('sin'),
			identifier('sin'),
			true
		)
	end
end

local sample_target<const> = function(track)
	if track.binding_index == 1 then
		return identifier('primary_binding')
	end
	return index_expression(identifier('bindings'), numeric_literal(track.binding_index))
end

local emit_sample_track<const> = function(statements, track, tau)
	local target<const> = sample_target(track)
	if track.kind == 'sample' then
		statements[#statements + 1] = call_statement(call_expression(
			identifier(sample_function_name(track.function_index)),
			{
				target,
				identifier('params'),
				identifier('evaluation'),
				identifier('time_seconds'),
			}
		))
		return
	end
	local wave_position<const> = binary_expression(
		syntax.binary_add,
		binary_expression(
			syntax.binary_multiply,
			identifier('time_seconds'),
			numeric_literal(track.period_inv)
		),
		numeric_literal(track.phase)
	)
	if track.wave == 'pingpong' then
		statements[#statements + 1] = assignment_statement(
			identifier('wave_value'),
			call_expression(identifier('pingpong01'), { wave_position })
		)
	else
		statements[#statements + 1] = assignment_statement(
			identifier('wave_value'),
			binary_expression(
				syntax.binary_multiply,
				binary_expression(
					syntax.binary_add,
					call_expression(identifier('sin'), {
						binary_expression(
							syntax.binary_multiply,
							wave_position,
							numeric_literal(tau)
						),
					}),
					numeric_literal(1)
				),
				numeric_literal(0.5)
			)
		)
	end
	if track.ease ~= nil then
		statements[#statements + 1] = assignment_statement(
			identifier('wave_value'),
			call_expression(
				identifier(sample_function_name(track.function_index)),
				{ identifier('wave_value') }
			)
		)
	end
	local base
	if track.base_param == nil then
		base = numeric_literal(track.base)
	else
		base = index_expression(identifier('params'), string_literal(track.base_param))
	end
	statements[#statements + 1] = assignment_statement(
		index_path(target, track.path),
		binary_expression(
			syntax.binary_add,
			base,
			binary_expression(
				syntax.binary_multiply,
				binary_expression(
					syntax.binary_multiply,
					binary_expression(
						syntax.binary_subtract,
						identifier('wave_value'),
						numeric_literal(0.5)
					),
					numeric_literal(2)
				),
				numeric_literal(track.amp)
			)
		)
	)
end

local emit_sample<const> = function(statements, values)
	if not values.has_sample_tracks then
		return
	end
	local body<const> = {}
	if values.has_sample_params and not values.has_frame_steps and not values.has_time_steps then
		body[#body + 1] = local_statement(
			identifier('params'),
			member_expression(identifier('entry'), 'params'),
			true
		)
	end
	if values.has_primary_sample_binding then
		body[#body + 1] = local_statement(
			identifier('primary_binding'),
			member_expression(identifier('entry'), 'primary_binding'),
			true
		)
	end
	if values.has_secondary_sample_binding then
		body[#body + 1] = local_statement(
			identifier('bindings'),
			member_expression(identifier('entry'), 'bindings'),
			true
		)
	end
	body[#body + 1] = local_statement(
		identifier('time_seconds'),
		binary_expression(
			syntax.binary_multiply,
			identifier('time_ms'),
			numeric_literal(0.001)
		),
		true
	)
	if values.has_wave_tracks then
		body[#body + 1] = local_statement(identifier('wave_value'), nil, false)
	end
	for index = 1, #values.sample_tracks do
		emit_sample_track(body, values.sample_tracks[index], values.tau)
	end
	local sample_condition
	if values.value_has_evaluation_context then
		sample_condition = identifier('sample')
	else
		sample_condition = binary_expression(
			syntax.binary_not_equal,
			binary_expression(
				syntax.binary_bitwise_and,
				identifier('flags'),
				numeric_literal(values.sample_flag)
			),
			numeric_literal(0)
		)
	end
	statements[#statements + 1] = if_statement({
		if_clause(sample_condition, block(body)),
	})
end

local emit_value_runner<const> = function(statements, values, position)
	if values.has_frame_steps or values.has_time_steps then
		statements[#statements + 1] = local_statement(
			identifier('params'),
			member_expression(identifier('entry'), 'params'),
			true
		)
	end
	if position then
		step_track_syntax.emit_position(statements, values)
	else
		step_track_syntax.emit_play(statements, values)
	end
	if values.has_scalar_channels then
		statements[#statements + 1] = call_statement(call_expression(
			identifier('scalar_runner'),
			scalar_runner_arguments(values)
		))
	end
	emit_sample(statements, values)
end

function track_evaluator_syntax.build(values)
	local statements<const> = {}
	emit_dependency_captures(statements, values)
	local sample_functions<const> = values.sample_functions
	if sample_functions ~= nil then
		for index = 1, #sample_functions do
			statements[#statements + 1] = local_statement(
				identifier(sample_function_name(index)),
				index_expression(identifier('sample_functions'), numeric_literal(index)),
				true
			)
		end
	end
	local factory_body<const> = {}
	if values.has_frame_steps or values.has_time_steps then
		factory_body[#factory_body + 1] = local_statement(
			identifier('steps'),
			member_expression(identifier('tracks'), 'steps'),
			true
		)
	end
	local play_body<const> = {}
	emit_value_runner(play_body, values, false)
	factory_body[#factory_body + 1] = local_statement(
		identifier('play_runner'),
		function_expression(
			identifiers(values.play_value_operands),
			block(play_body)
		),
		true
	)
	if values.has_frame_steps or values.has_time_steps then
		local position_body<const> = {}
		emit_value_runner(position_body, values, true)
		factory_body[#factory_body + 1] = local_statement(
			identifier('position_runner'),
			function_expression(
				identifiers(values.position_value_operands),
				block(position_body)
			),
			true
		)
		factory_body[#factory_body + 1] = return_statement({
			identifier('play_runner'),
			identifier('position_runner'),
		})
	else
		factory_body[#factory_body + 1] = return_statement({ identifier('play_runner') })
	end
	statements[#statements + 1] = return_statement({
		function_expression(
			{
				identifier('tracks'),
				identifier('scalar_runner'),
			},
			block(factory_body)
		),
	})
	return syntax_factory.chunk(block(statements))
end

return track_evaluator_syntax
