local constants = require('constants.lua')
local engine = require('engine')
local eventemitter = require('eventemitter')

local transition_view = {}
transition_view.__index = transition_view

local transition_view_fsm_id = constants.ids.transition_view_fsm
local transition_timeline_id = constants.ids.transition_view_def .. '.timeline.mask'
local transition_timeline_frame_event = 'timeline.frame.' .. transition_timeline_id
local room_mask_color = { r = 0, g = 0, b = 0, a = 1 }

function transition_view:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:render_transition()
	end
end

function transition_view:bind_events()
	self.events:on({
		event_name = transition_timeline_frame_event,
		subscriber = self,
		handler = function(event)
			self.frames_in_transition = event.frame_index + 1
		end,
	})

	eventemitter.eventemitter.instance:on({
		event = constants.events.flow_state_changed,
		subscriber = self,
		handler = function(event)
			if event.state ~= 'transition' then
				self.frames_in_transition = 0
				return
			end
			self.frames_in_transition = 0
			self:play_timeline(transition_timeline_id, { rewind = true, snap_to_start = true })
		end,
	})
end

function transition_view:ctor()
	self:bind_visual()
	self:define_timeline(engine.new_timeline({
		id = transition_timeline_id,
		frames = engine.timeline_range(constants.flow.room_transition_frames),
		playback_mode = 'once',
	}))
	self:bind_events()
end

function transition_view:render_transition()
	if engine.get_space() ~= constants.spaces.transition then
		return
	end
	local hud_height = constants.room.hud_height
	put_rectfillcolor(0, hud_height, display_width(), display_height(), 300, room_mask_color)
end

local function define_transition_view_fsm()
	define_fsm(transition_view_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					return '/active'
				end,
			},
			active = {},
		},
	})
end

local function register_transition_view_definition()
	define_world_object({
		def_id = constants.ids.transition_view_def,
		class = transition_view,
		fsms = { transition_view_fsm_id },
		components = { 'customvisualcomponent' },
		defaults = {
			space_id = constants.spaces.transition,
			frames_in_transition = 0,
			tick_enabled = false,
		},
	})
end

return {
	transition_view = transition_view,
	define_transition_view_fsm = define_transition_view_fsm,
	register_transition_view_definition = register_transition_view_definition,
	transition_view_def_id = constants.ids.transition_view_def,
	transition_view_instance_id = constants.ids.transition_view_instance,
	transition_view_fsm_id = transition_view_fsm_id,
}
