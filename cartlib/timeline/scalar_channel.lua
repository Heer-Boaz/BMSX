-- Numeric curve channels own their compiled segment representation. Their
-- shape-specific runner factory is prepared once; length-dependent channels
-- are bound once when a definitive frame program is compiled. Direct property
-- lanes retain their key arrays directly; equal callback identities share one
-- captured function. Binding selection and property paths are encoded in the
-- runner. Channels with more than two keys retain one current segment per
-- active timeline entry; each shared key carries an exclusive segment end, so
-- evaluation only searches again when traversal leaves that range. Generic
-- step values remain track-program data because they may carry non-numeric cart
-- values.
local scalar_channel_syntax<const> = require('cartlib/timeline/scalar_channel_syntax')
local timeline_playback<const> = require('cartlib/timeline/playback')

local scalar_channel<const> = {}
local compile_syntax<const> = lua_compiler.compile_syntax
local sample_flag<const> = timeline_playback.evaluation_flag.sample

scalar_channel.empty_program = {
	track_count = 0,
	has_callbacks = false,
	cached_segment_count = 0,
	linear_tracks = {},
	linear_time_tracks = {},
	cubic_tracks = {},
	cubic_time_tracks = {},
	runner_factory = nil,
}

scalar_channel.empty = {
	track_count = 0,
	cached_segment_count = 0,
	initial_cached_segments = {},
	linear_tracks = {},
	linear_time_tracks = {},
	cubic_tracks = {},
	cubic_time_tracks = {},
}

local analyze_tracks<const> = function(analysis, tracks, time_domain)
	for index = 1, #tracks do
		local track<const> = tracks[index]
		if track.apply ~= nil then
			local callback_functions = analysis.callback_functions
			local callback_index_by_function = analysis.callback_index_by_function
			if callback_functions == nil then
				callback_functions = {}
				callback_index_by_function = {}
				analysis.callback_functions = callback_functions
				analysis.callback_index_by_function = callback_index_by_function
			end
			local callback_index = callback_index_by_function[track.apply]
			if callback_index == nil then
				callback_index = #callback_functions + 1
				callback_functions[callback_index] = track.apply
				callback_index_by_function[track.apply] = callback_index
			end
			track.callback_index = callback_index
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

local compile_runner_factory<const> = function(channels)
	local linear_tracks<const> = channels.linear_tracks
	local linear_time_tracks<const> = channels.linear_time_tracks
	local cubic_tracks<const> = channels.cubic_tracks
	local cubic_time_tracks<const> = channels.cubic_time_tracks
	local analysis<const> = {
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

	local environment = nil
	if analysis.callback_functions ~= nil then
		environment = { scalar_callbacks = analysis.callback_functions }
	end
	return compile_syntax(
		scalar_channel_syntax.build(channels, analysis, sample_flag),
		'[timeline.scalar_channel]',
		environment
	)(), analysis.cached_segment_count, analysis.callback_functions ~= nil
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
	program.runner_factory, program.cached_segment_count, program.has_callbacks
		= compile_runner_factory(program)
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
		tracks[track_index] = keys
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
	return {
		track_count = program.track_count,
		cached_segment_count = program.cached_segment_count,
		initial_cached_segments = initial_cached_segments,
		linear_tracks = linear_tracks,
		linear_time_tracks = linear_time_tracks,
		cubic_tracks = cubic_tracks,
		cubic_time_tracks = cubic_time_tracks,
	}
end

return scalar_channel
