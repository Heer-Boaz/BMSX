local timeline_evaluation_context<const> = require('cartlib/timeline/evaluation_context')
local timeline_playback<const> = require('cartlib/timeline/playback')
local timeline_sequence_evaluator<const> = require('cartlib/timeline/sequence_evaluator')
local timeline_track_evaluator<const> = require('cartlib/timeline/track_evaluator')
local evaluation_program_source<const> = require('cartlib/timeline/evaluation_program_source')
local lua_syntax_printer<const> = require('cartlib/codegen/lua_syntax_printer')

local evaluation_program<const> = {}
local update_method<const> = timeline_playback.update_method
local play_method<const> = update_method.play
local jump_method<const> = update_method.jump
local scrub_method<const> = update_method.scrub
local sample_flag<const> = timeline_playback.evaluation_flag.sample
local shape_values<const> = 0x001
local shape_position_values<const> = 0x002
local shape_tags<const> = 0x004
local shape_play_events<const> = 0x008
local shape_seek_events<const> = 0x010
local shape_scrub_events<const> = 0x020
local shape_apply_function<const> = 0x040
local shape_frame_appliers<const> = 0x080
local shape_subsequences<const> = 0x100
local shape_evaluation_context<const> = 0x200
local evaluation_environment<const> = {
	bind_events = timeline_track_evaluator.bind_events,
	bind_play_tags = timeline_track_evaluator.bind_play_tags,
	bind_position_tags = timeline_track_evaluator.bind_position_tags,
	bind_play_sequences = timeline_sequence_evaluator.bind_play,
	bind_position_sequences = timeline_sequence_evaluator.bind_position,
	frame_value = timeline_evaluation_context.value,
	write_evaluation_context = timeline_evaluation_context.write,
}
local evaluation_factory_by_shape<const> = {}

-- Program admission cooks track shape and traversal policy into method-specific
-- evaluators. Engine-internal ranges stay in registers; only authored callback
-- programs materialize the named evaluation table they expose to cart code.
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
	local has_evaluation_context<const> = program.has_evaluation_callbacks
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
	if has_evaluation_context then
		shape = shape | shape_evaluation_context
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
	local syntax_tree<const> = evaluation_program_source.build({
		has_values = has_values,
		has_position_values = has_position_values,
		has_tags = has_tags,
		has_play_events = has_play_events,
		has_seek_events = has_seek_events,
		has_scrub_events = has_scrub_events,
		has_apply_function = has_apply_function,
		has_frame_appliers = has_frame_appliers,
		has_subsequences = has_subsequences,
		has_evaluation_context = has_evaluation_context,
		jump_evaluator = jump_evaluator,
		scrub_evaluator = scrub_evaluator,
		play_method = play_method,
		jump_method = jump_method,
		scrub_method = scrub_method,
		sample_flag = sample_flag,
	})
	local compiled_factory<const> = load(
		lua_syntax_printer.print(syntax_tree),
		'[timeline.evaluation_program]',
		't',
		evaluation_environment
	)()
	evaluation_factory_by_shape[shape] = compiled_factory
	return compiled_factory
end

return evaluation_program
