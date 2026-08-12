-- Numeric curve channels own their compiled segment representation and hot
-- evaluator. Channels with more than two keys retain one current segment per
-- active timeline entry; each shared key carries an exclusive segment end,
-- so evaluation only searches again when traversal leaves that range. Generic
-- step values remain track-program data because they may carry non-numeric
-- cart values.
local lua_source_printer<const> = require('cartlib/codegen/lua_source_printer')

local scalar_channel<const> = {}
local templates<const> = {}

scalar_channel.empty_program = {
	track_count = 0,
	cached_segment_count = 0,
	linear_tracks = {},
	linear_time_tracks = {},
	cubic_tracks = {},
	cubic_time_tracks = {},
	runner = nil,
}

scalar_channel.empty = {
	track_count = 0,
	cached_segment_count = 0,
	initial_cached_segments = {},
	linear_tracks = {},
	linear_time_tracks = {},
	cubic_tracks = {},
	cubic_time_tracks = {},
	runner = nil,
}

local emit_track_list_index<const> = function(printer, values)
	printer:print_index(values.track_list_name)
end

local emit_track_index<const> = function(printer, values)
	printer:print_index(values.track_index)
end

local emit_position_index<const> = function(printer, values)
	printer:print_index(values.position_key)
end

local emit_target_path<const> = function(printer, values)
	printer:print_path(values.track.path)
end

local emit_segment<const> = function(printer, values)
	if values.key_count == 2 then
		printer:emit(templates.first_segment, values)
	else
		printer:emit(templates.cached_segment, values)
	end
end

local emit_interpolation<const> = function(printer, values)
	if values.cubic then
		printer:emit(templates.cubic_interpolation, values)
	else
		printer:emit(templates.linear_interpolation, values)
	end
end

local emit_track_load<const> = function(printer, values)
	if values.track.apply ~= nil then
		printer:emit(templates.callback_track_load, values)
	else
		printer:emit(templates.assignment_track_load, values)
	end
end

local emit_track_sample<const> = function(printer, values)
	if values.key_count == 1 then
		printer:emit(templates.single_key_sample, values)
	else
		printer:emit(templates.multi_key_sample, values)
	end
end

local emit_track_output<const> = function(printer, values)
	local track<const> = values.track
	if track.apply ~= nil then
		if track.binding_index == 1 then
			printer:emit(templates.primary_callback_output, values)
		else
			printer:emit(templates.indexed_callback_output, values)
		end
	elseif track.binding_index == 1 then
		printer:emit(templates.primary_assignment_output, values)
	else
		printer:emit(templates.indexed_assignment_output, values)
	end
end

local emit_scalar_track<const> = function(printer, values)
	local track<const> = values.track
	local key_count<const> = #track.keys
	values.key_count = key_count
	values.key_count_plus_one = key_count + 1
	values.cached_segment_index = track.cached_segment_index
	values.binding_index = track.binding_index
	printer:emit(templates.scalar_track, values)
end

local emit_scalar_lane<const> = function(printer, values, track_list_name, tracks, position_key, cubic)
	values.track_list_name = track_list_name
	values.position_key = position_key
	values.cubic = cubic
	for track_index = 1, #tracks do
		values.track_index = track_index
		values.track = tracks[track_index]
		emit_scalar_track(printer, values)
	end
end

local emit_locals<const> = function(printer, values)
	local analysis<const> = values.analysis
	printer:emit(templates.base_locals, values)
	if analysis.has_callback then
		printer:emit(templates.callback_locals, values)
	end
	if analysis.has_primary_binding then
		printer:emit(templates.primary_binding_local, values)
	end
	if analysis.has_secondary_binding then
		printer:emit(templates.secondary_binding_local, values)
	end
	if analysis.cached_segment_count > 0 then
		printer:emit(templates.cached_segment_local, values)
	end
	if analysis.max_key_count > 1 then
		printer:emit(templates.position_locals, values)
	end
	if analysis.max_key_count > 2 then
		printer:emit(templates.search_locals, values)
	end
	if values.has_cubic_tracks then
		printer:emit(templates.cubic_local, values)
	end
end

local emit_frame_position<const> = function(printer, values)
	if values.analysis.frame_max_key_count > 1 then
		printer:emit(templates.frame_position, values)
	end
end

local emit_frame_tracks<const> = function(printer, values)
	local channels<const> = values.channels
	emit_scalar_lane(printer, values, 'linear_tracks', channels.linear_tracks, 'frame', false)
	emit_scalar_lane(printer, values, 'cubic_tracks', channels.cubic_tracks, 'frame', true)
end

local emit_frame_lane<const> = function(printer, values)
	if values.has_frame_tracks then
		printer:emit(templates.frame_lane, values)
	end
end

local emit_time_position<const> = function(printer, values)
	if values.analysis.time_max_key_count > 1 then
		printer:emit(templates.time_position, values)
	end
end

local emit_time_tracks<const> = function(printer, values)
	local channels<const> = values.channels
	emit_scalar_lane(printer, values, 'linear_time_tracks', channels.linear_time_tracks, 'time_ms', false)
	emit_scalar_lane(printer, values, 'cubic_time_tracks', channels.cubic_time_tracks, 'time_ms', true)
end

local emit_time_lane<const> = function(printer, values)
	if values.has_time_tracks then
		printer:emit(templates.time_lane, values)
	end
end

templates.base_locals = lua_source_printer.compile_template([[
	local keys
	local value
]], {})

templates.callback_locals = lua_source_printer.compile_template([[
	local track
	local params = entry["params"]
]], {})

templates.primary_binding_local = lua_source_printer.compile_template(
	'local primary_binding = entry["primary_binding"]\n',
	{}
)

templates.secondary_binding_local = lua_source_printer.compile_template(
	'local bindings = entry["bindings"]\n',
	{}
)

templates.cached_segment_local = lua_source_printer.compile_template(
	'local cached_segments = entry["cached_scalar_segments"]\n',
	{}
)

templates.position_locals = lua_source_printer.compile_template([[
	local position
	local first_key
	local last_key
	local key
]], {})

templates.search_locals = lua_source_printer.compile_template([[
	local low
	local high
	local middle
]], {})

templates.cubic_local = lua_source_printer.compile_template('local u\n', {})

templates.callback_track_load = lua_source_printer.compile_template([[
	track = channels$track_list_index$$track_index$
	keys = track["keys"]
]], {
	track_list_index = emit_track_list_index,
	track_index = emit_track_index,
})

templates.assignment_track_load = lua_source_printer.compile_template(
	'keys = channels$track_list_index$$track_index$["keys"]\n',
	{
		track_list_index = emit_track_list_index,
		track_index = emit_track_index,
	}
)

templates.single_key_sample = lua_source_printer.compile_template(
	'value = keys[1]["value"]\n',
	{}
)

templates.first_segment = lua_source_printer.compile_template('key = first_key\n', {})

templates.cached_segment = lua_source_printer.compile_template([[
	key = cached_segments[$cached_segment_index$]
	if position < key$position_index$ or position >= key["segment_end"] then
		low = 1
		high = $key_count_plus_one$
		while low < high do
			middle = (low + high) // 2
			if keys[middle]$position_index$ <= position then
				low = middle + 1
			else
				high = middle
			end
		end
		key = keys[low - 1]
		cached_segments[$cached_segment_index$] = key
	end
]], { position_index = emit_position_index })

templates.linear_interpolation = lua_source_printer.compile_template(
	'value = key["value"] + key["value_delta"] * ((position - key$position_index$) * key["span_inv"])\n',
	{ position_index = emit_position_index }
)

templates.cubic_interpolation = lua_source_printer.compile_template([[
	u = (position - key$position_index$) * key["span_inv"]
	value = ((key["cubic3"] * u + key["cubic2"]) * u + key["cubic1"]) * u + key["value"]
]], { position_index = emit_position_index })

templates.multi_key_sample = lua_source_printer.compile_template([[
	first_key = keys[1]
	if position <= first_key$position_index$ then
		value = first_key["value"]
	else
		last_key = keys[$key_count$]
		if position >= last_key$position_index$ then
			value = last_key["value"]
		else
			$segment$
			$interpolation$
		end
	end
]], {
	position_index = emit_position_index,
	segment = emit_segment,
	interpolation = emit_interpolation,
})

templates.primary_callback_output = lua_source_printer.compile_template(
	'track["apply"](primary_binding, value, params, evaluation)\n',
	{}
)

templates.indexed_callback_output = lua_source_printer.compile_template(
	'track["apply"](bindings[$binding_index$], value, params, evaluation)\n',
	{}
)

templates.primary_assignment_output = lua_source_printer.compile_template(
	'primary_binding$target_path$ = value\n',
	{ target_path = emit_target_path }
)

templates.indexed_assignment_output = lua_source_printer.compile_template(
	'bindings[$binding_index$]$target_path$ = value\n',
	{ target_path = emit_target_path }
)

templates.scalar_track = lua_source_printer.compile_template([[
	$load$
	$sample$
	$output$
]], {
	load = emit_track_load,
	sample = emit_track_sample,
	output = emit_track_output,
})

templates.frame_position = lua_source_printer.compile_template(
	'position = evaluation["frame"]\n',
	{}
)

templates.time_position = lua_source_printer.compile_template(
	'position = evaluation["time_ms"]\n',
	{}
)

templates.frame_lane = lua_source_printer.compile_template([[
	if evaluation["sample"] then
		$position$
		$tracks$
	end
]], {
	position = emit_frame_position,
	tracks = emit_frame_tracks,
})

templates.time_lane = lua_source_printer.compile_template([[
	$position$
	$tracks$
]], {
	position = emit_time_position,
	tracks = emit_time_tracks,
})

templates.runner = lua_source_printer.compile_template([[
	return function(channels, entry, evaluation)
		$locals$
		$frame_lane$
		$time_lane$
	end
]], {
	locals = emit_locals,
	frame_lane = emit_frame_lane,
	time_lane = emit_time_lane,
})

local analyze_tracks<const> = function(analysis, tracks, time_domain)
	for index = 1, #tracks do
		local track<const> = tracks[index]
		if track.apply ~= nil then
			analysis.has_callback = true
		end
		if track.binding_index == 1 then
			analysis.has_primary_binding = true
		else
			analysis.has_secondary_binding = true
		end
		local key_count<const> = #track.keys
		if time_domain then
			if key_count > analysis.time_max_key_count then
				analysis.time_max_key_count = key_count
			end
		elseif key_count > analysis.frame_max_key_count then
			analysis.frame_max_key_count = key_count
		end
		if key_count > analysis.max_key_count then
			analysis.max_key_count = key_count
		end
		if key_count > 2 then
			local cached_segment_index<const> = analysis.cached_segment_count + 1
			analysis.cached_segment_count = cached_segment_index
			track.cached_segment_index = cached_segment_index
		end
	end
end

local compile_runner<const> = function(channels)
	local linear_tracks<const> = channels.linear_tracks
	local linear_time_tracks<const> = channels.linear_time_tracks
	local cubic_tracks<const> = channels.cubic_tracks
	local cubic_time_tracks<const> = channels.cubic_time_tracks
	local analysis<const> = {
		has_callback = false,
		has_primary_binding = false,
		has_secondary_binding = false,
		frame_max_key_count = 0,
		time_max_key_count = 0,
		max_key_count = 0,
		cached_segment_count = 0,
	}
	analyze_tracks(analysis, linear_tracks, false)
	analyze_tracks(analysis, cubic_tracks, false)
	analyze_tracks(analysis, linear_time_tracks, true)
	analyze_tracks(analysis, cubic_time_tracks, true)

	local printer<const> = lua_source_printer.new()
	printer:emit(templates.runner, {
		analysis = analysis,
		channels = channels,
		has_cubic_tracks = #cubic_tracks > 0 or #cubic_time_tracks > 0,
		has_frame_tracks = #linear_tracks > 0 or #cubic_tracks > 0,
		has_time_tracks = #linear_time_tracks > 0 or #cubic_time_tracks > 0,
	})
	return load(printer:finish(), '[timeline.scalar_channel]', 't')(), analysis.cached_segment_count
end

local finalize_tracks<const> = function(tracks)
	for index = 1, #tracks do
		local track<const> = tracks[index]
		track.binding_index = nil
		track.path = nil
	end
end

local compare_frame_key<const> = function(left, right)
	if left.frame == right.frame then
		return left.order < right.order
	end
	return left.frame < right.frame
end

local compare_time_key<const> = function(left, right)
	if left.time_ms == right.time_ms then
		return left.order < right.order
	end
	return left.time_ms < right.time_ms
end

local frame_at<const> = function(position, length)
	if position.frame ~= nil then
		return position.frame
	end
	return (position.u * (length - 1)) // 1
end

function scalar_channel.prepare(definitions)
	if #definitions == 0 then
		return scalar_channel.empty_program
	end
	local linear_tracks<const> = {}
	local linear_time_tracks<const> = {}
	local cubic_tracks<const> = {}
	local cubic_time_tracks<const> = {}
	for track_index = 1, #definitions do
		local definition<const> = definitions[track_index]
		local interpolation<const> = definition.interpolation
		local time_domain<const> = definition.keys[1].time_ms ~= nil
		if interpolation == 'linear' then
			if time_domain then
				linear_time_tracks[#linear_time_tracks + 1] = definition
			else
				linear_tracks[#linear_tracks + 1] = definition
			end
		elseif time_domain then
			cubic_time_tracks[#cubic_time_tracks + 1] = definition
		else
			cubic_tracks[#cubic_tracks + 1] = definition
		end
	end
	local program<const> = {
		track_count = #definitions,
		linear_tracks = linear_tracks,
		linear_time_tracks = linear_time_tracks,
		cubic_tracks = cubic_tracks,
		cubic_time_tracks = cubic_time_tracks,
	}
	program.runner, program.cached_segment_count = compile_runner(program)
	return program
end

local compile_tracks<const> = function(definitions, length, time_domain, cubic, initial_cached_segments)
	local tracks<const> = {}
	for track_index = 1, #definitions do
		local definition<const> = definitions[track_index]
		local keys<const> = {}
		for key_index = 1, #definition.keys do
			local source<const> = definition.keys[key_index]
			local key<const> = {
				value = source.value,
				order = key_index,
			}
			if time_domain then
				key.time_ms = source.time_ms
			else
				key.frame = frame_at(source, length)
			end
			if cubic then
				key.arrive_tangent = source.arrive_tangent
				key.leave_tangent = source.leave_tangent
			end
			keys[key_index] = key
		end
		if time_domain then
			table.sort(keys, compare_time_key)
		else
			table.sort(keys, compare_frame_key)
		end
		for key_index = 1, #keys do
			keys[key_index].order = nil
		end
		local cached_segment_index<const> = definition.cached_segment_index
		for key_index = 1, #keys - 1 do
			local key<const> = keys[key_index]
			local next_key<const> = keys[key_index + 1]
			local span
			if time_domain then
				span = next_key.time_ms - key.time_ms
			else
				span = next_key.frame - key.frame
			end
			if cached_segment_index ~= nil then
				key.segment_end = time_domain and next_key.time_ms or next_key.frame
			end
			key.span_inv = 1 / span
			if cubic then
				local leave<const> = key.leave_tangent * span
				local arrive<const> = next_key.arrive_tangent * span
				key.cubic3 = 2 * key.value - 2 * next_key.value + leave + arrive
				key.cubic2 = -3 * key.value + 3 * next_key.value - 2 * leave - arrive
				key.cubic1 = leave
			else
				key.value_delta = next_key.value - key.value
			end
		end
		if cubic then
			for key_index = 1, #keys do
				local key<const> = keys[key_index]
				key.arrive_tangent = nil
				key.leave_tangent = nil
			end
		end
		if cached_segment_index ~= nil then
			initial_cached_segments[cached_segment_index] = keys[1]
		end
		tracks[track_index] = {
			binding_index = definition.binding_index,
			apply = definition.apply,
			path = definition.path,
			keys = keys,
		}
	end
	return tracks
end

function scalar_channel.compile(program, length)
	if program == scalar_channel.empty_program then
		return scalar_channel.empty
	end
	local initial_cached_segments<const> = {}
	local linear_tracks<const> = compile_tracks(program.linear_tracks, length, false, false, initial_cached_segments)
	local linear_time_tracks<const> = compile_tracks(program.linear_time_tracks, length, true, false, initial_cached_segments)
	local cubic_tracks<const> = compile_tracks(program.cubic_tracks, length, false, true, initial_cached_segments)
	local cubic_time_tracks<const> = compile_tracks(program.cubic_time_tracks, length, true, true, initial_cached_segments)
	local channels<const> = {
		track_count = program.track_count,
		cached_segment_count = program.cached_segment_count,
		initial_cached_segments = initial_cached_segments,
		linear_tracks = linear_tracks,
		linear_time_tracks = linear_time_tracks,
		cubic_tracks = cubic_tracks,
		cubic_time_tracks = cubic_time_tracks,
		runner = program.runner,
	}
	finalize_tracks(linear_tracks)
	finalize_tracks(linear_time_tracks)
	finalize_tracks(cubic_tracks)
	finalize_tracks(cubic_time_tracks)
	return channels
end

return scalar_channel
