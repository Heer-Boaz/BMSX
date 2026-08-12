local timeline_sequence_evaluator<const> = require('cartlib/timeline/sequence_evaluator')
local timeline_track_evaluator<const> = require('cartlib/timeline/track_evaluator')

local evaluation_program<const> = {}
local evaluation_environment<const> = {
	evaluate_tags = timeline_track_evaluator.evaluate_tags,
	evaluate_sequences = timeline_sequence_evaluator.evaluate,
	emit_events = timeline_track_evaluator.emit_events,
}

-- Each immutable timeline program compiles exactly the phases it owns. The
-- returned evaluator contains no feature-presence checks on the update path.
function evaluation_program.compile(program)
	local prepared_tracks<const> = program.prepared_tracks
	local has_values<const> = prepared_tracks.value_track_count > 0
	local has_tags<const> = #prepared_tracks.tag_defs > 0
	local has_events<const> = #prepared_tracks.event_defs > 0
	local has_apply_function<const> = program.apply_function ~= nil
	local has_frame_appliers<const> = program.apply_frames
	local has_subsequences<const> = program.subsequences.clip_count > 0
	local parts<const> = {
		'return function(entry, owner, evaluation, payload)\n',
	}
	if has_values or has_apply_function or has_frame_appliers then
		parts[#parts + 1] = 'local program = entry["instance"]["program"]\n'
	end
	if has_tags then
		parts[#parts + 1] = 'evaluate_tags(entry, owner, evaluation)\n'
	end
	if has_values then
		parts[#parts + 1] = 'program["tracks"]["value_runner"](entry, evaluation)\n'
	end
	if has_apply_function or has_frame_appliers then
		parts[#parts + 1] = 'if evaluation["sample"] then\n'
		if has_apply_function then
			parts[#parts + 1] = 'program["apply_function"](entry["primary_binding"], payload["frame_value"], entry["params"], evaluation)\n'
		end
		if has_frame_appliers then
			parts[#parts + 1] = 'program["frame_appliers"][payload["frame_index"] + 1](entry["primary_binding"], payload["frame_value"])\n'
		end
		parts[#parts + 1] = 'end\n'
	end
	if has_subsequences then
		parts[#parts + 1] = 'evaluate_sequences(entry, owner, evaluation)\n'
	end
	if has_events then
		parts[#parts + 1] = 'emit_events(entry, owner, evaluation)\n'
	end
	parts[#parts + 1] = 'end'
	return load(
		table.concat(parts),
		'[timeline.evaluation_program]',
		't',
		evaluation_environment
	)()
end

return evaluation_program
