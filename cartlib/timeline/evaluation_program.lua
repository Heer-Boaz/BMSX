local timeline_playback<const> = require('cartlib/timeline/playback')
local timeline_sequence_evaluator<const> = require('cartlib/timeline/sequence_evaluator')
local timeline_track_evaluator<const> = require('cartlib/timeline/track_evaluator')
local lua_source_printer<const> = require('cartlib/codegen/lua_source_printer')

local evaluation_program<const> = {}
local update_method<const> = timeline_playback.update_method
local play_method<const> = update_method.play
local jump_method<const> = update_method.jump
local scrub_method<const> = update_method.scrub
local shape_values<const> = 0x001
local shape_position_values<const> = 0x002
local shape_tags<const> = 0x004
local shape_play_events<const> = 0x008
local shape_seek_events<const> = 0x010
local shape_scrub_events<const> = 0x020
local shape_apply_function<const> = 0x040
local shape_frame_appliers<const> = 0x080
local shape_subsequences<const> = 0x100
local evaluation_environment<const> = {
	bind_events = timeline_track_evaluator.bind_events,
	bind_play_tags = timeline_track_evaluator.bind_play_tags,
	bind_position_tags = timeline_track_evaluator.bind_position_tags,
	bind_play_sequences = timeline_sequence_evaluator.bind_play,
	bind_position_sequences = timeline_sequence_evaluator.bind_position,
}
local evaluation_factory_by_shape<const> = {}
local templates<const> = {}

local emit_dependency_captures<const> = function(printer, values)
	if values.has_tags then
		printer:emit(templates.tag_dependency_captures, values)
	end
	if values.has_subsequences then
		printer:emit(templates.sequence_dependency_captures, values)
	end
	if values.has_play_events or values.has_seek_events or values.has_scrub_events then
		printer:emit(templates.event_dependency_capture, values)
	end
end

local emit_program_captures<const> = function(printer, values)
	if values.has_values then
		printer:emit(templates.play_value_runner_capture, values)
		if values.has_position_values then
			printer:emit(templates.position_value_runner_capture, values)
		end
	end
	if values.has_apply_function then
		printer:emit(templates.apply_function_capture, values)
	end
	if values.has_frame_appliers then
		printer:emit(templates.frame_appliers_capture, values)
	end
	if values.has_tags then
		printer:emit(templates.tag_bindings, values)
	end
	if values.has_play_events then
		values.event_method = play_method
		values.event_name = 'play'
		printer:emit(templates.event_binding, values)
	end
	if values.has_seek_events then
		values.event_method = jump_method
		values.event_name = 'jump'
		printer:emit(templates.event_binding, values)
	end
	if values.has_scrub_events then
		values.event_method = scrub_method
		values.event_name = 'scrub'
		printer:emit(templates.event_binding, values)
	end
	if values.has_subsequences then
		printer:emit(templates.play_sequence_binding, values)
		printer:emit(templates.position_sequence_binding, values)
	end
end

local emit_tags<const> = function(printer, values)
	if not values.has_tags then
		return
	end
	if values.evaluator_name == 'play' then
		printer:emit(templates.play_tags, values)
	else
		printer:emit(templates.position_tags, values)
	end
end

local emit_values<const> = function(printer, values)
	if not values.has_values then
		return
	end
	if values.evaluator_name == 'play' or not values.has_position_values then
		printer:emit(templates.play_values, values)
	else
		printer:emit(templates.position_values, values)
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
	if not values.has_subsequences then
		return
	end
	if values.evaluator_name == 'play' then
		printer:emit(templates.play_sequences, values)
	else
		printer:emit(templates.position_sequences, values)
	end
end

local emit_events<const> = function(printer, values)
	local name<const> = values.evaluator_name
	if name == 'play' and values.has_play_events then
		printer:emit(templates.play_events, values)
	elseif name == 'jump' and values.has_seek_events then
		printer:emit(templates.jump_events, values)
	elseif name == 'scrub' and values.has_scrub_events then
		printer:emit(templates.scrub_events, values)
	end
end

local emit_body<const> = function(printer, values, name)
	values.evaluator_name = name
	printer:emit(templates.body, values)
end

local emit_play_body<const> = function(printer, values)
	emit_body(printer, values, 'play')
end

local emit_jump_body<const> = function(printer, values)
	emit_body(printer, values, values.jump_evaluator)
end

local emit_scrub_body<const> = function(printer, values)
	emit_body(printer, values, values.scrub_evaluator)
end

local emit_dispatch<const> = function(printer, values)
	if values.jump_evaluator == 'play' and values.scrub_evaluator == 'play' then
		emit_play_body(printer, values)
	elseif values.jump_evaluator == values.scrub_evaluator then
		printer:emit(templates.play_position_dispatch, values)
	else
		printer:emit(templates.method_dispatch, values)
	end
end

templates.tag_dependency_captures = lua_source_printer.compile_template([[
	local bind_play_tags<const> = bind_play_tags
	local bind_position_tags<const> = bind_position_tags
]])

templates.sequence_dependency_captures = lua_source_printer.compile_template([[
	local bind_play_sequences<const> = bind_play_sequences
	local bind_position_sequences<const> = bind_position_sequences
]])

templates.event_dependency_capture = lua_source_printer.compile_template(
	'local bind_events<const> = bind_events\n'
)

templates.play_value_runner_capture = lua_source_printer.compile_template(
	'local play_value_runner<const> = program["tracks"]["play_value_runner"]\n'
)

templates.position_value_runner_capture = lua_source_printer.compile_template(
	'local position_value_runner<const> = program["tracks"]["position_value_runner"]\n'
)

templates.apply_function_capture = lua_source_printer.compile_template(
	'local apply_function<const> = program["apply_function"]\n'
)

templates.frame_appliers_capture = lua_source_printer.compile_template(
	'local frame_appliers<const> = program["frame_appliers"]\n'
)

templates.tag_bindings = lua_source_printer.compile_template([[
	local evaluate_play_tags<const> = bind_play_tags(program)
	local evaluate_position_tags<const> = bind_position_tags(program)
]])

templates.event_binding = lua_source_printer.compile_template(
	'local emit_$event_name$_events<const> = bind_events(program, $event_method$)\n'
)

templates.play_sequence_binding = lua_source_printer.compile_template(
	'local evaluate_play_sequences<const> = bind_play_sequences(program)\n'
)

templates.position_sequence_binding = lua_source_printer.compile_template(
	'local evaluate_position_sequences<const> = bind_position_sequences(program)\n'
)

templates.play_tags = lua_source_printer.compile_template(
	'evaluate_play_tags(entry, owner, evaluation)\n'
)

templates.position_tags = lua_source_printer.compile_template(
	'evaluate_position_tags(entry, owner, evaluation)\n'
)

templates.play_values = lua_source_printer.compile_template(
	'play_value_runner(entry, evaluation)\n'
)

templates.position_values = lua_source_printer.compile_template(
	'position_value_runner(entry, evaluation)\n'
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

templates.play_sequences = lua_source_printer.compile_template(
	'evaluate_play_sequences(entry, owner, evaluation)\n'
)

templates.position_sequences = lua_source_printer.compile_template(
	'evaluate_position_sequences(entry, owner, evaluation)\n'
)

templates.play_events = lua_source_printer.compile_template(
	'emit_play_events(owner, evaluation)\n'
)

templates.jump_events = lua_source_printer.compile_template(
	'emit_jump_events(owner, evaluation)\n'
)

templates.scrub_events = lua_source_printer.compile_template(
	'emit_scrub_events(owner, evaluation)\n'
)

templates.body = lua_source_printer.compile_template([[
	$tags$
	$values$
	$sample$
	$subsequences$
	$events$
]], {
	tags = emit_tags,
	values = emit_values,
	sample = emit_sample,
	subsequences = emit_subsequences,
	events = emit_events,
})

templates.play_position_dispatch = lua_source_printer.compile_template([[
	if evaluation["method"] == $play_method$ then
		$play_body$
	else
		$jump_body$
	end
]], {
	play_body = emit_play_body,
	jump_body = emit_jump_body,
})

templates.method_dispatch = lua_source_printer.compile_template([[
	if evaluation["method"] == $play_method$ then
		$play_body$
	elseif evaluation["method"] == $jump_method$ then
		$jump_body$
	else
		$scrub_body$
	end
]], {
	play_body = emit_play_body,
	jump_body = emit_jump_body,
	scrub_body = emit_scrub_body,
})

templates.program = lua_source_printer.compile_template([[
	$dependency_captures$
	return function(program)
		$program_captures$
		return function(entry, owner, evaluation)
			$dispatch$
		end
	end
]], {
	dependency_captures = emit_dependency_captures,
	program_captures = emit_program_captures,
	dispatch = emit_dispatch,
})

-- Program admission cooks track shape and traversal policy into one evaluator.
-- Programs whose methods differ branch once per retained evaluation; programs
-- with identical play, jump and scrub plans contain no method dispatch at all.
function evaluation_program.compile(program)
	local prepared_tracks<const> = program.prepared_tracks
	local has_values<const> = prepared_tracks.value_track_count > 0
	local has_position_values<const> = prepared_tracks.has_frame_steps or prepared_tracks.has_time_steps
	local has_tags<const> = #prepared_tracks.tag_defs > 0
	local has_play_events<const> = #prepared_tracks.event_defs > 0
	local has_seek_events<const> = prepared_tracks.has_seek_events
	local has_scrub_events<const> = prepared_tracks.has_scrub_events
	local has_apply_function<const> = program.apply_function ~= nil
	local has_frame_appliers<const> = program.apply_frames
	local has_subsequences<const> = program.subsequences.clip_count > 0
	local shape = 0
	if has_values then
		shape = shape | shape_values
	end
	if has_position_values then
		shape = shape | shape_position_values
	end
	if has_tags then
		shape = shape | shape_tags
	end
	if has_play_events then
		shape = shape | shape_play_events
	end
	if has_seek_events then
		shape = shape | shape_seek_events
	end
	if has_scrub_events then
		shape = shape | shape_scrub_events
	end
	if has_apply_function then
		shape = shape | shape_apply_function
	end
	if has_frame_appliers then
		shape = shape | shape_frame_appliers
	end
	if has_subsequences then
		shape = shape | shape_subsequences
	end
	local factory<const> = evaluation_factory_by_shape[shape]
	if factory ~= nil then
		return factory
	end
	local has_position_difference<const> = has_tags
		or has_position_values
		or has_play_events
		or has_subsequences
	local jump_evaluator = 'play'
	local scrub_evaluator = 'play'
	if has_position_difference then
		jump_evaluator = 'position'
		scrub_evaluator = 'position'
	end
	if has_seek_events then
		jump_evaluator = 'jump'
	end
	if has_scrub_events then
		scrub_evaluator = 'scrub'
	end
	local values<const> = {
		has_values = has_values,
		has_position_values = has_position_values,
		has_tags = has_tags,
		has_play_events = has_play_events,
		has_seek_events = has_seek_events,
		has_scrub_events = has_scrub_events,
		has_apply_function = has_apply_function,
		has_frame_appliers = has_frame_appliers,
		has_subsequences = has_subsequences,
		jump_evaluator = jump_evaluator,
		scrub_evaluator = scrub_evaluator,
		play_method = play_method,
		jump_method = jump_method,
	}
	local printer<const> = lua_source_printer.new()
	printer:emit(templates.program, values)
	local compiled_factory<const> = load(
		printer:finish(),
		'[timeline.evaluation_program]',
		't',
		evaluation_environment
	)()
	evaluation_factory_by_shape[shape] = compiled_factory
	return compiled_factory
end

return evaluation_program
