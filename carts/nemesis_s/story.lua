local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local atlas<const> = require('cartlib/gx/atlas')
local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/world/prefab')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
require('constants')

local scene_library<const> = require('cartlib/world/scene_library')
local story_scene<const> = require('scenes/story')

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
local story_slides<const> = story_scene.panels
local slide_durations<const> = { 1257, 538, 480, 419, 367, 1014, 2101, 1202, 839 }

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

local apply_primary_reveal<const> = function(target, height)
	target.presentation.members.primary_caption.text_component:set_glyph_visible_height(height)
end

local apply_secondary_reveal<const> = function(target, height)
	target.presentation.members.secondary_caption.text_component:set_glyph_visible_height(height)
end

local apply_curtain_mode<const> = function(target, mode)
	target.presentation.members.curtain:set_mode(mode)
end

local apply_venom_image<const> = function(target, visible)
	if visible then
		atlas.load(image.atlas_id(story_scene.portrait_imgid))
		target.presentation.members.picture:set_imgid(story_scene.portrait_imgid)
	else
		target.presentation.members.picture:set_imgid(nil)
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

local build_normal_timeline<const> = function(duration_frames)
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
				path = { 'presentation', 'members', 'curtain', 'count' },
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

local venom_duration_frames<const> = slide_durations[6]
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
				path = { 'presentation', 'members', 'curtain', 'opening_start' },
				keys = curtain_start_keys,
			},
			{
				kind = 'value',
				interpolation = 'step',
				path = { 'presentation', 'members', 'curtain', 'opening_end' },
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
				path = { 'presentation', 'members', 'curtain', 'count' },
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
	local imgid<const> = slide.imgid
	if imgid ~= nil then
		atlas.load(image.atlas_id(imgid))
	end
	local primary_text<const> = self.presentation.members.primary_caption.text_component
	primary_text:set_text(slide.text)
	primary_text.offset_y = slide.text_y
	primary_text:set_glyph_visible_height(0)
	local secondary_text<const> = self.presentation.members.secondary_caption.text_component
	secondary_text.visible = state.data.slide_index == 6
	secondary_text:set_glyph_visible_height(0)
	self.presentation.members.curtain:set_mode(curtain_none)
	self.presentation.members.curtain.count = 0
	self.presentation.members.picture:set_imgid(slide.imgid)
end

local finish_story<const> = function(self)
	self.events:emit('story_done')
	return '/hidden'
end

function story:begin()
	atlas.load('font')
	self.presentation = scene_library.instantiate(story_scene.id)
end

function story:release_presentation()
	if self.presentation then
		self.presentation:dispose()
		self.presentation = nil
	end
end

story.ondespawn = story.release_presentation

local build_slide_states<const> = function()
	local states<const> = {}
	for slide_index = 1, #story_slides do
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
					def = slide_index == 6 and build_venom_timeline() or build_normal_timeline(slide_durations[slide_index]),
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
				entering_state = story.begin,
				exiting_state = story.release_presentation,
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
		components = {
			timeline_component.new,
			fsm_component.factory({ story_fsm_id }),
		},
		defaults = {
			player_index = 1,
		},
	})
end

return {
	definition_id = story_definition_id,
	instance_id = story_instance_id,
	define_fsm = define_fsm,
	register_definition = register_definition,
}
