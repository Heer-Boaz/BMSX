local clamp<const> = require('cartlib/util/clamp')
local clock<const> = require('cartlib/clock')
local timelineapply<const> = require('cartlib/timeline/apply')

-- Definitions are admitted once into immutable evaluation data. Timeline
-- instances retain only transport state and replace this program atomically on
-- a live definition rebind.
local timelineprogram<const> = {}
local empty_defs<const> = {}
local empty_markers<const> = { by_frame = {}, markers = {}, count = 0 }
local empty_windows<const> = {
	intervals = {},
	interval_count = 0,
	boundaries = {},
	boundary_count = 0,
	boundaries_by_frame = {},
	tags = {},
	tag_count = 0,
}

local compare_marker<const> = function(left, right)
	if left.frame == right.frame then
		return left.order < right.order
	end
	return left.frame < right.frame
end

local compare_boundary<const> = function(left, right)
	if left.frame == right.frame then
		if left.delta == right.delta then
			return left.order < right.order
		end
		return left.delta > right.delta
	end
	return left.frame < right.frame
end

local frame_at<const> = function(position, length)
	if position.frame ~= nil then
		return clamp(position.frame, 0, length - 1)
	end
	local normalized<const> = clamp(position.u or 0, 0, 1)
	return clamp((normalized * (length - 1)) // 1, 0, length - 1)
end

local compile_markers<const> = function(marker_defs, length)
	local by_frame<const> = {}
	local markers<const> = {}
	if length > 0 then
		for index = 1, #marker_defs do
			local marker_def<const> = marker_defs[index]
			local frame<const> = frame_at(marker_def, length)
			local marker<const> = {
				frame = frame,
				event = marker_def.event,
				payload = marker_def.payload,
				forward = marker_def.direction ~= 'backward',
				backward = marker_def.direction ~= 'forward',
				order = index,
			}
			markers[index] = marker
			local bucket = by_frame[frame]
			if bucket == nil then
				bucket = {}
				by_frame[frame] = bucket
			end
			bucket[#bucket + 1] = marker
		end
		table.sort(markers, compare_marker)
		for index = 1, #markers do
			markers[index].order = nil
		end
	end
	return {
		by_frame = by_frame,
		markers = markers,
		count = #markers,
	}
end

local compile_windows<const> = function(window_defs, length)
	local intervals<const> = {}
	local boundaries<const> = {}
	local boundaries_by_frame<const> = {}
	local tags<const> = {}
	local tag_index_by_name<const> = {}
	if length > 0 then
		for index = 1, #window_defs do
			local window_def<const> = window_defs[index]
			local tag<const> = window_def.tag
			local tag_index = tag_index_by_name[tag]
			if tag_index == nil then
				tag_index = #tags + 1
				tags[tag_index] = tag
				tag_index_by_name[tag] = tag_index
			end
			local interval<const> = {
				start_event = 'window.' .. window_def.name .. '.start',
				end_event = 'window.' .. window_def.name .. '.end',
				tag_index = tag_index,
				start_frame = frame_at(window_def.start, length),
				end_frame = frame_at(window_def['end'], length),
				start_payload = window_def.payloadstart,
				end_payload = window_def.payloadend,
			}
			intervals[index] = interval
			local start_boundary<const> = {
				frame = interval.start_frame,
				delta = 1,
				interval = interval,
				order = index,
			}
			local end_boundary<const> = {
				frame = interval.end_frame,
				delta = -1,
				interval = interval,
				order = index,
			}
			boundaries[#boundaries + 1] = start_boundary
			boundaries[#boundaries + 1] = end_boundary
			local start_bucket = boundaries_by_frame[start_boundary.frame]
			if start_bucket == nil then
				start_bucket = {}
				boundaries_by_frame[start_boundary.frame] = start_bucket
			end
			start_bucket[#start_bucket + 1] = start_boundary
			local end_bucket = boundaries_by_frame[end_boundary.frame]
			if end_bucket == nil then
				end_bucket = {}
				boundaries_by_frame[end_boundary.frame] = end_bucket
			end
			end_bucket[#end_bucket + 1] = end_boundary
		end
		table.sort(boundaries, compare_boundary)
		for _, bucket in pairs(boundaries_by_frame) do
			table.sort(bucket, compare_boundary)
		end
		for index = 1, #boundaries do
			boundaries[index].order = nil
		end
	end
	return {
		intervals = intervals,
		interval_count = #intervals,
		boundaries = boundaries,
		boundary_count = #boundaries,
		boundaries_by_frame = boundaries_by_frame,
		tags = tags,
		tag_count = #tags,
	}
end

local expand_frames<const> = function(frames, repetitions)
	if frames.__timelinerange then
		if repetitions <= 1 then
			return frames
		end
		return {
			__timelinerange = true,
			length = frames.length * repetitions,
			source_length = frames.source_length,
		}
	end
	if repetitions <= 1 then
		return frames
	end
	local expanded<const> = {}
	for _ = 1, repetitions do
		for index = 1, #frames do
			expanded[#expanded + 1] = frames[index]
		end
	end
	return expanded
end

local compile_frame_data<const> = function(program, frame_source)
	local compiled<const> = {}
	for key, value in pairs(program) do
		compiled[key] = value
	end
	compiled.frames = expand_frames(frame_source, program.repetitions)
	if compiled.frames.__timelinerange then
		compiled.length = compiled.frames.length
		compiled.range_source_length = compiled.frames.source_length
	else
		compiled.length = #compiled.frames
		compiled.range_source_length = nil
	end
	compiled.markers = compile_markers(program.marker_defs, compiled.length)
	compiled.windows = compile_windows(program.window_defs, compiled.length)
	if program.apply_frames then
		compiled.frame_appliers = timelineapply.compile_frames(compiled.frames)
	else
		compiled.frame_appliers = nil
	end
	return compiled
end

function timelineprogram.compile(definition)
	local frame_source<const> = definition.frames
	local tracks<const> = definition.tracks
	local continuous = definition.continuous
	if continuous == nil and frame_source == nil and tracks ~= nil then
		continuous = true
	end
	local ticks_per_frame = definition.ticks_per_frame
	if ticks_per_frame == nil then
		ticks_per_frame = clock.frame_milliseconds()
	end
	local auto_tick = definition.autotick
	if auto_tick == nil then
		auto_tick = continuous or ticks_per_frame ~= 0
	end
	local frame_builder
	if type(frame_source) == 'function' then
		frame_builder = frame_source
	end
	local track_runner
	if tracks ~= nil then
		track_runner = timelineapply.compile_tracks(tracks)
	end
	local apply_function
	if type(definition.apply) == 'function' then
		apply_function = definition.apply
	end
	local apply_frames<const> = definition.apply ~= nil and apply_function == nil
	local program<const> = {
		id = definition.id,
		repetitions = definition.repetitions or 1,
		frame_builder = frame_builder,
		marker_defs = definition.markers or empty_defs,
		window_defs = definition.windows or empty_defs,
		ticks_per_frame = ticks_per_frame,
		playback_mode = definition.playback_mode or 'once',
		continuous = continuous,
		auto_tick = auto_tick,
		duration_ms = definition.duration_ms or (definition.duration_seconds and (definition.duration_seconds * 1000)),
		track_runner = track_runner,
		apply_frames = apply_frames,
		apply_function = apply_function,
		default_target = definition.target,
		default_params = definition.params,
		frames = {},
		length = 0,
		markers = empty_markers,
		windows = empty_windows,
	}
	if frame_builder ~= nil then
		return program
	end
	if frame_source == nil and tracks ~= nil then
		return compile_frame_data(program, { {} })
	end
	return compile_frame_data(program, frame_source)
end

function timelineprogram.build(program, params)
	return compile_frame_data(program, program.frame_builder(params))
end

function timelineprogram.frame_value(program, index)
	if index < 0 or index >= program.length then
		return nil
	end
	if program.range_source_length ~= nil then
		return index % program.range_source_length
	end
	return program.frames[index + 1]
end

return timelineprogram
