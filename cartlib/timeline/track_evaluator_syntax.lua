-- Admission-only lowering from cooked track capabilities to canonical firmware
-- syntax. Runtime evaluation contains only the selected traversal phases.
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

local sample_name<const> = function(prefix, index)
	return prefix .. index
end

local emit_dependency_captures<const> = function(statements, values)
	step_track_syntax.emit_dependency_captures(statements, values)
	if values.has_sample_tracks then
		statements[#statements + 1] = local_statement(
			identifier('sample_tracks'),
			identifier('sample_tracks'),
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
		statements[#statements + 1] = local_statement(
			identifier('tau'),
			identifier('tau'),
			true
		)
	end
end

local sample_track_expression<const> = function(index)
	return index_expression(identifier('sample_tracks'), numeric_literal(index))
end

local emit_sample_track_captures<const> = function(statements, tracks)
	for index = 1, #tracks do
		local track<const> = tracks[index]
		if track.kind == 'sample' then
			statements[#statements + 1] = local_statement(
				identifier(sample_name('sample_callback_', index)),
				member_expression(sample_track_expression(index), 'apply'),
				true
			)
		else
			if track.base_param == nil then
				statements[#statements + 1] = local_statement(
					identifier(sample_name('sample_base_', index)),
					member_expression(sample_track_expression(index), 'base'),
					true
				)
			end
			statements[#statements + 1] = local_statement(
				identifier(sample_name('sample_amp_', index)),
				member_expression(sample_track_expression(index), 'amp'),
				true
			)
			statements[#statements + 1] = local_statement(
				identifier(sample_name('sample_phase_', index)),
				member_expression(sample_track_expression(index), 'phase'),
				true
			)
			statements[#statements + 1] = local_statement(
				identifier(sample_name('sample_period_inv_', index)),
				member_expression(sample_track_expression(index), 'period_inv'),
				true
			)
			if track.ease ~= nil then
				statements[#statements + 1] = local_statement(
					identifier(sample_name('sample_ease_', index)),
					member_expression(sample_track_expression(index), 'ease'),
					true
				)
			end
		end
	end
end

local sample_target<const> = function(track)
	if track.binding_index == 1 then
		return identifier('primary_binding')
	end
	return index_expression(identifier('bindings'), numeric_literal(track.binding_index))
end

local emit_sample_track<const> = function(statements, track, index)
	local target<const> = sample_target(track)
	if track.kind == 'sample' then
		statements[#statements + 1] = call_statement(call_expression(
			identifier(sample_name('sample_callback_', index)),
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
			identifier(sample_name('sample_period_inv_', index))
		),
		identifier(sample_name('sample_phase_', index))
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
							identifier('tau')
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
				identifier(sample_name('sample_ease_', index)),
				{ identifier('wave_value') }
			)
		)
	end
	local base
	if track.base_param == nil then
		base = identifier(sample_name('sample_base_', index))
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
				identifier(sample_name('sample_amp_', index))
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
		emit_sample_track(body, values.sample_tracks[index], index)
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
			block(body)
		),
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
		statements[#statements + 1] = call_statement(call_expression(identifier('scalar_runner'), {
			identifier('entry'),
			identifier('frame'),
			identifier('time_ms'),
			identifier('flags'),
			identifier('evaluation'),
		}))
	end
	emit_sample(statements, values)
end

function track_evaluator_syntax.build(values)
	local statements<const> = {}
	emit_dependency_captures(statements, values)
	emit_sample_track_captures(statements, values.sample_tracks)
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
			{
				identifier('entry'),
				identifier('previous_frame'),
				identifier('frame'),
				identifier('previous_time_ms'),
				identifier('time_ms'),
				identifier('direction'),
				identifier('flags'),
				identifier('evaluation'),
			},
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
				{
					identifier('entry'),
					identifier('previous_frame'),
					identifier('frame'),
					identifier('previous_time_ms'),
					identifier('time_ms'),
					identifier('direction'),
					identifier('flags'),
					identifier('evaluation'),
				},
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
