-- transition.lua
-- transition overlay — renders the fade mask and optional banner text.
--
-- CROSS-CUTTING SUBSCRIBER PATTERN:
-- Subscribes to director broadcasts via FSM root `on`:
--   'transition'       (from 'd') — rebuilds the retained banner text from
--     event.lines and plays the fade mask timeline.
--   transition-mode broadcasts ('halo', 'title', 'story', 'ending',
--     'victory_dance', 'death') — also play the fade mask timeline. The mode
--     broadcast itself is the canonical signal; no second relay event exists.
--   'room'             (from 'd') — clears and hides retained banner text.
--
-- Banner visibility follows those mode events directly. The retained text
-- component is enabled by 'transition' and cleared/hidden by every other
-- transition mode, so presentation performs no director-state polling.

require('constants')
local font_module<const> = require('system/font')

local transition<const> = {}
transition.__index = transition

local draw_transition_visual<const> = function()
	gx_fill_rect_color(0, 0, screen_width, screen_height, 0xff000000)
end

local transition_mode_events<const> = {
	'halo',
	'title',
	'story',
	'ending',
	'victory_dance',
	'death',
}

function transition:ctor()
	local text<const> = self:get_component('textcomponent')
	text:set_font(font_module.get('pietious'))
	text.color = 0xffffffff
	text.offset.y = room_tile_origin_y + (room_tile_size * 9)
	text.offset.z = 1
	text.visible = false
	text.center_block_width = screen_width
	self.text_component = text
	self:get_component('customvisualcomponent').producer = draw_transition_visual
	self:define_timeline(timeline.new({
		id = 'transition.timeline',
		frames = timeline.range(flow_room_transition_frames),
		playback_mode = 'once',
	}))
end

local define_transition_fsm<const> = function()
	local on<const> = {
		['transition'] = {
			emitter = 'd',
			go = function(self, _state, event)
				self.text_component:set_text(event.lines)
				self.text_component.visible = true
				self:play_timeline('transition.timeline', { rewind = true, snap_to_start = true })
			end,
		},
		['room'] = {
			emitter = 'd',
			go = function(self)
				self.text_component:set_text(nil)
				self.text_component.visible = false
			end,
		},
	}
	for i = 1, #transition_mode_events do
		local event_name<const> = transition_mode_events[i]
		on[event_name] = {
			emitter = 'd',
			go = function(self)
				self.text_component:set_text(nil)
				self.text_component.visible = false
				self:play_timeline('transition.timeline', { rewind = true, snap_to_start = true })
			end,
		}
	end
	define_fsm('transition', {
		initial = 'active',
		on = on,
		states = {
			active = {},
		},
	})
end

local register_transition_definition<const> = function()
	define_prefab({
		def_id = 'transition',
		class = transition,
		fsms = { 'transition' },
		components = { 'customvisualcomponent', 'textcomponent' },
		defaults = {
			id = 'transition',
		},
	})
end

return {
	transition = transition,
	define_transition_fsm = define_transition_fsm,
	register_transition_definition = register_transition_definition,
}
