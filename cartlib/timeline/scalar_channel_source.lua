local syntax_factory<const> = lua_compiler.syntax_factory

local scalar_channel_source<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local numeric_literal<const> = syntax_factory.number_literal
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
local else_clause<const> = syntax_factory.else_clause
local if_statement<const> = syntax_factory.if_statement
local while_statement<const> = syntax_factory.while_statement
local return_statement<const> = syntax_factory.return_statement

local emit_locals<const> = function(statements, analysis, has_cubic_tracks)
	statements[#statements + 1] = local_statement(identifier('keys'), nil, false)
	statements[#statements + 1] = local_statement(identifier('value'), nil, false)
	if analysis.has_callback then
		statements[#statements + 1] = local_statement(identifier('track'), nil, false)
		statements[#statements + 1] = local_statement(
			identifier('params'),
			member_expression(identifier('entry'), 'params'),
			false
		)
	end
	if analysis.has_primary_binding then
		statements[#statements + 1] = local_statement(
			identifier('primary_binding'),
			member_expression(identifier('entry'), 'primary_binding'),
			false
		)
	end
	if analysis.has_secondary_binding then
		statements[#statements + 1] = local_statement(
			identifier('bindings'),
			member_expression(identifier('entry'), 'bindings'),
			false
		)
	end
	if analysis.cached_segment_count > 0 then
		statements[#statements + 1] = local_statement(
			identifier('cached_segments'),
			member_expression(identifier('entry'), 'cached_scalar_segments'),
			false
		)
	end
	if analysis.max_key_count > 1 then
		statements[#statements + 1] = local_statement(identifier('position'), nil, false)
		statements[#statements + 1] = local_statement(identifier('first_key'), nil, false)
		statements[#statements + 1] = local_statement(identifier('last_key'), nil, false)
		statements[#statements + 1] = local_statement(identifier('key'), nil, false)
	end
	if analysis.max_key_count > 2 then
		statements[#statements + 1] = local_statement(identifier('low'), nil, false)
		statements[#statements + 1] = local_statement(identifier('high'), nil, false)
		statements[#statements + 1] = local_statement(identifier('middle'), nil, false)
	end
	if has_cubic_tracks then
		statements[#statements + 1] = local_statement(identifier('u'), nil, false)
	end
end

local emit_segment_search<const> = function(statements, track, position_key, key_count)
	if key_count == 2 then
		statements[#statements + 1] = assignment_statement(
			identifier('key'),
			identifier('first_key')
		)
		return
	end
	statements[#statements + 1] = assignment_statement(
		identifier('key'),
		index_expression(
			identifier('cached_segments'),
			numeric_literal(track.cached_segment_index)
		)
	)
	local search_body<const> = {
		assignment_statement(identifier('low'), numeric_literal(1)),
		assignment_statement(identifier('high'), numeric_literal(key_count + 1)),
		while_statement(
			binary_expression(syntax.binary_less, identifier('low'), identifier('high')),
			block({
				assignment_statement(
					identifier('middle'),
					binary_expression(
						syntax.binary_floor_divide,
						binary_expression(
							syntax.binary_add,
							identifier('low'),
							identifier('high')
						),
						numeric_literal(2)
					)
				),
				if_statement({
					if_clause(
						binary_expression(
							syntax.binary_less_equal,
							member_expression(
								index_expression(identifier('keys'), identifier('middle')),
								position_key
							),
							identifier('position')
						),
						block({
							assignment_statement(
								identifier('low'),
								binary_expression(
									syntax.binary_add,
									identifier('middle'),
									numeric_literal(1)
								)
							),
						})
					),
					else_clause(block({
						assignment_statement(identifier('high'), identifier('middle')),
					})),
				}),
			})
		),
		assignment_statement(
			identifier('key'),
			index_expression(
				identifier('keys'),
				binary_expression(
					syntax.binary_subtract,
					identifier('low'),
					numeric_literal(1)
				)
			)
		),
		assignment_statement(
			index_expression(
				identifier('cached_segments'),
				numeric_literal(track.cached_segment_index)
			),
			identifier('key')
		),
	}
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_or,
				binary_expression(
					syntax.binary_less,
					identifier('position'),
					member_expression(identifier('key'), position_key)
				),
				binary_expression(
					syntax.binary_greater_equal,
					identifier('position'),
					member_expression(identifier('key'), 'segment_end')
				)
			),
			block(search_body)
		),
	})
end

local emit_interpolation<const> = function(statements, position_key, cubic)
	local position_delta<const> = binary_expression(
		syntax.binary_subtract,
		identifier('position'),
		member_expression(identifier('key'), position_key)
	)
	if cubic then
		statements[#statements + 1] = assignment_statement(
			identifier('u'),
			binary_expression(
				syntax.binary_multiply,
				position_delta,
				member_expression(identifier('key'), 'span_inv')
			)
		)
		statements[#statements + 1] = assignment_statement(
			identifier('value'),
			binary_expression(
				syntax.binary_add,
				binary_expression(
					syntax.binary_multiply,
					binary_expression(
						syntax.binary_add,
						binary_expression(
							syntax.binary_multiply,
							binary_expression(
								syntax.binary_add,
								binary_expression(
									syntax.binary_multiply,
									member_expression(identifier('key'), 'cubic3'),
									identifier('u')
								),
								member_expression(identifier('key'), 'cubic2')
							),
							identifier('u')
						),
						member_expression(identifier('key'), 'cubic1')
					),
					identifier('u')
				),
				member_expression(identifier('key'), 'value')
			)
		)
		return
	end
	statements[#statements + 1] = assignment_statement(
		identifier('value'),
		binary_expression(
			syntax.binary_add,
			member_expression(identifier('key'), 'value'),
			binary_expression(
				syntax.binary_multiply,
				member_expression(identifier('key'), 'value_delta'),
				binary_expression(
					syntax.binary_multiply,
					position_delta,
					member_expression(identifier('key'), 'span_inv')
				)
			)
		)
	)
end

local emit_track_sample<const> = function(statements, track, position_key, cubic)
	local key_count<const> = #track.keys
	if key_count == 1 then
		statements[#statements + 1] = assignment_statement(
			identifier('value'),
			member_expression(
				index_expression(identifier('keys'), numeric_literal(1)),
				'value'
			)
		)
		return
	end
	statements[#statements + 1] = assignment_statement(
		identifier('first_key'),
		index_expression(identifier('keys'), numeric_literal(1))
	)
	local final_segment<const> = {}
	emit_segment_search(final_segment, track, position_key, key_count)
	emit_interpolation(final_segment, position_key, cubic)
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_less_equal,
				identifier('position'),
				member_expression(identifier('first_key'), position_key)
			),
			block({
				assignment_statement(
					identifier('value'),
					member_expression(identifier('first_key'), 'value')
				),
			})
		),
		else_clause(block({
			assignment_statement(
				identifier('last_key'),
				index_expression(identifier('keys'), numeric_literal(key_count))
			),
			if_statement({
				if_clause(
					binary_expression(
						syntax.binary_greater_equal,
						identifier('position'),
						member_expression(identifier('last_key'), position_key)
					),
					block({
						assignment_statement(
							identifier('value'),
							member_expression(identifier('last_key'), 'value')
						),
					})
				),
				else_clause(block(final_segment)),
			}),
		})),
	})
end

local emit_track<const> = function(statements, track_list_name, track_index, track, position_key, cubic)
	local source_track<const> = index_expression(
		member_expression(identifier('channels'), track_list_name),
		numeric_literal(track_index)
	)
	if track.apply ~= nil then
		statements[#statements + 1] = assignment_statement(identifier('track'), source_track)
		statements[#statements + 1] = assignment_statement(
			identifier('keys'),
			member_expression(identifier('track'), 'keys')
		)
	else
		statements[#statements + 1] = assignment_statement(
			identifier('keys'),
			member_expression(source_track, 'keys')
		)
	end
	emit_track_sample(statements, track, position_key, cubic)
	local binding
	if track.binding_index == 1 then
		binding = identifier('primary_binding')
	else
		binding = index_expression(identifier('bindings'), numeric_literal(track.binding_index))
	end
	if track.apply ~= nil then
		statements[#statements + 1] = call_statement(call_expression(
			member_expression(identifier('track'), 'apply'),
			{
				binding,
				identifier('value'),
				identifier('params'),
				identifier('evaluation'),
			}
		))
	else
		statements[#statements + 1] = assignment_statement(
			index_path(binding, track.path),
			identifier('value')
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
		body[#body + 1] = assignment_statement(identifier('position'), identifier('frame'))
	end
	emit_tracks(body, 'linear_tracks', channels.linear_tracks, 'frame', false)
	emit_tracks(body, 'cubic_tracks', channels.cubic_tracks, 'frame', true)
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_not_equal,
				binary_expression(
					syntax.binary_bitwise_and,
					identifier('flags'),
					numeric_literal(sample_flag)
				),
				numeric_literal(0)
			),
			block(body)
		),
	})
end

local emit_time_lane<const> = function(statements, channels, analysis)
	if #channels.linear_time_tracks == 0 and #channels.cubic_time_tracks == 0 then
		return
	end
	if analysis.time_max_key_count > 1 then
		statements[#statements + 1] = assignment_statement(
			identifier('position'),
			identifier('time_ms')
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
	return syntax_factory.chunk(block({
		return_statement({
			function_expression(
				{ identifier('source_channels') },
				block({
					local_statement(
						identifier('channels'),
						identifier('source_channels'),
						true
					),
					return_statement({
						function_expression(
							{
								identifier('entry'),
								identifier('frame'),
								identifier('time_ms'),
								identifier('flags'),
								identifier('evaluation'),
							},
							block(evaluator_body)
						),
					}),
				})
			),
		}),
	}))
end

return scalar_channel_source
