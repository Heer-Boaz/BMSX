local constants = require('constants')

local transition_view = {}
transition_view.__index = transition_view

local room_mask_color = { r = 0, g = 0, b = 0, a = 1 }

function transition_view:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:render_transition()
	end
end

function transition_view:bind_events()
	self.events:on({
		event_name = 'timeline.frame.' .. 'transition_view.def' .. '.timeline.mask',
		subscriber = self,
		handler = function(event)
			self.frames_in_transition = event.frame_index + 1
		end,
	})

	self.events:on({
		event = 'flow.state_changed',
		emitter = 'f',
		subscriber = self,
		handler = function(event)
			if event.state ~= 'transition' then
				self.frames_in_transition = 0
				return
			end
			self.frames_in_transition = 0
			self:play_timeline('transition_view.def' .. '.timeline.mask', { rewind = true, snap_to_start = true })
		end,
	})
end

function transition_view:ctor()
	self:bind_visual()
	self:define_timeline(timeline.new({
		id = 'transition_view.def' .. '.timeline.mask',
		frames = timeline.range(constants.flow.room_transition_frames),
		playback_mode = 'once',
	}))
	self:bind_events()
end

function transition_view:render_transition()
	if get_space() ~= 'transition' then
		return
	end
	put_rectfillcolor(0, constants.room.hud_height, display_width(), display_height(), 300, room_mask_color)
end

local function define_transition_view_fsm()
	define_fsm('transition_view.fsm', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_transition_view_definition()
	define_prefab({
		def_id = 'transition_view.def',
		class = transition_view,
		fsms = { 'transition_view.fsm' },
		components = { 'customvisualcomponent' },
		defaults = {
			space_id = 'transition',
			frames_in_transition = 0,
			tick_enabled = false,
		},
	})
end

return {
	transition_view = transition_view,
	define_transition_view_fsm = define_transition_view_fsm,
	register_transition_view_definition = register_transition_view_definition,
}
