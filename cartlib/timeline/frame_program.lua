local timeline_apply<const> = require('cartlib/timeline/apply')
local timeline_track_program<const> = require('cartlib/timeline/track_program')

local frame_program<const> = {}
frame_program.empty_frames = {}

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

function frame_program.compile(program, frame_source)
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
	if not compiled.continuous then
		compiled.duration_ms = compiled.length * compiled.frame_duration
	end
	compiled.tracks = timeline_track_program.compile(
		program.prepared_tracks,
		compiled.length,
		compiled.duration_ms
	)
	if program.apply_frames then
		compiled.frame_appliers = timeline_apply.compile_frames(compiled.frames)
	else
		compiled.frame_appliers = nil
	end
	compiled.evaluate_play, compiled.evaluate_jump, compiled.evaluate_scrub = compiled.evaluation_factory(compiled)
	return compiled
end

function frame_program.build(program, params)
	return frame_program.compile(program, program.frame_builder(params))
end

function frame_program.value(program, index)
	if index < 0 or index >= program.length then
		return nil
	end
	if program.range_source_length ~= nil then
		return index % program.range_source_length
	end
	return program.frames[index + 1]
end

return frame_program
