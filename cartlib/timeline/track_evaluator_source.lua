local lua_syntax<const> = require('cartlib/codegen/lua_syntax')

local track_evaluator_source<const> = {}
local binary_operator<const> = lua_syntax.binary_operator
local identifier<const> = lua_syntax.identifier
local numeric_literal<const> = lua_syntax.numeric_literal
local string_literal<const> = lua_syntax.string_literal
local member_expression<const> = lua_syntax.member_expression
local index_expression<const> = lua_syntax.index_expression
local index_path<const> = lua_syntax.index_path
local call_expression<const> = lua_syntax.call_expression
local binary_expression<const> = lua_syntax.binary_expression
local function_expression<const> = lua_syntax.function_expression
local assignment_statement<const> = lua_syntax.assignment_statement
local local_declaration_statement<const> = lua_syntax.local_declaration_statement
local call_statement<const> = lua_syntax.call_statement
local if_statement<const> = lua_syntax.if_statement
local return_statement<const> = lua_syntax.return_statement

local expression<const> = {
	entry = identifier('entry'),
	evaluation = identifier('evaluation'),
	flags = identifier('flags'),
	frame = identifier('frame'),
	params = identifier('params'),
	previous_frame = identifier('previous_frame'),
	previous_time_ms = identifier('previous_time_ms'),
	primary_binding = identifier('primary_binding'),
	time_ms = identifier('time_ms'),
	time_seconds = identifier('time_seconds'),
	tracks = identifier('tracks'),
	wave_value = identifier('wave_value'),
}

local sample_name<const> = function(prefix, index)
	return prefix .. index
end

local emit_dependency_captures<const> = function(statements, values)
	if values.has_sample_tracks then
		statements[#statements + 1] = local_declaration_statement(
			{ 'sample_tracks' },
			{ identifier('sample_tracks') },
			true
		)
	end
	if values.has_pingpong_tracks then
		statements[#statements + 1] = local_declaration_statement(
			{ 'pingpong01' },
			{ identifier('pingpong01') },
			true
		)
	end
	if values.has_sin_tracks then
		statements[#statements + 1] = local_declaration_statement(
			{ 'sin' },
			{ identifier('sin') },
			true
		)
		statements[#statements + 1] = local_declaration_statement(
			{ 'tau' },
			{ identifier('tau') },
			true
		)
	end
end

local emit_sample_track_captures<const> = function(statements, tracks)
	local sample_tracks<const> = identifier('sample_tracks')
	for index = 1, #tracks do
		local track<const> = tracks[index]
		local source_track<const> = index_expression(sample_tracks, numeric_literal(index))
		if track.kind == 'sample' then
			statements[#statements + 1] = local_declaration_statement(
				{ sample_name('sample_callback_', index) },
				{ member_expression(source_track, 'apply') },
				true
			)
		else
			if track.base_param == nil then
				statements[#statements + 1] = local_declaration_statement(
					{ sample_name('sample_base_', index) },
					{ member_expression(source_track, 'base') },
					true
				)
			end
			statements[#statements + 1] = local_declaration_statement(
				{ sample_name('sample_amp_', index) },
				{ member_expression(source_track, 'amp') },
				true
			)
			statements[#statements + 1] = local_declaration_statement(
				{ sample_name('sample_phase_', index) },
				{ member_expression(source_track, 'phase') },
				true
			)
			statements[#statements + 1] = local_declaration_statement(
				{ sample_name('sample_period_inv_', index) },
				{ member_expression(source_track, 'period_inv') },
				true
			)
			if track.ease ~= nil then
				statements[#statements + 1] = local_declaration_statement(
					{ sample_name('sample_ease_', index) },
					{ member_expression(source_track, 'ease') },
					true
				)
			end
		end
	end
end

local sample_target<const> = function(track)
	if track.binding_index == 1 then
		return expression.primary_binding
	end
	return index_expression(identifier('bindings'), numeric_literal(track.binding_index))
end

local emit_sample_track<const> = function(statements, track, index)
	local target<const> = sample_target(track)
	if track.kind == 'sample' then
		statements[#statements + 1] = call_statement(call_expression(
			identifier(sample_name('sample_callback_', index)),
			{ target, expression.params, expression.evaluation, expression.time_seconds }
		))
		return
	end
	local period_inv<const> = identifier(sample_name('sample_period_inv_', index))
	local phase<const> = identifier(sample_name('sample_phase_', index))
	local wave_position<const> = binary_expression(
		binary_operator.add,
		binary_expression(binary_operator.multiply, expression.time_seconds, period_inv),
		phase
	)
	if track.wave == 'pingpong' then
		statements[#statements + 1] = assignment_statement(
			{ expression.wave_value },
			{ call_expression(identifier('pingpong01'), { wave_position }) }
		)
	else
		statements[#statements + 1] = assignment_statement(
			{ expression.wave_value },
			{
				binary_expression(
					binary_operator.multiply,
					binary_expression(
						binary_operator.add,
						call_expression(identifier('sin'), {
							binary_expression(
								binary_operator.multiply,
								wave_position,
								identifier('tau')
							),
						}),
						numeric_literal(1)
					),
					numeric_literal(0.5)
				),
			}
		)
	end
	if track.ease ~= nil then
		statements[#statements + 1] = assignment_statement(
			{ expression.wave_value },
			{
				call_expression(
					identifier(sample_name('sample_ease_', index)),
					{ expression.wave_value }
				),
			}
		)
	end
	local base = identifier(sample_name('sample_base_', index))
	if track.base_param ~= nil then
		base = index_expression(expression.params, string_literal(track.base_param))
	end
	statements[#statements + 1] = assignment_statement(
		{ index_path(target, track.path) },
		{
			binary_expression(
				binary_operator.add,
				base,
				binary_expression(
					binary_operator.multiply,
					binary_expression(
						binary_operator.multiply,
						binary_expression(
							binary_operator.subtract,
							expression.wave_value,
							numeric_literal(0.5)
						),
						numeric_literal(2)
					),
					identifier(sample_name('sample_amp_', index))
				)
			),
		}
	)
end

local emit_sample<const> = function(statements, values)
	if not values.has_sample_tracks then
		return
	end
	local body<const> = {}
	if values.has_sample_params and not values.has_frame_steps and not values.has_time_steps then
		body[#body + 1] = local_declaration_statement(
			{ 'params' },
			{ member_expression(expression.entry, 'params') },
			true
		)
	end
	if values.has_primary_sample_binding then
		body[#body + 1] = local_declaration_statement(
			{ 'primary_binding' },
			{ member_expression(expression.entry, 'primary_binding') },
			true
		)
	end
	if values.has_secondary_sample_binding then
		body[#body + 1] = local_declaration_statement(
			{ 'bindings' },
			{ member_expression(expression.entry, 'bindings') },
			true
		)
	end
	body[#body + 1] = local_declaration_statement(
		{ 'time_seconds' },
		{
			binary_expression(
				binary_operator.multiply,
				expression.time_ms,
				numeric_literal(0.001)
			),
		},
		true
	)
	if values.has_wave_tracks then
		body[#body + 1] = local_declaration_statement({ 'wave_value' }, {}, false)
	end
	for index = 1, #values.sample_tracks do
		emit_sample_track(body, values.sample_tracks[index], index)
	end
	statements[#statements + 1] = if_statement({
		{
			binary_expression(
				binary_operator.not_equal,
				binary_expression(
					binary_operator.bitwise_and,
					expression.flags,
					numeric_literal(values.sample_flag)
				),
				numeric_literal(0)
			),
			body,
		},
	})
end

local emit_value_runner<const> = function(statements, values)
	if values.has_frame_steps or values.has_time_steps then
		statements[#statements + 1] = local_declaration_statement(
			{ 'params' },
			{ member_expression(expression.entry, 'params') },
			true
		)
	end
	if values.has_frame_steps then
		statements[#statements + 1] = call_statement(call_expression(
			identifier('evaluate_frame_steps'),
			{
				expression.entry,
				identifier('steps'),
				expression.params,
				expression.previous_frame,
				expression.frame,
				identifier('direction'),
				expression.flags,
				expression.evaluation,
			}
		))
	end
	if values.has_time_steps then
		statements[#statements + 1] = call_statement(call_expression(
			identifier('evaluate_time_steps'),
			{
				expression.entry,
				identifier('steps'),
				expression.params,
				expression.previous_frame,
				expression.previous_time_ms,
				expression.time_ms,
				expression.flags,
				expression.evaluation,
			}
		))
	end
	if values.has_scalar_channels then
		statements[#statements + 1] = call_statement(call_expression(identifier('scalar_runner'), {
			expression.entry,
			expression.frame,
			expression.time_ms,
			expression.flags,
			expression.evaluation,
		}))
	end
	emit_sample(statements, values)
end

function track_evaluator_source.build(values)
	local statements<const> = {}
	emit_dependency_captures(statements, values)
	emit_sample_track_captures(statements, values.sample_tracks)
	local factory_body<const> = {}
	if values.has_frame_steps or values.has_time_steps then
		factory_body[#factory_body + 1] = local_declaration_statement(
			{ 'steps' },
			{ member_expression(expression.tracks, 'steps') },
			true
		)
	end
	local runner_body<const> = {}
	emit_value_runner(runner_body, values)
	factory_body[#factory_body + 1] = return_statement({
		function_expression({
			'entry',
			'previous_frame',
			'frame',
			'previous_time_ms',
			'time_ms',
			'direction',
			'flags',
			'evaluation',
		}, runner_body),
	})
	statements[#statements + 1] = return_statement({
		function_expression(
			{ 'tracks', 'evaluate_frame_steps', 'evaluate_time_steps', 'scalar_runner' },
			factory_body
		),
	})
	return lua_syntax.chunk(statements)
end

return track_evaluator_source
