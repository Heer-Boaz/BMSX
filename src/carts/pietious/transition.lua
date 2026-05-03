-- transition.lua
-- transition overlay — renders the fade mask and optional banner text.
--
-- CROSS-CUTTING SUBSCRIBER PATTERN:
-- Subscribes to director broadcasts via FSM root `on`:
--   'transition'       (from 'd') — stores optional banner_lines from payload
--     and plays the fade mask timeline.
--   transition-mode broadcasts ('halo', 'title', 'story', 'ending',
--     'victory_dance', 'death') — also play the fade mask timeline. The mode
--     broadcast itself is the canonical signal; no second relay event exists.
--   'room'             (from 'd') — clears banner_lines (self-clear).
--
-- The banner text is only shown when the director tag 'd.bt' is active
-- (set by the banner_transition state).  draw_transition_overlay() checks
-- this tag before rendering, so the transition overlay can exist and play
-- its mask timeline without showing any text.

local constants<const> = require('constants')
local font_module<const> = require('bios/font')

local draw_glyph_line_color<const> = function(font, line, x, y, z, layer, color)
	local cursor_x = x
	font_module.for_each_glyph(font, line, function(glyph)
		vdp_glyph_color(glyph, cursor_x, y, z, layer, color)
		cursor_x = cursor_x + glyph.advance
	end)
end

local transition<const> = {}
transition.__index = transition

local transition_mode_events<const> = {
	'halo',
	'title',
	'story',
	'ending',
	'victory_dance',
	'death',
}

function transition:bind_visual()
	local rc<const> = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_transition_overlay()
	end
end

function transition:draw_transition_overlay()
	vdp_fill_rect_color(0, 0, machine_manifest.render_size.width, machine_manifest.render_size.height, 340, sys_vdp_layer_ui, 0xff000000)
	if not oget('d'):has_tag('d.bt') then
		return
	end
	local lines<const> = self.banner_lines
	if #lines > 0 then
		local banner_font<const> = self.banner_font
		local base_y<const> = constants.room.tile_origin_y + (constants.room.tile_size * 9)
		local screen_width<const> = machine_manifest.render_size.width
		for i = 1, #lines do
			local line<const> = lines[i]
			if string.len(line) > 0 then
				draw_glyph_line_color(banner_font, line, (screen_width - font_module.measure_line_width(banner_font, line)) // 2, base_y + ((i - 1) * banner_font.line_height), 341, sys_vdp_layer_ui, 0xffffffff)
			end
		end
	end
end

function transition:ctor()
	self.banner_font = font_module.get('pietious')
	self.banner_lines = {}
	self:bind_visual()
	self:define_timeline(timeline.new({
		id = 'transition.timeline',
		frames = timeline.range(constants.flow.room_transition_frames),
		playback_mode = 'once',
	}))
end

local define_transition_fsm<const> = function()
	local on<const> = {
		['transition'] = {
			emitter = 'd',
			go = function(self, _state, event)
				self.banner_lines = event and event.lines or {}
				self:play_timeline('transition.timeline', { rewind = true, snap_to_start = true })
			end,
		},
		['room'] = {
			emitter = 'd',
			go = function(self)
				self.banner_lines = {}
			end,
		},
	}
	for i = 1, #transition_mode_events do
		local event_name<const> = transition_mode_events[i]
		on[event_name] = {
			emitter = 'd',
			go = function(self)
				self.banner_lines = {}
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
