-- transition.lua
-- transition overlay — renders the fade mask and optional banner text.
--
-- CROSS-CUTTING SUBSCRIBER PATTERN:
-- Subscribes to director broadcasts via FSM root `on`:
--   'transition'       (from 'd') — rebuilds the retained banner text from
--     the direct lines payload and plays the fade mask timeline. A transition
--     without banner text carries nil.
--   transition-mode broadcasts ('halo', 'title', 'story', 'ending',
--     'victory_dance') — also play the fade mask timeline. The mode
--     broadcast itself is the canonical signal; no second relay event exists.
--   'death_screen' — shows the retained game-over text on the already closed
--     curtain without starting a second fade.
--   'room'             (from 'd') — clears and hides retained banner text.
--
-- Banner visibility follows those mode events directly. The retained text
-- component is enabled by 'transition' and cleared/hidden by every other
-- transition mode, so presentation performs no director-state polling.

local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local text_component<const> = require('cartlib/text/text_component')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
require('constants')
local font_module<const> = require('cartlib/font')
local game_text_module<const> = require('game_text')
local game_text<const>: *game_text_record = game_text_module.game_text

local transition<const> = {}
transition.__index = transition
local banner_text_y<const> = room_tile_origin_y + (room_tile_size * 9)
local death_screen_text_y<const> = room_tile_size * 10

local draw_transition_visual<const> = function(_, draw)
	draw:rect(0, 0, screen_width, screen_height, 0xff000000)
end

local transition_mode_events<const> = {
	'halo',
	'title',
	'story',
	'ending',
	'victory_dance',
}

function transition:ctor()
	local text<const> = self:get_component(text_component)
	text:set_font(font_module.get('pietious'))
	text.color = 0xffffffff
	text.offset_y = banner_text_y
	text:set_offset_z(1)
	text.visible = false
	text.center_block_width = screen_width
	self.text_component = text
	self:get_component(custom_visual_component):set_draw_function(draw_transition_visual)
	self.timelines:define('transition.timeline', {
		frames = timeline.range(flow_room_transition_frames),
		playback_mode = 'once',
	})
end

local define_transition_fsm<const> = function()
	local on<const> = {
		['transition'] = {
			emitter = 'd',
			go = function(self, _state, lines)
				self.text_component.offset_y = banner_text_y
				self.text_component:set_text(lines)
				self.text_component.visible = lines ~= nil
				self.timelines:play('transition.timeline', { rewind = true, snap_to_start = true })
			end,
		},
		['room'] = {
			emitter = 'd',
			go = function(self)
				self.text_component:set_text(nil)
				self.text_component.visible = false
			end,
		},
		['death_screen'] = {
			emitter = 'd',
			go = function(self)
				self.text_component.offset_y = death_screen_text_y
				self.text_component:set_text(game_text[0].death_screen)
				self.text_component.visible = true
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
				self.timelines:play('transition.timeline', { rewind = true, snap_to_start = true })
			end,
		}
	end
	fsm_library.register('transition', {
		initial = 'active',
		on = on,
		states = {
			active = {},
		},
	})
end

local register_transition_definition<const> = function()
	prefab.define({
		def_id = 'transition',
		class = transition,
		components = {
			custom_visual_component.new,
			text_component.new,
			timeline_component.new,
			fsm_component.factory({ 'transition' }),
		},
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
