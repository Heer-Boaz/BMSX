local clock<const> = require('cartlib/clock')
local timeline_apply<const> = require('cartlib/timeline/apply')
local timeline_track_program<const> = require('cartlib/timeline/track_program')

-- A definition is admitted into immutable evaluation data. Timeline instances
-- retain only transport state and atomically replace this program on rebind.
local timeline_program<const> = {}
local empty_defs<const> = {}
local primary_binding_ids<const> = { 'target' }
local primary_binding_index_by_id<const> = { target = 1 }

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
	compiled.tracks = timeline_track_program.compile(program.prepared_tracks, compiled.length)
	if program.apply_frames then
		compiled.frame_appliers = timeline_apply.compile_frames(compiled.frames)
	else
		compiled.frame_appliers = nil
	end
	return compiled
end

local compile_bindings<const> = function(binding_defs)
	if #binding_defs == 0 then
		return primary_binding_ids, primary_binding_index_by_id
	end
	local ids<const> = { 'target' }
	local index_by_id<const> = { target = 1 }
	for index = 1, #binding_defs do
		local id<const> = binding_defs[index]
		local binding_index<const> = #ids + 1
		ids[binding_index] = id
		index_by_id[id] = binding_index
	end
	return ids, index_by_id
end

function timeline_program.compile(id, definition)
	local frame_source<const> = definition.frames
	local track_defs<const> = definition.tracks or empty_defs
	local continuous = definition.continuous
	if continuous == nil and frame_source == nil and #track_defs > 0 then
		continuous = true
	end
	local frame_duration = definition.frame_duration
	if frame_duration == nil then
		frame_duration = clock.frame_milliseconds()
	end
	local auto_tick = definition.auto_tick
	if auto_tick == nil then
		auto_tick = continuous or frame_duration ~= 0
	end
	local frame_builder
	if type(frame_source) == 'function' then
		frame_builder = frame_source
	end
	local binding_ids<const>, binding_index_by_id<const> = compile_bindings(definition.bindings or empty_defs)
	local prepared_tracks<const> = timeline_track_program.prepare(track_defs, binding_index_by_id)
	local apply_function
	if type(definition.apply) == 'function' then
		apply_function = definition.apply
	end
	local apply_frames<const> = definition.apply ~= nil and apply_function == nil
	local program<const> = {
		id = id,
		repetitions = definition.repetitions or 1,
		frame_builder = frame_builder,
		frame_duration = frame_duration,
		playback_mode = definition.playback_mode or 'once',
		continuous = continuous,
		auto_tick = auto_tick,
		duration_ms = definition.duration_ms,
		binding_ids = binding_ids,
		binding_index_by_id = binding_index_by_id,
		binding_count = #binding_ids,
		prepared_tracks = prepared_tracks,
		tracks = timeline_track_program.compile(prepared_tracks, 0),
		apply_frames = apply_frames,
		apply_function = apply_function,
		default_binding = definition.target,
		default_params = definition.params,
		frames = {},
		length = 0,
	}
	if frame_builder ~= nil then
		return program
	end
	if frame_source == nil and #track_defs > 0 then
		return compile_frame_data(program, { {} })
	end
	return compile_frame_data(program, frame_source)
end

function timeline_program.build(program, params)
	return compile_frame_data(program, program.frame_builder(params))
end

function timeline_program.frame_value(program, index)
	if index < 0 or index >= program.length then
		return nil
	end
	if program.range_source_length ~= nil then
		return index % program.range_source_length
	end
	return program.frames[index + 1]
end

return timeline_program
