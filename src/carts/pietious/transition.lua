-- transition.lua
-- transition overlay — renders the fade mask and optional banner text.
--
-- CROSS-CUTTING SUBSCRIBER PATTERN:
-- Subscribes to three director broadcasts via FSM root `on`:
--   'transition'       (from 'd') — stores optional banner_lines from payload.
--   'transition.mask.play' (from 'd') — plays the fade mask timeline.  This
--     event is cross-cutting: the director emits it for ALL mode switches
--     (halo, title, story, death, etc.), not just 'transition'.  The overlay
--     does not need to know which mode is active — it just plays the mask.
--   'room'             (from 'd') — clears banner_lines (self-clear).
--
-- The banner text is only shown when the director tag 'd.bt' is active
-- (set by the banner_transition state).  draw_transition_overlay() checks
-- this tag before rendering, so the transition overlay can exist and play
-- its mask timeline without showing any text.

local constants = require('constants')
local font = require('font')

local transition = {}
transition.__index = transition

function transition:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_transition_overlay()
	end
end

function transition:draw_transition_overlay()
	if not object('d'):has_tag('d.bt') then
		return
	end
	local lines = self.banner_lines
	if #lines > 0 then
		put_glyphs(lines, 0, constants.room.tile_origin_y + (constants.room.tile_size * 9), 341, {
				font = self.banner_font,
				center_block_width = display_width(),
		})
	end
end

function transition:ctor()
	self.banner_font = font.get('pietious')
	self.banner_lines = {}
	self:bind_visual()
	self:define_timeline(timeline.new({
		id = 'transition.timeline',
		frames = timeline.range(constants.flow.room_transition_frames),
		playback_mode = 'once',
	}))
end

local function define_transition_fsm()
	define_fsm('transition', {
		initial = 'active',
		on = {
			['transition'] = {
				emitter = 'd',
				go = function(self, _state, event)
					self.banner_lines = event and event.lines or {}
				end,
			},
			['transition.mask.play'] = {
				emitter = 'd',
				go = function(self)
					self:play_timeline('transition.timeline', { rewind = true, snap_to_start = true })
				end,
			},
			['room'] = {
				emitter = 'd',
				go = function(self)
					self.banner_lines = {}
				end,
			},
		},
		states = {
			active = {},
		},
	})
end

local function register_transition_definition()
	define_prefab({
		def_id = 'transition',
		class = transition,
		fsms = { 'transition' },
		components = { 'customvisualcomponent' },
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
