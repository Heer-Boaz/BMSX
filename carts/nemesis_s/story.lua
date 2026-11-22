local assets<const> = require('bmsx/assets')
local world_object<const> = require('cartlib/world/world_object')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local atlas<const> = require('cartlib/gx/atlas')
local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/world/prefab')
local packed_steps<const> = require('cartlib/timeline/packed_steps')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
require('constants')

local scene_library<const> = require('cartlib/world/scene_library')
local story_scene<const> = require('scenes/story')

local story<const> = {}
story.__index = story
setmetatable(story, { __index = world_object })

local story_definition_id<const> = 'nemesis_s.story'
local story_instance_id<const> = 'nemesis_s.story'
local story_fsm_id<const> = 'nemesis_s.story.fsm'
local story_slides<const> = story_scene.panels
local curtain_none<const> = 0

local apply_primary_reveal<const> = function(target, height)
	target.presentation.members.primary_caption.text_component:set_glyph_visible_height(height)
end

local apply_secondary_reveal<const> = function(target, height)
	target.presentation.members.secondary_caption.text_component:set_glyph_visible_height(height)
end

local apply_curtain_mode<const> = function(target, mode)
	target.presentation.members.curtain.visual:set_mode(mode)
end

local apply_venom_image<const> = function(target, visible)
	if visible then
		atlas.load(image.atlas_id(story_scene.portrait_imgid))
		target.presentation.members.picture.sprite_component:set_imgid(story_scene.portrait_imgid)
	else
		target.presentation.members.picture.sprite_component:set_imgid(nil)
	end
end

local normal_tracks<const> = {
	{ kind = 'value', interpolation = 'step', apply = apply_primary_reveal },
	{ kind = 'value', interpolation = 'step', path = { 'presentation', 'members', 'curtain', 'visual', 'count' } },
	{ kind = 'value', interpolation = 'step', apply = apply_curtain_mode },
}
local venom_tracks<const> = {
	normal_tracks[1],
	{ kind = 'value', interpolation = 'step', apply = apply_venom_image, boolean = true },
	{ kind = 'value', interpolation = 'step', path = { 'presentation', 'members', 'curtain', 'visual', 'opening_start' } },
	{ kind = 'value', interpolation = 'step', path = { 'presentation', 'members', 'curtain', 'visual', 'opening_end' } },
	{ kind = 'value', interpolation = 'step', apply = apply_secondary_reveal },
	normal_tracks[2], normal_tracks[3],
}

function story:begin_slide(state)
	local slide<const> = story_slides[state.data.slide_index]
	local imgid<const> = slide.imgid
	if imgid ~= nil then
		atlas.load(image.atlas_id(imgid))
	end
	local primary_text<const> = self.presentation.members.primary_caption.text_component
	primary_text:set_text(slide.text)
	primary_text:set_presentation_origin(0, slide.text_y)
	primary_text:set_glyph_visible_height(0)
	local secondary_text<const> = self.presentation.members.secondary_caption.text_component
	secondary_text.visible = state.data.slide_index == 6
	secondary_text:set_glyph_visible_height(0)
	self.presentation.members.curtain.visual:set_mode(curtain_none)
	self.presentation.members.curtain.visual.count = 0
	self.presentation.members.picture.sprite_component:set_imgid(slide.imgid)
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
		local clip<const>, length<const> = packed_steps.clip(assets.bin_nemesis_s_presentation_steps_addr, slide_index - 1)
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
					def = {
						phase = 'presentation',
						frames = timeline.range(length),
						clock_source = timeline_clock_source.frame,
						packed_frame_steps = clip,
						tracks = slide_index == 6 and venom_tracks or normal_tracks,
					},
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
