local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local font<const> = require('cartlib/font')
local prefab<const> = require('cartlib/world/prefab')
local text_component<const> = require('cartlib/text/text_component')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local game_text<const> = require('game_text')
require('constants')

local narrative_screen<const> = {}
narrative_screen.__index = narrative_screen

local story_timeline_id<const> = 'narrative.story'
local epilogue_timeline_id<const> = 'narrative.epilogue'
local narrative_line_height<const> = 8

local build_scroll_timeline<const> = function(line_count, reached_end_event)
	local text_height<const> = line_count * narrative_line_height
	local distance<const> = screen_height + text_height
	-- XNA completes only after the text bottom has crossed y=0. This is the
	-- first fixed update strictly beyond that boundary, retaining the authored
	-- 10 px/s scroll without a threshold poll in the playback path.
	local end_frame<const> = (distance * flow_narrative_scroll_pixels_den)
		// flow_narrative_scroll_pixels_num + 1
	local end_y<const> = screen_height
		- end_frame * flow_narrative_scroll_pixels_num / flow_narrative_scroll_pixels_den
	return {
		frames = timeline.range(end_frame + 1),
		playback_mode = 'once',
		clock_source = timeline_clock_source.frame,
		tracks = {
			{
				kind = 'value',
				interpolation = 'linear',
				path = { 'text_component', 'offset_y' },
				keys = {
					{ frame = 0, value = screen_height },
					{ frame = end_frame, value = end_y },
				},
			},
			{
				kind = 'event',
				keys = {
					{ frame = end_frame, event = reached_end_event, direction = 'forward' },
				},
			},
		},
	}
end

local request_story_finish<const> = function(self)
	self.events:emit('story_finish')
	return '/story/requested'
end

local request_epilogue_finish<const> = function(self)
	self.events:emit('epilogue_finish')
	return '/epilogue/requested'
end

function narrative_screen:ctor()
	local text<const> = self:get_component(text_component)
	text:set_font(font.get('pietious'))
	text.color = 0xffffffff
	self.text_component = text
end

local define_narrative_screen_fsm<const> = function()
	fsm_library.register('narrative_screen', {
		initial = 'hidden',
		on = {
			['story'] = {
				emitter = 'd',
				go = '/story',
			},
			['epilogue'] = {
				emitter = 'd',
				go = '/epilogue',
			},
			['title'] = {
				emitter = 'd',
				go = '/hidden',
			},
		},
		states = {
			hidden = {},
			story = {
				initial = 'active',
				entering_state = function(self)
					local text<const> = self.text_component
					text:set_static_text(game_text.story_text, #game_text.story_text)
					text.visible = true
				end,
				timelines = {
					[story_timeline_id] = {
						def = build_scroll_timeline(
							#game_text.story_text,
							'narrative.story.reached_end'
						),
						autoplay = true,
						stop_on_exit = true,
					},
				},
				states = {
					active = {
						on = {
							['narrative.story.reached_end'] = request_story_finish,
						},
						input_event_handlers = {
							{ pattern = 'confirm[jp]', go = request_story_finish },
						},
					},
					requested = {},
				},
			},
			epilogue = {
				initial = 'active',
				entering_state = function(self)
					local text<const> = self.text_component
					text:set_static_text(game_text.epilogue_text, #game_text.epilogue_text)
					text.visible = true
				end,
				timelines = {
					[epilogue_timeline_id] = {
						def = build_scroll_timeline(
							#game_text.epilogue_text,
							'narrative.epilogue.reached_end'
						),
						autoplay = true,
						stop_on_exit = true,
					},
				},
				states = {
					active = {
						on = {
							['narrative.epilogue.reached_end'] = request_epilogue_finish,
						},
						input_event_handlers = {
							{ pattern = 'confirm[jp]', go = request_epilogue_finish },
						},
					},
					requested = {},
				},
			},
		},
	})
end

local register_narrative_screen_definition<const> = function()
	prefab.define({
		def_id = 'narrative_screen',
		class = narrative_screen,
		components = {
			text_component.new,
			timeline_component.new,
			fsm_component.factory({ 'narrative_screen' }),
		},
		defaults = {
			id = 'narrative',
			player_index = 1,
		},
	})
end

return {
	define_narrative_screen_fsm = define_narrative_screen_fsm,
	register_narrative_screen_definition = register_narrative_screen_definition,
}
