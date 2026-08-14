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
local generated_symbol<const> = syntax_factory.generated_symbol
local reference<const> = syntax_factory.reference
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

local runner_symbols<const> = {
	entry = generated_symbol('entry'),
	previous_frame = generated_symbol('previous_frame'),
	frame = generated_symbol('frame'),
	previous_time_ms = generated_symbol('previous_time_ms'),
	time_ms = generated_symbol('time_ms'),
	direction = generated_symbol('direction'),
	flags = generated_symbol('flags'),
	sample = generated_symbol('sample'),
	evaluation = generated_symbol('evaluation'),
	params = generated_symbol('params'),
	primary_binding = generated_symbol('primary_binding'),
	bindings = generated_symbol('bindings'),
	time_seconds = generated_symbol('time_seconds'),
	wave_value = generated_symbol('wave_value'),
	sample_functions = generated_symbol('sample_functions'),
	pingpong01 = generated_symbol('pingpong01'),
	sin = generated_symbol('sin'),
	scalar_runner = generated_symbol('scalar_runner'),
	steps = generated_symbol('steps'),
	tracks = generated_symbol('tracks'),
	play_runner = generated_symbol('play_runner'),
	position_runner = generated_symbol('position_runner'),
}

local references<const> = function(names)
	local parameters<const> = {}
	for index = 1, #names do
		parameters[index] = reference(runner_symbols[names[index]])
	end
	return parameters
end

local scalar_runner_arguments<const> = function(values)
	local arguments<const> = { reference(runner_symbols.entry) }
	if values.has_scalar_frame_channels then
		arguments[#arguments + 1] = reference(runner_symbols.frame)
	end
	if values.has_scalar_time_channels then
		arguments[#arguments + 1] = reference(runner_symbols.time_ms)
	end
	if values.has_scalar_frame_channels and not values.value_has_evaluation_context then
		arguments[#arguments + 1] = reference(runner_symbols.flags)
	end
	if values.has_scalar_frame_channels and values.value_has_evaluation_context then
		arguments[#arguments + 1] = reference(runner_symbols.sample)
	end
	if values.value_has_evaluation_context then
		arguments[#arguments + 1] = reference(runner_symbols.evaluation)
	end
	return arguments
end

local emit_dependency_captures<const> = function(statements, values)
	step_track_syntax.emit_dependency_captures(statements, values)
	if values.sample_functions ~= nil then
		statements[#statements + 1] = local_statement(
			reference(runner_symbols.sample_functions),
			identifier('sample_functions'),
			true
		)
	end
	if values.has_pingpong_tracks then
		statements[#statements + 1] = local_statement(
			reference(runner_symbols.pingpong01),
			identifier('pingpong01'),
			true
		)
	end
	if values.has_sin_tracks then
		statements[#statements + 1] = local_statement(
			reference(runner_symbols.sin),
			identifier('sin'),
			true
		)
	end
end

local sample_target<const> = function(track)
	if track.binding_index == 1 then
		return reference(runner_symbols.primary_binding)
	end
	return index_expression(reference(runner_symbols.bindings), numeric_literal(track.binding_index))
end

local emit_sample_track<const> = function(statements, track, tau, sample_function_symbols)
	local target<const> = sample_target(track)
	if track.kind == 'sample' then
		statements[#statements + 1] = call_statement(call_expression(
			reference(sample_function_symbols[track.function_index]),
			{
				target,
				reference(runner_symbols.params),
				reference(runner_symbols.evaluation),
				reference(runner_symbols.time_seconds),
			}
		))
		return
	end
	local wave_position<const> = binary_expression(
		syntax.binary_add,
		binary_expression(
			syntax.binary_multiply,
			reference(runner_symbols.time_seconds),
			numeric_literal(track.period_inv)
		),
		numeric_literal(track.phase)
	)
	if track.wave == 'pingpong' then
		statements[#statements + 1] = assignment_statement(
			reference(runner_symbols.wave_value),
			call_expression(reference(runner_symbols.pingpong01), { wave_position })
		)
	else
		statements[#statements + 1] = assignment_statement(
			reference(runner_symbols.wave_value),
			binary_expression(
				syntax.binary_multiply,
				binary_expression(
					syntax.binary_add,
					call_expression(reference(runner_symbols.sin), {
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
			reference(runner_symbols.wave_value),
			call_expression(
				reference(sample_function_symbols[track.function_index]),
				{ reference(runner_symbols.wave_value) }
			)
		)
	end
	local base
	if track.base_param == nil then
		base = numeric_literal(track.base)
	else
		base = index_expression(reference(runner_symbols.params), string_literal(track.base_param))
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
						reference(runner_symbols.wave_value),
						numeric_literal(0.5)
					),
					numeric_literal(2)
				),
				numeric_literal(track.amp)
			)
		)
	)
end

local emit_sample<const> = function(statements, values, sample_function_symbols)
	if not values.has_sample_tracks then
		return
	end
	local body<const> = {}
	if values.has_sample_params and not values.has_frame_steps and not values.has_time_steps then
		body[#body + 1] = local_statement(
			reference(runner_symbols.params),
			member_expression(reference(runner_symbols.entry), 'params'),
			true
		)
	end
	if values.has_primary_sample_binding then
		body[#body + 1] = local_statement(
			reference(runner_symbols.primary_binding),
			member_expression(reference(runner_symbols.entry), 'primary_binding'),
			true
		)
	end
	if values.has_secondary_sample_binding then
		body[#body + 1] = local_statement(
			reference(runner_symbols.bindings),
			member_expression(reference(runner_symbols.entry), 'bindings'),
			true
		)
	end
	body[#body + 1] = local_statement(
		reference(runner_symbols.time_seconds),
		binary_expression(
			syntax.binary_multiply,
			reference(runner_symbols.time_ms),
			numeric_literal(0.001)
		),
		true
	)
	if values.has_wave_tracks then
		body[#body + 1] = local_statement(reference(runner_symbols.wave_value), nil, false)
	end
	for index = 1, #values.sample_tracks do
		emit_sample_track(
			body,
			values.sample_tracks[index],
			values.tau,
			sample_function_symbols
		)
	end
	local sample_condition
	if values.value_has_evaluation_context then
		sample_condition = reference(runner_symbols.sample)
	else
		sample_condition = binary_expression(
			syntax.binary_not_equal,
			binary_expression(
				syntax.binary_bitwise_and,
				reference(runner_symbols.flags),
				numeric_literal(values.sample_flag)
			),
			numeric_literal(0)
		)
	end
	statements[#statements + 1] = if_statement({
		if_clause(sample_condition, block(body)),
	})
end

local emit_value_runner<const> = function(
	statements,
	values,
	position,
	sample_function_symbols
)
	if values.has_frame_steps or values.has_time_steps then
		statements[#statements + 1] = local_statement(
			reference(runner_symbols.params),
			member_expression(reference(runner_symbols.entry), 'params'),
			true
		)
	end
	if position then
		step_track_syntax.emit_position(statements, values, runner_symbols)
	else
		step_track_syntax.emit_play(statements, values, runner_symbols)
	end
	if values.has_scalar_channels then
		statements[#statements + 1] = call_statement(call_expression(
			reference(runner_symbols.scalar_runner),
			scalar_runner_arguments(values)
		))
	end
	emit_sample(statements, values, sample_function_symbols)
end

function track_evaluator_syntax.build(values)
	local statements<const> = {}
	emit_dependency_captures(statements, values)
	local sample_functions<const> = values.sample_functions
	local sample_function_symbols<const> = {}
	if sample_functions ~= nil then
		for index = 1, #sample_functions do
			local sample_function_symbol<const> = generated_symbol('sample_function')
			sample_function_symbols[index] = sample_function_symbol
			statements[#statements + 1] = local_statement(
				reference(sample_function_symbol),
				index_expression(reference(runner_symbols.sample_functions), numeric_literal(index)),
				true
			)
		end
	end
	local factory_body<const> = {}
	if values.has_frame_steps or values.has_time_steps then
		factory_body[#factory_body + 1] = local_statement(
			reference(runner_symbols.steps),
			member_expression(reference(runner_symbols.tracks), 'steps'),
			true
		)
	end
	local play_body<const> = {}
	emit_value_runner(play_body, values, false, sample_function_symbols)
	factory_body[#factory_body + 1] = local_statement(
		reference(runner_symbols.play_runner),
		function_expression(
			references(values.play_value_operands),
			block(play_body)
		),
		true
	)
	if values.has_frame_steps or values.has_time_steps then
		local position_body<const> = {}
		emit_value_runner(position_body, values, true, sample_function_symbols)
		factory_body[#factory_body + 1] = local_statement(
			reference(runner_symbols.position_runner),
			function_expression(
				references(values.position_value_operands),
				block(position_body)
			),
			true
		)
		factory_body[#factory_body + 1] = return_statement({
			reference(runner_symbols.play_runner),
			reference(runner_symbols.position_runner),
		})
	else
		factory_body[#factory_body + 1] = return_statement({ reference(runner_symbols.play_runner) })
	end
	statements[#statements + 1] = return_statement({
		function_expression(
			{
				reference(runner_symbols.tracks),
				reference(runner_symbols.scalar_runner),
			},
			block(factory_body)
		),
	})
	return syntax_factory.chunk(block(statements))
end

return track_evaluator_syntax
