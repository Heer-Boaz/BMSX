local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local font<const> = require('cartlib/font')
local atlas<const> = require('cartlib/gx/atlas')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local text_component<const> = require('cartlib/text/text_component')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local game_text<const> = require('game_text')
local nemesis_font<const> = require('nemesis_font')
require('constants')

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
local slides<const> = {
	{
		imgid = 'end_demo_sint_duim',
		text = game_text.end_demo_sint_text,
		line_count = #game_text.end_demo_sint_text,
		text_x = 0,
	},
	{
		imgid = 'end_demo_boaz',
		text = game_text.end_demo_boaz_text,
		line_count = #game_text.end_demo_boaz_text,
		text_x = 128,
	},
}

local draw_curtain<const> = function(component, draw)
	local count<const> = component.parent.curtain_count
	if count == 8 then
		draw:rect(0, 0, presentation_width, presentation_height, 0xff000000)
		return
	end
	for y = 0, presentation_height - 1, 8 do
		draw:rect(0, y, presentation_width, y + count, 0xff000000)
	end
end

local apply_slide<const> = function(target, slide_index)
	local slide<const> = slides[slide_index]
	target:set_imgid(slide.imgid)
	local caption<const> = target.caption
	caption.offset_x = slide.text_x
	caption:set_static_text(slide.text, slide.line_count)
end

local apply_reveal<const> = function(target, height)
	target.caption:set_glyph_visible_height(height)
end

local apply_curtain_frame<const> = function(target, frame)
	target.curtain_count = frame + 1
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
			path = { 'visible' },
			keys = {
				{ time_ms = 0, value = true },
				{ time_ms = first_curtain_end_ms, value = false },
				{ time_ms = second_slide_start_ms, value = true },
			},
		},
		{
			kind = 'value',
			interpolation = 'step',
			path = { 'curtain', 'visible' },
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
	self.visible = false
	self.events:emit('end_demo_done')
	return '/hidden'
end

function end_demo:ctor()
	local caption<const> = text_component.new({
		id_local = 'caption',
		offset_y = 8,
		offset_z = 1,
	})
	caption:set_font(font.get(nemesis_font.font_id))
	caption:set_glyph_visible_height(0)
	self:add_component(caption)
	self.caption = caption

	local curtain<const> = custom_visual_component.new({
		id_local = 'curtain',
		offset_z = 2,
		draw = draw_curtain,
	})
	curtain.visible = false
	self:add_component(curtain)
	self.curtain = curtain
end

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
				entering_state = function()
					atlas.load('font')
					atlas.load('end_demo')
				end,
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
		base = sprite_object,
		components = {
			timeline_component.new,
			fsm_component.factory({ fsm_id }),
		},
		defaults = {
			id = end_demo_instance_id,
			curtain_count = 0,
		},
	})
end

return {
	definition_id = end_demo_definition_id,
	instance_id = end_demo_instance_id,
	define_fsm = define_fsm,
	register_definition = register_definition,
}
