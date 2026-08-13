local lua_syntax<const> = require('cartlib/codegen/lua_syntax')

local scalar_channel_source<const> = {}
local binary_operator<const> = lua_syntax.binary_operator
local identifier<const> = lua_syntax.identifier
local numeric_literal<const> = lua_syntax.numeric_literal
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
local while_statement<const> = lua_syntax.while_statement
local return_statement<const> = lua_syntax.return_statement

local expression<const> = {
	channels = identifier('channels'),
	entry = identifier('entry'),
	evaluation = identifier('evaluation'),
	first_key = identifier('first_key'),
	flags = identifier('flags'),
	frame = identifier('frame'),
	high = identifier('high'),
	key = identifier('key'),
	keys = identifier('keys'),
	last_key = identifier('last_key'),
	low = identifier('low'),
	middle = identifier('middle'),
	params = identifier('params'),
	position = identifier('position'),
	primary_binding = identifier('primary_binding'),
	time_ms = identifier('time_ms'),
	track = identifier('track'),
	u = identifier('u'),
	value = identifier('value'),
}

local emit_locals<const> = function(statements, analysis, has_cubic_tracks)
	statements[#statements + 1] = local_declaration_statement({ 'keys' }, {}, false)
	statements[#statements + 1] = local_declaration_statement({ 'value' }, {}, false)
	if analysis.has_callback then
		statements[#statements + 1] = local_declaration_statement({ 'track' }, {}, false)
		statements[#statements + 1] = local_declaration_statement(
			{ 'params' },
			{ member_expression(expression.entry, 'params') },
			false
		)
	end
	if analysis.has_primary_binding then
		statements[#statements + 1] = local_declaration_statement(
			{ 'primary_binding' },
			{ member_expression(expression.entry, 'primary_binding') },
			false
		)
	end
	if analysis.has_secondary_binding then
		statements[#statements + 1] = local_declaration_statement(
			{ 'bindings' },
			{ member_expression(expression.entry, 'bindings') },
			false
		)
	end
	if analysis.cached_segment_count > 0 then
		statements[#statements + 1] = local_declaration_statement(
			{ 'cached_segments' },
			{ member_expression(expression.entry, 'cached_scalar_segments') },
			false
		)
	end
	if analysis.max_key_count > 1 then
		statements[#statements + 1] = local_declaration_statement({ 'position' }, {}, false)
		statements[#statements + 1] = local_declaration_statement({ 'first_key' }, {}, false)
		statements[#statements + 1] = local_declaration_statement({ 'last_key' }, {}, false)
		statements[#statements + 1] = local_declaration_statement({ 'key' }, {}, false)
	end
	if analysis.max_key_count > 2 then
		statements[#statements + 1] = local_declaration_statement({ 'low' }, {}, false)
		statements[#statements + 1] = local_declaration_statement({ 'high' }, {}, false)
		statements[#statements + 1] = local_declaration_statement({ 'middle' }, {}, false)
	end
	if has_cubic_tracks then
		statements[#statements + 1] = local_declaration_statement({ 'u' }, {}, false)
	end
end

local emit_segment_search<const> = function(statements, track, position_key, key_count)
	if key_count == 2 then
		statements[#statements + 1] = assignment_statement(
			{ expression.key },
			{ expression.first_key }
		)
		return
	end
	local cached_segment<const> = index_expression(
		identifier('cached_segments'),
		numeric_literal(track.cached_segment_index)
	)
	statements[#statements + 1] = assignment_statement(
		{ expression.key },
		{ cached_segment }
	)
	local search_body<const> = {
		assignment_statement({ expression.low }, { numeric_literal(1) }),
		assignment_statement({ expression.high }, { numeric_literal(key_count + 1) }),
		while_statement(
			binary_expression(binary_operator.less_than, expression.low, expression.high),
			{
				assignment_statement(
					{ expression.middle },
					{
						binary_expression(
							binary_operator.floor_divide,
							binary_expression(binary_operator.add, expression.low, expression.high),
							numeric_literal(2)
						),
					}
				),
				if_statement({
					{
						binary_expression(
							binary_operator.less_equal,
							member_expression(
								index_expression(expression.keys, expression.middle),
								position_key
							),
							expression.position
						),
						{
							assignment_statement(
								{ expression.low },
								{
									binary_expression(
										binary_operator.add,
										expression.middle,
										numeric_literal(1)
									),
								}
							),
						},
					},
					{
						nil,
						{ assignment_statement({ expression.high }, { expression.middle }) },
					},
				}),
			}
		),
		assignment_statement(
			{ expression.key },
			{
				index_expression(
					expression.keys,
					binary_expression(binary_operator.subtract, expression.low, numeric_literal(1))
				),
			}
		),
		assignment_statement({ cached_segment }, { expression.key }),
	}
	statements[#statements + 1] = if_statement({
		{
			binary_expression(
				binary_operator.logical_or,
				binary_expression(
					binary_operator.less_than,
					expression.position,
					member_expression(expression.key, position_key)
				),
				binary_expression(
					binary_operator.greater_equal,
					expression.position,
					member_expression(expression.key, 'segment_end')
				)
			),
			search_body,
		},
	})
end

local emit_interpolation<const> = function(statements, position_key, cubic)
	local position_delta<const> = binary_expression(
		binary_operator.subtract,
		expression.position,
		member_expression(expression.key, position_key)
	)
	if cubic then
		statements[#statements + 1] = assignment_statement(
			{ expression.u },
			{
				binary_expression(
					binary_operator.multiply,
					position_delta,
					member_expression(expression.key, 'span_inv')
				),
			}
		)
		statements[#statements + 1] = assignment_statement(
			{ expression.value },
			{
				binary_expression(
					binary_operator.add,
					binary_expression(
						binary_operator.multiply,
						binary_expression(
							binary_operator.add,
							binary_expression(
								binary_operator.multiply,
								binary_expression(
									binary_operator.add,
									binary_expression(
										binary_operator.multiply,
										member_expression(expression.key, 'cubic3'),
										expression.u
									),
									member_expression(expression.key, 'cubic2')
								),
								expression.u
							),
							member_expression(expression.key, 'cubic1')
						),
						expression.u
					),
					member_expression(expression.key, 'value')
				),
			}
		)
		return
	end
	statements[#statements + 1] = assignment_statement(
		{ expression.value },
		{
			binary_expression(
				binary_operator.add,
				member_expression(expression.key, 'value'),
				binary_expression(
					binary_operator.multiply,
					member_expression(expression.key, 'value_delta'),
					binary_expression(
						binary_operator.multiply,
						position_delta,
						member_expression(expression.key, 'span_inv')
					)
				)
			),
		}
	)
end

local emit_track_sample<const> = function(statements, track, position_key, cubic)
	local keys<const> = expression.keys
	local key_count<const> = #track.keys
	if key_count == 1 then
		statements[#statements + 1] = assignment_statement(
			{ expression.value },
			{ member_expression(index_expression(keys, numeric_literal(1)), 'value') }
		)
		return
	end
	statements[#statements + 1] = assignment_statement(
		{ expression.first_key },
		{ index_expression(keys, numeric_literal(1)) }
	)
	local final_segment<const> = {}
	emit_segment_search(final_segment, track, position_key, key_count)
	emit_interpolation(final_segment, position_key, cubic)
	statements[#statements + 1] = if_statement({
		{
			binary_expression(
				binary_operator.less_equal,
				expression.position,
				member_expression(expression.first_key, position_key)
			),
			{
				assignment_statement(
					{ expression.value },
					{ member_expression(expression.first_key, 'value') }
				),
			},
		},
		{
			nil,
			{
				assignment_statement(
					{ expression.last_key },
					{ index_expression(keys, numeric_literal(key_count)) }
				),
				if_statement({
					{
						binary_expression(
							binary_operator.greater_equal,
							expression.position,
							member_expression(expression.last_key, position_key)
						),
						{
							assignment_statement(
								{ expression.value },
								{ member_expression(expression.last_key, 'value') }
							),
						},
					},
					{ nil, final_segment },
				}),
			},
		},
	})
end

local emit_track<const> = function(statements, track_list_name, track_index, track, position_key, cubic)
	local source_track<const> = index_expression(
		member_expression(expression.channels, track_list_name),
		numeric_literal(track_index)
	)
	if track.apply ~= nil then
		statements[#statements + 1] = assignment_statement(
			{ expression.track },
			{ source_track }
		)
		statements[#statements + 1] = assignment_statement(
			{ expression.keys },
			{ member_expression(expression.track, 'keys') }
		)
	else
		statements[#statements + 1] = assignment_statement(
			{ expression.keys },
			{ member_expression(source_track, 'keys') }
		)
	end
	emit_track_sample(statements, track, position_key, cubic)
	local binding = expression.primary_binding
	if track.binding_index ~= 1 then
		binding = index_expression(identifier('bindings'), numeric_literal(track.binding_index))
	end
	if track.apply ~= nil then
		statements[#statements + 1] = call_statement(call_expression(
			member_expression(expression.track, 'apply'),
			{ binding, expression.value, expression.params, expression.evaluation }
		))
	else
		statements[#statements + 1] = assignment_statement(
			{ index_path(binding, track.path) },
			{ expression.value }
		)
	end
end

local emit_tracks<const> = function(statements, track_list_name, tracks, position_key, cubic)
	for track_index = 1, #tracks do
		emit_track(statements, track_list_name, track_index, tracks[track_index], position_key, cubic)
	end
end

local emit_frame_lane<const> = function(statements, channels, analysis, sample_flag)
	if #channels.linear_tracks == 0 and #channels.cubic_tracks == 0 then
		return
	end
	local body<const> = {}
	if analysis.frame_max_key_count > 1 then
		body[#body + 1] = assignment_statement({ expression.position }, { expression.frame })
	end
	emit_tracks(body, 'linear_tracks', channels.linear_tracks, 'frame', false)
	emit_tracks(body, 'cubic_tracks', channels.cubic_tracks, 'frame', true)
	statements[#statements + 1] = if_statement({
		{
			binary_expression(
				binary_operator.not_equal,
				binary_expression(
					binary_operator.bitwise_and,
					expression.flags,
					numeric_literal(sample_flag)
				),
				numeric_literal(0)
			),
			body,
		},
	})
end

local emit_time_lane<const> = function(statements, channels, analysis)
	if #channels.linear_time_tracks == 0 and #channels.cubic_time_tracks == 0 then
		return
	end
	if analysis.time_max_key_count > 1 then
		statements[#statements + 1] = assignment_statement(
			{ expression.position },
			{ expression.time_ms }
		)
	end
	emit_tracks(statements, 'linear_time_tracks', channels.linear_time_tracks, 'time_ms', false)
	emit_tracks(statements, 'cubic_time_tracks', channels.cubic_time_tracks, 'time_ms', true)
end

function scalar_channel_source.build(channels, analysis, sample_flag)
	local evaluator_body<const> = {}
	emit_locals(
		evaluator_body,
		analysis,
		#channels.cubic_tracks > 0 or #channels.cubic_time_tracks > 0
	)
	emit_frame_lane(evaluator_body, channels, analysis, sample_flag)
	emit_time_lane(evaluator_body, channels, analysis)
	return lua_syntax.chunk({
		return_statement({
			function_expression({ 'source_channels' }, {
				local_declaration_statement(
					{ 'channels' },
					{ identifier('source_channels') },
					true
				),
				return_statement({
					function_expression(
						{ 'entry', 'frame', 'time_ms', 'flags', 'evaluation' },
						evaluator_body
					),
				}),
			}),
		}),
	})
end

return scalar_channel_source
