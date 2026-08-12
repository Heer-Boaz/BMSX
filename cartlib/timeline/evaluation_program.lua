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

local emit_program_local<const> = function(printer, values)
	if values.has_values or values.has_apply_function or values.has_frame_appliers then
		printer:emit(templates.program_local, values)
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

templates.program_local = lua_source_printer.compile_template(
	'local program = entry["instance"]["program"]\n'
)

templates.tags = lua_source_printer.compile_template(
	'evaluate_tags(entry, owner, evaluation)\n'
)

templates.values = lua_source_printer.compile_template(
	'program["tracks"]["value_runner"](entry, evaluation)\n'
)

templates.apply_function = lua_source_printer.compile_template(
	'program["apply_function"](entry["primary_binding"], evaluation["value"], entry["params"], evaluation)\n'
)

templates.frame_appliers = lua_source_printer.compile_template(
	'program["frame_appliers"][evaluation["frame"] + 1](entry["primary_binding"], evaluation["value"])\n'
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
	return function(entry, owner, evaluation)
		$program_local$
		$tags$
		$values$
		$sample$
		$subsequences$
		$events$
	end
]], {
	program_local = emit_program_local,
	tags = emit_tags,
	values = emit_values,
	sample = emit_sample,
	subsequences = emit_subsequences,
	events = emit_events,
})

-- Each immutable timeline program compiles exactly the phases it owns. The
-- returned evaluator contains no feature-presence checks on the update path.
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
