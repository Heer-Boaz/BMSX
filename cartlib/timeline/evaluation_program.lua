local timeline_sequence_evaluator<const> = require('cartlib/timeline/sequence_evaluator')
local timeline_track_evaluator<const> = require('cartlib/timeline/track_evaluator')
local lua_source_writer<const> = require('cartlib/codegen/lua_source_writer')

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
	local writer<const> = lua_source_writer.new()
	writer:begin_block('return function(entry, owner, evaluation)')
	if has_values or has_apply_function or has_frame_appliers then
		writer:line('local program = entry["instance"]["program"]')
	end
	if has_tags then
		writer:line('evaluate_tags(entry, owner, evaluation)')
	end
	if has_values then
		writer:line('program["tracks"]["value_runner"](entry, evaluation)')
	end
	if has_apply_function or has_frame_appliers then
		writer:begin_block('if evaluation["sample"] then')
		if has_apply_function then
			writer:line('program["apply_function"](entry["primary_binding"], evaluation["value"], entry["params"], evaluation)')
		end
		if has_frame_appliers then
			writer:line('program["frame_appliers"][evaluation["frame"] + 1](entry["primary_binding"], evaluation["value"])')
		end
		writer:end_block()
	end
	if has_subsequences then
		writer:line('evaluate_sequences(entry, owner, evaluation)')
	end
	if has_events then
		writer:line('emit_events(entry, owner, evaluation)')
	end
	writer:end_block()
	return load(
		writer:finish(),
		'[timeline.evaluation_program]',
		't',
		evaluation_environment
	)()
end

return evaluation_program
