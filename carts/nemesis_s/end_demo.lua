local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local atlas<const> = require('cartlib/gx/atlas')
local prefab<const> = require('cartlib/world/prefab')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
require('constants')

local scene_library<const> = require('cartlib/world/scene_library')
local end_demo_scene<const> = require('scenes/end_demo')

local end_demo<const> = {}
end_demo.__index = end_demo

local end_demo_definition_id<const> = 'nemesis_s.end_demo'
local end_demo_instance_id<const> = 'nemesis_s.end_demo'
local fsm_id<const> = 'nemesis_s.end_demo.fsm'
local presentation_timeline_id<const> = 'nemesis_s.end_demo.presentation'
local reveal_step_ms<const> = 20
local curtain_step_ms<const> = 150
local slide_hold_ms<const> = 18000
local slide_gap_ms<const> = 200
local first_reveal_end_ms<const> = 240
local first_curtain_start_ms<const> = first_reveal_end_ms + slide_hold_ms
local curtain_duration_ms<const> = 8 * curtain_step_ms
local first_curtain_end_ms<const> = first_curtain_start_ms + curtain_duration_ms
local second_slide_start_ms<const> = first_curtain_end_ms + slide_gap_ms
local second_reveal_end_ms<const> = second_slide_start_ms + 160
local second_curtain_start_ms<const> = second_reveal_end_ms + slide_hold_ms
local second_curtain_end_ms<const> = second_curtain_start_ms + curtain_duration_ms
local slides<const> = end_demo_scene.panels

local apply_slide<const> = function(target, slide_index)
	local slide<const> = slides[slide_index]
	target.presentation.picture:set_imgid(slide.imgid)
	local caption<const> = target.presentation.caption.text_component
	caption.offset_x = slide.text_x
	caption:set_text(slide.text)
end

local apply_reveal<const> = function(target, height)
	target.presentation.caption.text_component:set_glyph_visible_height(height)
end

local apply_curtain_frame<const> = function(target, frame)
	target.presentation.curtain.count = frame + 1
end

local first_reveal_sequence<const> = {
	frames = timeline.build_frame_sequence({
		{ value = 0, hold = 5 },
		{ value = 1 },
		{ value = 2 },
		{ value = 3 },
		{ value = 4 },
		{ value = 5 },
		{ value = 6 },
		{ value = 7 },
		{ value = 8 },
	}),
	frame_duration = reveal_step_ms,
	playback_mode = 'once',
	apply = apply_reveal,
}

local second_reveal_sequence<const> = {
	frames = timeline.range(9),
	frame_duration = reveal_step_ms,
	playback_mode = 'once',
	apply = apply_reveal,
}

local curtain_sequence<const> = {
	frames = timeline.range(8),
	frame_duration = curtain_step_ms,
	playback_mode = 'once',
	apply = apply_curtain_frame,
}

local presentation_timeline<const> = {
	continuous = true,
	duration_ms = second_curtain_end_ms,
	playback_mode = 'once',
	clock_source = timeline_clock_source.frame,
	tracks = {
		{
			kind = 'value',
			interpolation = 'step',
			apply = apply_slide,
			keys = {
				{ time_ms = 0, value = 1 },
				{ time_ms = second_slide_start_ms, value = 2 },
			},
		},
		{
			kind = 'value',
			interpolation = 'step',
			apply = function(target, visible)
				target.presentation.picture.visible = visible
				target.presentation.caption.visible = visible
			end,
			keys = {
				{ time_ms = 0, value = true },
				{ time_ms = first_curtain_end_ms, value = false },
				{ time_ms = second_slide_start_ms, value = true },
			},
		},
		{
			kind = 'value',
			interpolation = 'step',
			path = { 'presentation', 'curtain', 'visible' },
			keys = {
				{ time_ms = 0, value = false },
				{ time_ms = first_curtain_start_ms, value = true },
				{ time_ms = first_curtain_end_ms, value = false },
				{ time_ms = second_curtain_start_ms, value = true },
			},
		},
	},
	subsequences = {
		{
			id = 'first_reveal',
			start_time_ms = 0,
			duration_ms = 13 * reveal_step_ms,
			sequence = first_reveal_sequence,
		},
		{
			id = 'first_curtain',
			start_time_ms = first_curtain_start_ms,
			duration_ms = curtain_duration_ms,
			sequence = curtain_sequence,
		},
		{
			id = 'second_reveal',
			start_time_ms = second_slide_start_ms,
			duration_ms = 9 * reveal_step_ms,
			sequence = second_reveal_sequence,
		},
		{
			id = 'second_curtain',
			start_time_ms = second_curtain_start_ms,
			duration_ms = curtain_duration_ms,
			sequence = curtain_sequence,
		},
	},
}

local finish<const> = function(self)
	self.events:emit('end_demo_done')
	return '/hidden'
end

function end_demo:begin()
	atlas.load('font')
	atlas.load('end_demo')
	self.presentation = scene_library.instantiate(end_demo_scene.id)
end

function end_demo:release_presentation()
	if self.presentation then
		scene_library.dispose(self.presentation)
		self.presentation = nil
	end
end

end_demo.ondespawn = end_demo.release_presentation

local define_fsm<const> = function()
	fsm_library.register(fsm_id, {
		initial = 'hidden',
		on = {
			['end_demo'] = {
				emitter = ids_director_instance,
				go = '/playing',
			},
		},
		states = {
			hidden = {},
			playing = {
				entering_state = end_demo.begin,
				exiting_state = end_demo.release_presentation,
				timelines = {
					[presentation_timeline_id] = {
						def = presentation_timeline,
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
						on_finished = finish,
					},
				},
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = end_demo_definition_id,
		class = end_demo,
		components = {
			timeline_component.new,
			fsm_component.factory({ fsm_id }),
		},
	})
end

return {
	definition_id = end_demo_definition_id,
	instance_id = end_demo_instance_id,
	define_fsm = define_fsm,
	register_definition = register_definition,
}
