local timeline_sequence_evaluator<const> = require('cartlib/timeline/sequence_evaluator')
local timeline_track_evaluator<const> = require('cartlib/timeline/track_evaluator')
local lua_source_printer<const> = require('cartlib/codegen/lua_source_printer')

local evaluation_program<const> = {}
local evaluation_environment<const> = {
	evaluate_tags = timeline_track_evaluator.evaluate_tags,
	evaluate_sequences = timeline_sequence_evaluator.evaluate,
	emit_events = timeline_track_evaluator.emit_events,
}
local templates<const> = {}

local emit_dependency_captures<const> = function(printer, values)
	if values.has_tags then
		printer:emit(templates.evaluate_tags_capture, values)
	end
	if values.has_subsequences then
		printer:emit(templates.evaluate_sequences_capture, values)
	end
	if values.has_events then
		printer:emit(templates.emit_events_capture, values)
	end
end

local emit_program_captures<const> = function(printer, values)
	if values.has_values then
		printer:emit(templates.value_runner_capture, values)
	end
	if values.has_apply_function then
		printer:emit(templates.apply_function_capture, values)
	end
	if values.has_frame_appliers then
		printer:emit(templates.frame_appliers_capture, values)
	end
end

local emit_tags<const> = function(printer, values)
	if values.has_tags then
		printer:emit(templates.tags, values)
	end
end

local emit_values<const> = function(printer, values)
	if values.has_values then
		printer:emit(templates.values, values)
	end
end

local emit_apply_function<const> = function(printer, values)
	if values.has_apply_function then
		printer:emit(templates.apply_function, values)
	end
end

local emit_frame_appliers<const> = function(printer, values)
	if values.has_frame_appliers then
		printer:emit(templates.frame_appliers, values)
	end
end

local emit_sample<const> = function(printer, values)
	if values.has_apply_function or values.has_frame_appliers then
		printer:emit(templates.sample, values)
	end
end

local emit_subsequences<const> = function(printer, values)
	if values.has_subsequences then
		printer:emit(templates.subsequences, values)
	end
end

local emit_events<const> = function(printer, values)
	if values.has_events then
		printer:emit(templates.events, values)
	end
end

templates.value_runner_capture = lua_source_printer.compile_template(
	'local value_runner<const> = program["tracks"]["value_runner"]\n'
)

templates.apply_function_capture = lua_source_printer.compile_template(
	'local apply_function<const> = program["apply_function"]\n'
)

templates.frame_appliers_capture = lua_source_printer.compile_template(
	'local frame_appliers<const> = program["frame_appliers"]\n'
)

templates.evaluate_tags_capture = lua_source_printer.compile_template(
	'local evaluate_tags<const> = evaluate_tags\n'
)

templates.evaluate_sequences_capture = lua_source_printer.compile_template(
	'local evaluate_sequences<const> = evaluate_sequences\n'
)

templates.emit_events_capture = lua_source_printer.compile_template(
	'local emit_events<const> = emit_events\n'
)

templates.tags = lua_source_printer.compile_template(
	'evaluate_tags(entry, owner, evaluation)\n'
)

templates.values = lua_source_printer.compile_template(
	'value_runner(entry, evaluation)\n'
)

templates.apply_function = lua_source_printer.compile_template(
	'apply_function(entry["primary_binding"], evaluation["value"], entry["params"], evaluation)\n'
)

templates.frame_appliers = lua_source_printer.compile_template(
	'frame_appliers[evaluation["frame"] + 1](entry["primary_binding"], evaluation["value"])\n'
)

templates.sample = lua_source_printer.compile_template([[
	if evaluation["sample"] then
		$apply_function$
		$frame_appliers$
	end
]], {
	apply_function = emit_apply_function,
	frame_appliers = emit_frame_appliers,
})

templates.subsequences = lua_source_printer.compile_template(
	'evaluate_sequences(entry, owner, evaluation)\n'
)

templates.events = lua_source_printer.compile_template(
	'emit_events(entry, owner, evaluation)\n'
)

templates.evaluator = lua_source_printer.compile_template([[
	$dependency_captures$
	return function(program)
		$program_captures$
		return function(entry, owner, evaluation)
			$tags$
			$values$
			$sample$
			$subsequences$
			$events$
		end
	end
]], {
	dependency_captures = emit_dependency_captures,
	program_captures = emit_program_captures,
	tags = emit_tags,
	values = emit_values,
	sample = emit_sample,
	subsequences = emit_subsequences,
	events = emit_events,
})

-- Each timeline shape compiles exactly the phases it owns. The returned
-- factory binds the finalized frame program once, so evaluation retains its
-- immutable track and apply programs without resolving them through an entry.
function evaluation_program.compile(program)
	local prepared_tracks<const> = program.prepared_tracks
	local printer<const> = lua_source_printer.new()
	printer:emit(templates.evaluator, {
		has_values = prepared_tracks.value_track_count > 0,
		has_tags = #prepared_tracks.tag_defs > 0,
		has_events = #prepared_tracks.event_defs > 0,
		has_apply_function = program.apply_function ~= nil,
		has_frame_appliers = program.apply_frames,
		has_subsequences = program.subsequences.clip_count > 0,
	})
	return load(
		printer:finish(),
		'[timeline.evaluation_program]',
		't',
		evaluation_environment
	)()
end

return evaluation_program
