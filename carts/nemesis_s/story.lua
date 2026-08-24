local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local font<const> = require('cartlib/font')
local gx_texture<const> = require('cartlib/gx/texture')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local text_component<const> = require('cartlib/text/text_component')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local game_text<const> = require('game_text')
local nemesis_font<const> = require('nemesis_font')
require('constants')

local story<const> = {}
story.__index = story

local story_definition_id<const> = 'nemesis_s.story'
local story_instance_id<const> = 'nemesis_s.story'
local story_fsm_id<const> = 'nemesis_s.story.fsm'
local frame_at_or_after<const> = timeline.frame_at_or_after
local normal_slide_out_duration_frames<const> = 86
local normal_next_slide_wait_frames<const> = 15
local normal_slide_out_offsets<const> = { 0, 11, 22, 33, 43, 54, 65, 75 }
local curtain_none<const> = 0
local curtain_slide<const> = 1
local curtain_venom<const> = 2
-- Content-to-content boundaries measured with Nemesis 2 on a 50 Hz European MSX1.
-- The cart replaces the original pictures and captions, but each authored
-- panel still owns the corresponding original presentation interval.
local story_slides<const> = {
	{ imgid = 'story_coup', text = game_text.story_1_text, line_count = 4, text_y = 144, duration_frames = 1257 },
	{ imgid = 'story_piet1', text = game_text.story_2_text, line_count = 5, text_y = 128, duration_frames = 538 },
	{ imgid = 'story_escape', text = game_text.story_3_text, line_count = 4, text_y = 144, duration_frames = 480 },
	{ imgid = 'story_boot', text = game_text.story_4_text, line_count = 3, text_y = 152, duration_frames = 419 },
	{ imgid = 'story_winterstad', text = game_text.story_5_text, line_count = 4, text_y = 160, duration_frames = 367 },
	{ text = game_text.story_6_text, line_count = 1, text_y = 128, duration_frames = 1014 },
	{ imgid = 'story_map', text = game_text.story_7_text, line_count = 6, text_y = 144, duration_frames = 2101 },
	{ imgid = 'story_metalion', text = game_text.story_8_text, line_count = 5, text_y = 144, duration_frames = 1202 },
	{ imgid = 'story_pilot', text = game_text.story_9_text, line_count = 6, text_y = 128, duration_frames = 839 },
}

local reveal_keys<const> = {
	{ frame = 0, value = 0 },
	{ frame = 8, value = 1 },
	{ frame = 9, value = 2 },
	{ frame = 10, value = 3 },
	{ frame = 12, value = 4 },
	{ frame = 13, value = 5 },
	{ frame = 15, value = 6 },
	{ frame = 16, value = 7 },
	{ frame = 18, value = 8 },
}

local draw_slide_curtain<const> = function(component, draw)
	local count<const> = component.parent.curtain_count
	if count == 8 then
		draw:rect(0, 0, presentation_width, presentation_height, 0xff000000)
		return
	end
	for y = 0, presentation_height - 1, 8 do
		draw:rect(0, y, presentation_width, y + count, 0xff000000)
	end
end

local draw_venom_curtain<const> = function(component, draw)
	local owner<const> = component.parent
	draw:rect(0, 0, presentation_width, owner.curtain_end, 0xff000000)
	draw:rect(0, owner.curtain_start, presentation_width, owner.primary_text.offset_y, 0xff000000)
end

function story:set_curtain_mode(mode)
	self.curtain_mode = mode
	if mode == curtain_none then
		self.curtain:set_draw_function(nil)
	elseif mode == curtain_slide then
		self.curtain:set_draw_function(draw_slide_curtain)
	else
		self.curtain:set_draw_function(draw_venom_curtain)
	end
end

local apply_primary_reveal<const> = function(target, height)
	target.primary_text:set_glyph_visible_height(height)
end

local apply_secondary_reveal<const> = function(target, height)
	target.secondary_text:set_glyph_visible_height(height)
end

local apply_curtain_mode<const> = function(target, mode)
	target:set_curtain_mode(mode)
end

local apply_venom_image<const> = function(target, visible)
	if visible then
		target:set_imgid('story_piet2')
		gx_texture.upload('story_piet2')
	else
		target:set_imgid(nil)
	end
end

local build_curtain_count_keys<const> = function(start_frame, offsets)
	local keys<const> = {
		{ frame = 0, value = 0 },
	}
	for count = 1, #offsets do
		keys[#keys + 1] = {
			frame = start_frame + offsets[count],
			value = count,
		}
	end
	return keys
end

local build_normal_timeline<const> = function(slide)
	local duration_frames<const> = slide.duration_frames
	local slide_out_start_frame<const> = duration_frames
		- normal_slide_out_duration_frames
		- normal_next_slide_wait_frames
	return {
		frames = timeline.range(duration_frames),
		playback_mode = 'once',
		clock_source = timeline_clock_source.frame,
		tracks = {
			{
				kind = 'value',
				interpolation = 'step',
				apply = apply_primary_reveal,
				keys = reveal_keys,
			},
			{
				kind = 'value',
				interpolation = 'step',
				path = { 'curtain_count' },
				keys = build_curtain_count_keys(slide_out_start_frame, normal_slide_out_offsets),
			},
			{
				kind = 'value',
				interpolation = 'step',
				apply = apply_curtain_mode,
				keys = {
					{ frame = 0, value = curtain_none },
					{ frame = slide_out_start_frame, value = curtain_slide },
				},
			},
		},
	}
end

local venom_duration_frames<const> = story_slides[6].duration_frames
-- The original 50 Hz Venom panel starts its portrait at frame 126, completes
-- the opening at 158, closes over frames 246..310, wipes over 330..630,
-- reveals the second caption over 651..663 and begins its exit at 961.
-- The replacement portrait has more geometric steps, so those steps are
-- distributed over the same retained VBlank spans instead of reviving the
-- XNA millisecond timers.
local venom_image_start_frame<const> = 126
local venom_open_end_frame<const> = 158
local venom_close_start_frame<const> = 246
local venom_close_end_frame<const> = 310
local venom_wipe_start_frame<const> = 330
local venom_wipe_end_frame<const> = 630
local venom_curtain_clear_frame<const> = 631
local venom_secondary_start_frame<const> = 651
local venom_secondary_end_frame<const> = 663
local venom_slide_out_start_frame<const> = 961
local venom_slide_out_offsets<const> = { 0, 6, 12, 18, 24, 30, 36, 42 }

local build_secondary_reveal_keys<const> = function()
	local keys<const> = {
		{ frame = 0, value = 0 },
	}
	for height = 1, 8 do
		keys[#keys + 1] = {
			frame = venom_secondary_start_frame + frame_at_or_after(
				(height - 1) * (venom_secondary_end_frame - venom_secondary_start_frame),
				7
			),
			value = height,
		}
	end
	return keys
end

local build_venom_timeline<const> = function()
	local curtain_start_keys<const> = {
		{ frame = 0, value = 126 },
		{ frame = venom_image_start_frame, value = 126 },
	}
	local curtain_end_keys<const> = {
		{ frame = 0, value = 110 },
		{ frame = venom_image_start_frame, value = 110 },
	}
	for step = 1, 6 do
		curtain_start_keys[#curtain_start_keys + 1] = {
			frame = venom_image_start_frame + frame_at_or_after(
				step * (venom_open_end_frame - venom_image_start_frame),
				6
			),
			value = 126 - step * 8,
		}
		curtain_end_keys[#curtain_end_keys + 1] = {
			frame = venom_image_start_frame + frame_at_or_after(
				step * (venom_open_end_frame - venom_image_start_frame),
				6
			),
			value = 110 - step * 8,
		}
	end
	for step = 1, 6 do
		curtain_start_keys[#curtain_start_keys + 1] = {
			frame = venom_close_start_frame + frame_at_or_after(
				(step - 1) * (venom_close_end_frame - venom_close_start_frame),
				5
			),
			value = 78 + step * 8,
		}
		curtain_end_keys[#curtain_end_keys + 1] = {
			frame = venom_close_start_frame + frame_at_or_after(
				(step - 1) * (venom_close_end_frame - venom_close_start_frame),
				5
			),
			value = 62 + step * 8,
		}
	end
	for step = 1, 106 do
		curtain_end_keys[#curtain_end_keys + 1] = {
			frame = venom_wipe_start_frame + frame_at_or_after(
				(step - 1) * (venom_wipe_end_frame - venom_wipe_start_frame),
				105
			),
			value = 110 - step,
		}
	end
	return {
		frames = timeline.range(venom_duration_frames),
		playback_mode = 'once',
		clock_source = timeline_clock_source.frame,
		tracks = {
			{
				kind = 'value',
				interpolation = 'step',
				apply = apply_primary_reveal,
				keys = reveal_keys,
			},
			{
				kind = 'value',
				interpolation = 'step',
				apply = apply_venom_image,
				keys = {
					{ frame = 0, value = false },
					{ frame = venom_image_start_frame, value = true },
				},
			},
			{
				kind = 'value',
				interpolation = 'step',
				path = { 'curtain_start' },
				keys = curtain_start_keys,
			},
			{
				kind = 'value',
				interpolation = 'step',
				path = { 'curtain_end' },
				keys = curtain_end_keys,
			},
			{
				kind = 'value',
				interpolation = 'step',
				apply = apply_secondary_reveal,
				keys = build_secondary_reveal_keys(),
			},
			{
				kind = 'value',
				interpolation = 'step',
				path = { 'curtain_count' },
				keys = build_curtain_count_keys(venom_slide_out_start_frame, venom_slide_out_offsets),
			},
			{
				kind = 'value',
				interpolation = 'step',
				apply = apply_curtain_mode,
				keys = {
					{ frame = 0, value = curtain_none },
					{ frame = venom_image_start_frame, value = curtain_venom },
					{ frame = venom_curtain_clear_frame, value = curtain_none },
					{ frame = venom_slide_out_start_frame, value = curtain_slide },
				},
			},
		},
	}
end

function story:begin_slide(state)
	local slide<const> = story_slides[state.data.slide_index]
	local primary_text<const> = self.primary_text
	primary_text:set_static_text(slide.text, slide.line_count)
	primary_text.offset_y = slide.text_y
	primary_text:set_glyph_visible_height(0)
	local secondary_text<const> = self.secondary_text
	secondary_text.visible = state.data.slide_index == 6
	secondary_text:set_glyph_visible_height(0)
	self:set_curtain_mode(curtain_none)
	self.curtain_count = 0
	self.visible = true
	self:set_imgid(slide.imgid)
	if slide.imgid ~= nil then
		gx_texture.upload(slide.imgid)
	end
end

local finish_story<const> = function(self)
	self.visible = false
	self.events:emit('story_done')
	return '/hidden'
end

function story:ctor()
	local primary_text<const> = text_component.new({
		id_local = 'primary_text',
		offset_z = 1,
	})
	primary_text:set_font(font.get(nemesis_font.font_id))
	self:add_component(primary_text)
	self.primary_text = primary_text

	local secondary_text<const> = text_component.new({
		id_local = 'secondary_text',
		offset_y = 136,
		offset_z = 2,
	})
	secondary_text:set_font(font.get(nemesis_font.font_id))
	secondary_text:set_static_text(game_text.story_piet_text, 5)
	secondary_text:set_glyph_visible_height(0)
	secondary_text.visible = false
	self:add_component(secondary_text)
	self.secondary_text = secondary_text

	local curtain<const> = custom_visual_component.new({
		id_local = 'curtain',
		offset_z = 3,
	})
	self:add_component(curtain)
	self.curtain = curtain
end

local build_slide_states<const> = function()
	local states<const> = {}
	for slide_index = 1, #story_slides do
		local slide<const> = story_slides[slide_index]
		local timeline_id<const> = 'nemesis_s.story.slide.' .. tostring(slide_index)
		local on_finished
		if slide_index == #story_slides then
			on_finished = finish_story
		else
			on_finished = '/playing/slide_' .. tostring(slide_index + 1)
		end
		states['slide_' .. tostring(slide_index)] = {
			data = { slide_index = slide_index },
			entering_state = story.begin_slide,
			timelines = {
				[timeline_id] = {
					def = slide_index == 6 and build_venom_timeline() or build_normal_timeline(slide),
					autoplay = true,
					stop_on_exit = true,
					play_options = {
						rewind = true,
						snap_to_start = true,
					},
					on_finished = on_finished,
				},
			},
		}
	end
	return states
end

local define_fsm<const> = function()
	fsm_library.register(story_fsm_id, {
		initial = 'hidden',
		on = {
			['story'] = {
				emitter = ids_director_instance,
				go = '/playing',
			},
		},
		states = {
			hidden = {},
			playing = {
				initial = 'slide_1',
				entering_state = function()
					gx_texture.upload('font_a')
				end,
				input_event_handlers = {
					{ pattern = 'confirm[jp]', go = finish_story },
				},
				states = build_slide_states(),
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = story_definition_id,
		class = story,
		base = sprite_object,
		components = {
			timeline_component.new,
			fsm_component.factory({ story_fsm_id }),
		},
		defaults = {
			id = story_instance_id,
			player_index = 1,
			curtain_count = 0,
			curtain_start = 126,
			curtain_end = 110,
		},
	})
end

return {
	definition_id = story_definition_id,
	instance_id = story_instance_id,
	define_fsm = define_fsm,
	register_definition = register_definition,
}
