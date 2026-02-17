local constants = require('constants')

local transition = {}
transition.__index = transition

local room_mask_color = { r = 0, g = 0, b = 0, a = 1 }
local glyph_color = { r = 1, g = 1, b = 1, a = 1 }

function transition:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:render_transition()
	end
end

function transition:bind_events()
	self.events:on({
		event_name = 'timeline.frame.' .. 'transition.def' .. '.timeline.mask',
		subscriber = self,
		handler = function(event)
			self.frames_in_transition = event.frame_index + 1
		end,
	})

	self.events:on({
		event = 'director.state_changed',
		emitter = 'd',
		subscriber = self,
		handler = function(event)
			if event.space ~= 'transition' then
				self.frames_in_transition = 0
				return
			end
			self.frames_in_transition = 0
			self:play_timeline('transition.def' .. '.timeline.mask', { rewind = true, snap_to_start = true })
		end,
	})
end

function transition:draw_centered_lines(lines, y, z)
	for i = 1, #lines do
		local line = lines[i]
		local x = math.floor((display_width() - (#line * constants.room.tile_size)) / 2)
		put_glyphs(line, x, y + ((i - 1) * constants.room.tile_size), z, {
			color = glyph_color,
			layer = 'overlay',
		})
	end
end

function transition:draw_transition_overlay()
	local director_service = service('d')
	local mode = director_service.overlay_mode
	if mode == 'none' then
		return
	end
	if mode == 'world_banner' or mode == 'castle_banner' then
		self:draw_centered_lines(director_service.overlay_text_lines, constants.room.tile_origin_y + (constants.room.tile_size * 9), 341)
		return
	end
	if #director_service.overlay_text_lines > 0 then
		self:draw_centered_lines(director_service.overlay_text_lines, constants.room.tile_origin_y + (constants.room.tile_size * 9), 341)
	end
end

function transition:ctor()
	self:bind_visual()
	self:define_timeline(timeline.new({
		id = 'transition.def' .. '.timeline.mask',
		frames = timeline.range(constants.flow.room_transition_frames),
		playback_mode = 'once',
	}))
	self:bind_events()
end

function transition:render_transition()
	if get_space() ~= 'transition' then
		return
	end
	put_rectfillcolor(0, constants.room.hud_height, display_width(), display_height(), 300, room_mask_color)
	self:draw_transition_overlay()
end

local function define_transition_fsm()
	define_fsm('transition.fsm', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_transition_definition()
	define_prefab({
		def_id = 'transition.def',
		class = transition,
		fsms = { 'transition.fsm' },
		components = { 'customvisualcomponent' },
		defaults = {
			id = 'transition',
			space_id = 'transition',
			frames_in_transition = 0,
			tick_enabled = false,
		},
	})
end

return {
	transition = transition,
	define_transition_fsm = define_transition_fsm,
	register_transition_definition = register_transition_definition,
}
