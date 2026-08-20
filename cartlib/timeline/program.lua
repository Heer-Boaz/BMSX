local clock<const> = require('cartlib/clock')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_evaluation_program<const> = require('cartlib/timeline/evaluation_program')
local timeline_frame_program<const> = require('cartlib/timeline/frame_program')
local timeline_playback<const> = require('cartlib/timeline/playback')
local timeline_sequence_program<const> = require('cartlib/timeline/sequence_program')
local timeline_track_program<const> = require('cartlib/timeline/track_program')

-- A definition is admitted into immutable evaluation data. Each timeline owns
-- one mutable playback record with its resolved bindings and evaluator state,
-- and atomically replaces this program on rebind.
local timeline_program<const> = {}
local playback_mode_by_name<const> = {
	once = timeline_playback.mode.once,
	loop = timeline_playback.mode.loop,
	pingpong = timeline_playback.mode.pingpong,
}
local empty_defs<const> = {}
local primary_binding_ids<const> = { 'target' }
local primary_binding_index_by_id<const> = { target = 1 }
local program_by_definition<const> = setmetatable({}, { __mode = 'k' })

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

function timeline_program.compile(definition)
	local cached<const> = program_by_definition[definition]
	if cached ~= nil then
		return cached
	end
	local frame_source<const> = definition.frames
	local track_defs<const> = definition.tracks or empty_defs
	local subsequence_defs<const> = definition.subsequences or empty_defs
	local continuous = definition.continuous
	if continuous == nil and frame_source == nil and (#track_defs > 0 or #subsequence_defs > 0) then
		continuous = true
	end
	local frame_duration = definition.frame_duration
	if frame_duration == nil then
		frame_duration = clock.update_milliseconds()
	end
	local auto_tick = definition.auto_tick
	if auto_tick == nil then
		auto_tick = continuous or frame_duration ~= 0
	end
	local clock_source<const> = definition.clock_source or timeline_clock_source.gameplay
	if clock_source == timeline_clock_source.manual then
		auto_tick = false
	end
	local frame_builder
	if type(frame_source) == 'function' then
		frame_builder = frame_source
	end
	local binding_ids<const>, binding_index_by_id<const> = compile_bindings(definition.bindings or empty_defs)
	local prepared_tracks<const> = timeline_track_program.prepare(track_defs, binding_index_by_id)
	local subsequences<const> = timeline_sequence_program.compile(
		subsequence_defs,
		binding_index_by_id,
		playback_mode_by_name,
		timeline_program.compile
	)
	local apply_function
	if type(definition.apply) == 'function' then
		apply_function = definition.apply
	end
	local apply_frames<const> = definition.apply ~= nil and apply_function == nil
	local has_evaluation_callbacks<const> = apply_function ~= nil
		or prepared_tracks.has_evaluation_callbacks
	local requires_frame_sampling<const> = has_evaluation_callbacks
		or subsequences.requires_frame_sampling
	local playback_mode<const> = playback_mode_by_name[definition.playback_mode or 'once']
	local program<const> = {
		repetitions = definition.repetitions or 1,
		frame_builder = frame_builder,
		frame_duration = frame_duration,
		playback_mode = playback_mode,
		continuous = continuous,
		auto_tick = auto_tick,
		clock_source = clock_source,
		duration_ms = definition.duration_ms,
		binding_ids = binding_ids,
		binding_index_by_id = binding_index_by_id,
		binding_count = #binding_ids,
		prepared_tracks = prepared_tracks,
		tracks = timeline_track_program.empty,
		subsequences = subsequences,
		apply_frames = apply_frames,
		apply_function = apply_function,
		has_evaluation_callbacks = has_evaluation_callbacks,
		requires_frame_sampling = requires_frame_sampling,
		default_binding = definition.target,
		default_params = definition.params,
		frames = {},
		length = 0,
	}
	program.evaluation_factory, program.has_evaluation_work = timeline_evaluation_program.compile(program)
	if program.duration_ms == nil and subsequences.clip_count > 0 then
		program.duration_ms = subsequences.duration_ms
	end
	if frame_builder ~= nil then
		program_by_definition[definition] = program
		return program
	end
	-- A duration-only sequence is an authored wait, not an empty frame array
	-- supplied by every caller. It advances and completes through the same
	-- retained playback boundary without manufacturing a dummy sample.
	if frame_source == nil then
		local compiled<const> = timeline_frame_program.compile(
			program,
			timeline_frame_program.empty_frames
		)
		program_by_definition[definition] = compiled
		return compiled
	end
	local compiled<const> = timeline_frame_program.compile(program, frame_source)
	program_by_definition[definition] = compiled
	return compiled
end

return timeline_program
