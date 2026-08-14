-- Admission-only lowering from scalar channel shape to canonical firmware
-- syntax. The generated runner owns the 50 Hz sampling loops.
local syntax_factory<const> = lua_compiler.syntax_factory

local scalar_channel_syntax<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local generated_symbol<const> = syntax_factory.generated_symbol
local reference<const> = syntax_factory.reference
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

local symbols<const> = {
	entry = generated_symbol('entry'),
	frame = generated_symbol('frame'),
	time_ms = generated_symbol('time_ms'),
	flags = generated_symbol('flags'),
	sample = generated_symbol('sample'),
	evaluation = generated_symbol('evaluation'),
	keys = generated_symbol('keys'),
	value = generated_symbol('value'),
	params = generated_symbol('params'),
	primary_binding = generated_symbol('primary_binding'),
	bindings = generated_symbol('bindings'),
	cached_segments = generated_symbol('cached_segments'),
	first_key = generated_symbol('first_key'),
	last_key = generated_symbol('last_key'),
	key = generated_symbol('key'),
	low = generated_symbol('low'),
	high = generated_symbol('high'),
	middle = generated_symbol('middle'),
	u = generated_symbol('u'),
	position = generated_symbol('position'),
	scalar_callbacks = generated_symbol('scalar_callbacks'),
	source_channels = generated_symbol('source_channels'),
}

local new_track_family<const> = function(track_list_member, single_track_member)
	return {
		track_list_member = track_list_member,
		single_track_member = single_track_member,
		track_list_symbol = generated_symbol('scalar_tracks'),
		single_symbols = {
			keys = generated_symbol('scalar_keys'),
			value = generated_symbol('scalar_value'),
			first_key = generated_symbol('scalar_first_key'),
			last_key = generated_symbol('scalar_last_key'),
		},
	}
end

local linear_frame_family<const> = new_track_family('linear_tracks', 'linear_track')
local cubic_frame_family<const> = new_track_family('cubic_tracks', 'cubic_track')
local linear_time_family<const> = new_track_family('linear_time_tracks', 'linear_time_track')
local cubic_time_family<const> = new_track_family('cubic_time_tracks', 'cubic_time_track')
local track_families<const> = {
	linear_frame_family,
	cubic_frame_family,
	linear_time_family,
	cubic_time_family,
}

local evaluator_parameters<const> = function(channels, analysis)
	local parameters<const> = { reference(symbols.entry) }
	if #channels.linear_tracks > 0 or #channels.cubic_tracks > 0 then
		parameters[#parameters + 1] = reference(symbols.frame)
	end
	if #channels.linear_time_tracks > 0 or #channels.cubic_time_tracks > 0 then
		parameters[#parameters + 1] = reference(symbols.time_ms)
	end
	if (#channels.linear_tracks > 0 or #channels.cubic_tracks > 0)
	and analysis.callback_functions == nil then
		parameters[#parameters + 1] = reference(symbols.flags)
	end
	if (#channels.linear_tracks > 0 or #channels.cubic_tracks > 0)
	and analysis.callback_functions ~= nil then
		parameters[#parameters + 1] = reference(symbols.sample)
	end
	if analysis.callback_functions ~= nil then
		parameters[#parameters + 1] = reference(symbols.evaluation)
	end
	return parameters
end

local emit_locals<const> = function(statements, analysis, has_cubic_tracks)
	if analysis.has_key_arrays then
		statements[#statements + 1] = local_statement(reference(symbols.keys), nil, false)
	end
	statements[#statements + 1] = local_statement(reference(symbols.value), nil, false)
	if analysis.callback_functions ~= nil then
		statements[#statements + 1] = local_statement(
			reference(symbols.params),
			member_expression(reference(symbols.entry), 'params'),
			false
		)
	end
	if analysis.has_primary_binding then
		statements[#statements + 1] = local_statement(
			reference(symbols.primary_binding),
			member_expression(reference(symbols.entry), 'primary_binding'),
			false
		)
	end
	if analysis.has_secondary_binding then
		statements[#statements + 1] = local_statement(
			reference(symbols.bindings),
			member_expression(reference(symbols.entry), 'bindings'),
			false
		)
	end
	if analysis.cached_segment_count > 0 then
		statements[#statements + 1] = local_statement(
			reference(symbols.cached_segments),
			member_expression(reference(symbols.entry), 'cached_scalar_segments'),
			false
		)
	end
	if analysis.max_key_count > 1 then
		statements[#statements + 1] = local_statement(reference(symbols.first_key), nil, false)
		statements[#statements + 1] = local_statement(reference(symbols.last_key), nil, false)
	end
	if analysis.max_key_count > 2 then
		statements[#statements + 1] = local_statement(reference(symbols.key), nil, false)
		statements[#statements + 1] = local_statement(reference(symbols.low), nil, false)
		statements[#statements + 1] = local_statement(reference(symbols.high), nil, false)
		statements[#statements + 1] = local_statement(reference(symbols.middle), nil, false)
	end
	if has_cubic_tracks then
		statements[#statements + 1] = local_statement(reference(symbols.u), nil, false)
	end
end

local emit_segment_search<const> = function(statements, track, position_key, key_count)
	statements[#statements + 1] = assignment_statement(
		reference(symbols.key),
		index_expression(
			reference(symbols.cached_segments),
			numeric_literal(track.cached_segment_index)
		)
	)
	local search_body<const> = {
		assignment_statement(reference(symbols.low), numeric_literal(1)),
		assignment_statement(reference(symbols.high), numeric_literal(key_count + 1)),
		while_statement(
			binary_expression(syntax.binary_less, reference(symbols.low), reference(symbols.high)),
			block({
				assignment_statement(
					reference(symbols.middle),
					binary_expression(
						syntax.binary_floor_divide,
						binary_expression(
							syntax.binary_add,
							reference(symbols.low),
							reference(symbols.high)
						),
						numeric_literal(2)
					)
				),
				if_statement({
					if_clause(
						binary_expression(
							syntax.binary_less_equal,
							member_expression(
								index_expression(reference(symbols.keys), reference(symbols.middle)),
								position_key
							),
							reference(symbols.position)
						),
						block({
							assignment_statement(
								reference(symbols.low),
								binary_expression(
									syntax.binary_add,
									reference(symbols.middle),
									numeric_literal(1)
								)
							),
						})
					),
					else_clause(block({
						assignment_statement(reference(symbols.high), reference(symbols.middle)),
					})),
				}),
			})
		),
		assignment_statement(
			reference(symbols.key),
			index_expression(
				reference(symbols.keys),
				binary_expression(
					syntax.binary_subtract,
					reference(symbols.low),
					numeric_literal(1)
				)
			)
		),
		assignment_statement(
			index_expression(
				reference(symbols.cached_segments),
				numeric_literal(track.cached_segment_index)
			),
			reference(symbols.key)
		),
	}
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_or,
				binary_expression(
					syntax.binary_less,
					reference(symbols.position),
					member_expression(reference(symbols.key), position_key)
				),
				binary_expression(
					syntax.binary_greater_equal,
					reference(symbols.position),
					member_expression(reference(symbols.key), 'segment_end')
				)
			),
			block(search_body)
		),
	})
end

local emit_interpolation<const> = function(statements, position_key, cubic, key_symbol)
	local position_delta<const> = binary_expression(
		syntax.binary_subtract,
		reference(symbols.position),
		member_expression(reference(key_symbol), position_key)
	)
	if cubic then
		statements[#statements + 1] = assignment_statement(
			reference(symbols.u),
			binary_expression(
				syntax.binary_multiply,
				position_delta,
				member_expression(reference(key_symbol), 'span_inv')
			)
		)
		statements[#statements + 1] = assignment_statement(
			reference(symbols.value),
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
									member_expression(reference(key_symbol), 'cubic3'),
									reference(symbols.u)
								),
								member_expression(reference(key_symbol), 'cubic2')
							),
							reference(symbols.u)
						),
						member_expression(reference(key_symbol), 'cubic1')
					),
					reference(symbols.u)
				),
				member_expression(reference(key_symbol), 'value')
			)
		)
		return
	end
	statements[#statements + 1] = assignment_statement(
		reference(symbols.value),
		binary_expression(
			syntax.binary_add,
			member_expression(reference(key_symbol), 'value'),
			binary_expression(
				syntax.binary_multiply,
				member_expression(reference(key_symbol), 'value_delta'),
				binary_expression(
					syntax.binary_multiply,
					position_delta,
					member_expression(reference(key_symbol), 'span_inv')
				)
			)
		)
	)
end

local emit_track_sample<const> = function(statements, track, position_key, cubic, resolved_track_symbols)
	local key_count<const> = #track.keys
	if key_count == 1 then
		local value_source
		if resolved_track_symbols == nil then
			value_source = member_expression(
				index_expression(reference(symbols.keys), numeric_literal(1)),
				'value'
			)
		else
			value_source = reference(resolved_track_symbols.value)
		end
		statements[#statements + 1] = assignment_statement(
			reference(symbols.value),
			value_source
		)
		return
	end
	local first_key_source
	if resolved_track_symbols == nil then
		first_key_source = index_expression(reference(symbols.keys), numeric_literal(1))
	else
		first_key_source = reference(resolved_track_symbols.first_key)
	end
	statements[#statements + 1] = assignment_statement(
		reference(symbols.first_key),
		first_key_source
	)
	local final_segment<const> = {}
	local interpolation_key_symbol = symbols.first_key
	if key_count > 2 then
		emit_segment_search(final_segment, track, position_key, key_count)
		interpolation_key_symbol = symbols.key
	end
	emit_interpolation(final_segment, position_key, cubic, interpolation_key_symbol)
	local last_key_source
	if resolved_track_symbols == nil then
		last_key_source = index_expression(reference(symbols.keys), numeric_literal(key_count))
	else
		last_key_source = reference(resolved_track_symbols.last_key)
	end
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_less_equal,
				reference(symbols.position),
				member_expression(reference(symbols.first_key), position_key)
			),
			block({
				assignment_statement(
					reference(symbols.value),
					member_expression(reference(symbols.first_key), 'value')
				),
			})
		),
		else_clause(block({
			assignment_statement(
				reference(symbols.last_key),
				last_key_source
			),
			if_statement({
				if_clause(
					binary_expression(
						syntax.binary_greater_equal,
						reference(symbols.position),
						member_expression(reference(symbols.last_key), position_key)
					),
					block({
						assignment_statement(
							reference(symbols.value),
							member_expression(reference(symbols.last_key), 'value')
						),
					})
				),
				else_clause(block(final_segment)),
			}),
		})),
	})
end

local emit_track<const> = function(
	statements,
	source_keys,
	resolved_track_symbols,
	track,
	position_key,
	cubic,
	callback_symbols
)
	if source_keys ~= nil then
		statements[#statements + 1] = assignment_statement(
			reference(symbols.keys),
			source_keys
		)
	end
	emit_track_sample(statements, track, position_key, cubic, resolved_track_symbols)
	local binding
	if track.binding_index == 1 then
		binding = reference(symbols.primary_binding)
	else
		binding = index_expression(reference(symbols.bindings), numeric_literal(track.binding_index))
	end
	if track.apply ~= nil then
		statements[#statements + 1] = call_statement(call_expression(
			reference(callback_symbols[track.callback_index]),
			{
				binding,
				reference(symbols.value),
				reference(symbols.params),
				reference(symbols.evaluation),
			}
		))
	else
		statements[#statements + 1] = assignment_statement(
			index_path(binding, track.path),
			reference(symbols.value)
		)
	end
end

local emit_tracks<const> = function(
	statements,
	family,
	tracks,
	position_key,
	cubic,
	callback_symbols
)
	local track_count<const> = #tracks
	for track_index = 1, track_count do
		local track<const> = tracks[track_index]
		local source_keys
		local resolved_track_symbols
		if track_count == 1 then
			if #track.keys <= 2 then
				resolved_track_symbols = family.single_symbols
			else
				source_keys = reference(family.single_symbols.keys)
			end
		else
			source_keys = index_expression(
				reference(family.track_list_symbol),
				numeric_literal(track_index)
			)
		end
		emit_track(
			statements,
			source_keys,
			resolved_track_symbols,
			track,
			position_key,
			cubic,
			callback_symbols
		)
	end
end

local emit_frame_lane<const> = function(
	statements,
	channels,
	analysis,
	sample_flag,
	callback_symbols
)
	if #channels.linear_tracks == 0 and #channels.cubic_tracks == 0 then
		return
	end
	local body<const> = {}
	if analysis.frame_max_key_count > 1 then
		body[#body + 1] = local_statement(
			reference(symbols.position),
			reference(symbols.frame),
			true
		)
	end
	emit_tracks(body, linear_frame_family, channels.linear_tracks, 'frame', false, callback_symbols)
	emit_tracks(body, cubic_frame_family, channels.cubic_tracks, 'frame', true, callback_symbols)
	local sample_condition
	if analysis.callback_functions ~= nil then
		sample_condition = reference(symbols.sample)
	else
		sample_condition = binary_expression(
			syntax.binary_not_equal,
			binary_expression(
				syntax.binary_bitwise_and,
				reference(symbols.flags),
				numeric_literal(sample_flag)
			),
			numeric_literal(0)
		)
	end
	statements[#statements + 1] = if_statement({
		if_clause(sample_condition, block(body)),
	})
end

local emit_time_lane<const> = function(statements, channels, analysis, callback_symbols)
	if #channels.linear_time_tracks == 0 and #channels.cubic_time_tracks == 0 then
		return
	end
	if analysis.time_max_key_count > 1 then
		statements[#statements + 1] = local_statement(
			reference(symbols.position),
			reference(symbols.time_ms),
			true
		)
	end
	emit_tracks(
		statements,
		linear_time_family,
		channels.linear_time_tracks,
		'time_ms',
		false,
		callback_symbols
	)
	emit_tracks(
		statements,
		cubic_time_family,
		channels.cubic_time_tracks,
		'time_ms',
		true,
		callback_symbols
	)
end

local emit_single_track_captures<const> = function(statements, family, track)
	local single_symbols<const> = family.single_symbols
	statements[#statements + 1] = local_statement(
		reference(single_symbols.keys),
		member_expression(
			reference(symbols.source_channels),
			family.single_track_member
		),
		true
	)
	local key_count<const> = #track.keys
	if key_count == 1 then
		statements[#statements + 1] = local_statement(
			reference(single_symbols.value),
			member_expression(
				index_expression(reference(single_symbols.keys), numeric_literal(1)),
				'value'
			),
			true
		)
	elseif key_count == 2 then
		statements[#statements + 1] = local_statement(
			reference(single_symbols.first_key),
			index_expression(reference(single_symbols.keys), numeric_literal(1)),
			true
		)
		statements[#statements + 1] = local_statement(
			reference(single_symbols.last_key),
			index_expression(reference(single_symbols.keys), numeric_literal(2)),
			true
		)
	end
end

function scalar_channel_syntax.build(channels, analysis, sample_flag)
	local statements<const> = {}
	local callback_functions<const> = analysis.callback_functions
	local callback_symbols<const> = {}
	if callback_functions ~= nil then
		statements[#statements + 1] = local_statement(
			reference(symbols.scalar_callbacks),
			identifier('scalar_callbacks'),
			true
		)
		for index = 1, #callback_functions do
			local callback_symbol<const> = generated_symbol('scalar_callback')
			callback_symbols[index] = callback_symbol
			statements[#statements + 1] = local_statement(
				reference(callback_symbol),
				index_expression(reference(symbols.scalar_callbacks), numeric_literal(index)),
				true
			)
		end
	end
	local evaluator_body<const> = {}
	emit_locals(
		evaluator_body,
		analysis,
		#channels.cubic_tracks > 0 or #channels.cubic_time_tracks > 0
	)
	emit_frame_lane(evaluator_body, channels, analysis, sample_flag, callback_symbols)
	emit_time_lane(evaluator_body, channels, analysis, callback_symbols)
	local factory_body<const> = {}
	for index = 1, #track_families do
		local family<const> = track_families[index]
		local tracks<const> = channels[family.track_list_member]
		local track_count<const> = #tracks
		if track_count == 1 then
			emit_single_track_captures(
				factory_body,
				family,
				tracks[1]
			)
		elseif track_count > 1 then
			factory_body[#factory_body + 1] = local_statement(
				reference(family.track_list_symbol),
				member_expression(
					reference(symbols.source_channels),
					family.track_list_member
				),
				true
			)
		end
	end
	factory_body[#factory_body + 1] = return_statement({
		function_expression(
			evaluator_parameters(channels, analysis),
			block(evaluator_body)
		),
	})
	statements[#statements + 1] = return_statement({
		function_expression(
			{ reference(symbols.source_channels) },
			block(factory_body)
		),
	})
	return syntax_factory.chunk(block(statements))
end

return scalar_channel_syntax
