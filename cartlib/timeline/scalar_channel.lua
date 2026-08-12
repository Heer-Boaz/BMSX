-- Numeric curve channels own their compiled segment representation and hot
-- evaluator. Channels with more than two keys retain one current segment per
-- active timeline entry; each shared key carries an exclusive segment end,
-- so evaluation only searches again when traversal leaves that range. Generic
-- step values remain track-program data because they may carry non-numeric
-- cart values.
local lua_source_writer<const> = require('cartlib/codegen/lua_source_writer')

local scalar_channel<const> = {}

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

local append_scalar_track<const> = function(
	writer,
	track_list_name,
	track_index,
	track,
	position_key,
	cubic
)
	if track.apply ~= nil then
		writer:start_line('track = channels')
		writer:write_index(track_list_name)
		writer:write_index(track_index)
		writer:end_line('')
		writer:line('keys = track["keys"]')
	else
		writer:start_line('keys = channels')
		writer:write_index(track_list_name)
		writer:write_index(track_index)
		writer:end_line('["keys"]')
	end
	local key_count<const> = #track.keys
	if key_count == 1 then
		writer:line('value = keys[1]["value"]')
	else
		writer:line('first_key = keys[1]')
		writer:start_line('if position <= first_key')
		writer:write_index(position_key)
		writer:finish_block_header(' then')
		writer:line('value = first_key["value"]')
		writer:next_block('else')
		writer:start_line('last_key = keys[')
		writer:write(key_count)
		writer:end_line(']')
		writer:start_line('if position >= last_key')
		writer:write_index(position_key)
		writer:finish_block_header(' then')
		writer:line('value = last_key["value"]')
		writer:next_block('else')
		if key_count == 2 then
			writer:line('key = first_key')
		else
			local cached_segment_index<const> = track.cached_segment_index
			writer:start_line('key = cached_segments[')
			writer:write(cached_segment_index)
			writer:end_line(']')
			writer:start_line('if position < key')
			writer:write_index(position_key)
			writer:finish_block_header(' or position >= key["segment_end"] then')
			writer:line('low = 1')
			writer:start_line('high = ')
			writer:end_line(key_count + 1)
			writer:begin_block('while low < high do')
			writer:line('middle = (low + high) // 2')
			writer:start_line('if keys[middle]')
			writer:write_index(position_key)
			writer:finish_block_header(' <= position then')
			writer:line('low = middle + 1')
			writer:next_block('else')
			writer:line('high = middle')
			writer:end_block()
			writer:end_block()
			writer:line('key = keys[low - 1]')
			writer:start_line('cached_segments[')
			writer:write(cached_segment_index)
			writer:end_line('] = key')
			writer:end_block()
		end
		if cubic then
			writer:start_line('u = (position - key')
			writer:write_index(position_key)
			writer:end_line(') * key["span_inv"]')
			writer:line('value = ((key["cubic3"] * u + key["cubic2"]) * u + key["cubic1"]) * u + key["value"]')
		else
			writer:start_line('value = key["value"] + key["value_delta"] * ((position - key')
			writer:write_index(position_key)
			writer:end_line(') * key["span_inv"])')
		end
		writer:end_block()
		writer:end_block()
	end
	if track.apply ~= nil then
		writer:start_line('track["apply"](')
	else
		writer:start_line('')
	end
	if track.binding_index == 1 then
		writer:write('primary_binding')
	else
		writer:write('bindings')
		writer:write_index(track.binding_index)
	end
	if track.apply ~= nil then
		writer:end_line(', value, params, evaluation)')
	else
		writer:write_path(track.path)
		writer:end_line(' = value')
	end
end

local append_scalar_lane<const> = function(
	writer,
	track_list_name,
	tracks,
	position_key,
	cubic
)
	for track_index = 1, #tracks do
		append_scalar_track(
			writer,
			track_list_name,
			track_index,
			tracks[track_index],
			position_key,
			cubic
		)
	end
end

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

	local writer<const> = lua_source_writer.new()
	writer:begin_block('return function(channels, entry, evaluation)')
	writer:line('local track')
	writer:line('local keys')
	writer:line('local value')
	if analysis.has_primary_binding then
		writer:line('local primary_binding = entry["primary_binding"]')
	end
	if analysis.has_secondary_binding then
		writer:line('local bindings = entry["bindings"]')
	end
	if analysis.has_callback then
		writer:line('local params = entry["params"]')
	end
	if analysis.cached_segment_count > 0 then
		writer:line('local cached_segments = entry["cached_scalar_segments"]')
	end
	if analysis.max_key_count > 1 then
		writer:line('local position')
		writer:line('local first_key')
		writer:line('local last_key')
		writer:line('local key')
	end
	if analysis.max_key_count > 2 then
		writer:line('local low')
		writer:line('local high')
		writer:line('local middle')
	end
	if #cubic_tracks > 0 or #cubic_time_tracks > 0 then
		writer:line('local u')
	end
	if #linear_tracks > 0 or #cubic_tracks > 0 then
		writer:begin_block('if evaluation["sample"] then')
		if analysis.frame_max_key_count > 1 then
			writer:line('position = evaluation["frame"]')
		end
		append_scalar_lane(writer, 'linear_tracks', linear_tracks, 'frame', false)
		append_scalar_lane(writer, 'cubic_tracks', cubic_tracks, 'frame', true)
		writer:end_block()
	end
	if #linear_time_tracks > 0 or #cubic_time_tracks > 0 then
		if analysis.time_max_key_count > 1 then
			writer:line('position = evaluation["time_ms"]')
		end
		append_scalar_lane(writer, 'linear_time_tracks', linear_time_tracks, 'time_ms', false)
		append_scalar_lane(writer, 'cubic_time_tracks', cubic_time_tracks, 'time_ms', true)
	end
	writer:end_block()
	return load(writer:finish(), '[timeline.scalar_channel]', 't')(), analysis.cached_segment_count
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
