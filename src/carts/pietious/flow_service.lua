local constants = require('constants.lua')
local engine = require('engine')
local eventemitter = require('eventemitter')

local flow_service = {}
flow_service.__index = flow_service

local flow_service_fsm_id = constants.ids.flow_service_fsm

function flow_service:emit_flow(name, extra)
	if not constants.telemetry.enabled then
		return
	end
	local frame = self.debug_frame
	if frame == nil then
		frame = -1
	end
	if extra ~= nil and extra ~= '' then
		print(string.format('PIETIOUS_FLOW|f=%d|name=%s|%s', frame, name, extra))
		return
	end
	print(string.format('PIETIOUS_FLOW|f=%d|name=%s', frame, name))
end

function flow_service:emit_state_changed(state_name)
	local space = engine.get_space()
	eventemitter.eventemitter.instance:emit(constants.events.flow_state_changed, self.id, {
		state = state_name,
		space = space,
	})
end

function flow_service:bind_events()
	eventemitter.eventemitter.instance:on({
		event = constants.events.room_switched,
		subscriber = self,
		handler = function(_event)
			self.pending_room_transition = true
			engine.set_space(constants.spaces.transition)
			self:emit_flow('room_switched_event', string.format('space=%s', tostring(engine.get_space())))
		end,
	})
end

function flow_service:item_screen_toggle_pressed()
	local player_index = self.player_index
	return action_triggered('lb[jp]', player_index) or action_triggered('rb[jp]', player_index)
end

function flow_service:activate_spaces()
	engine.add_space(constants.spaces.castle)
	engine.add_space(constants.spaces.transition)
	engine.add_space(constants.spaces.item)
	engine.add_space(constants.spaces.ui)
end

local function define_flow_service_fsm()
	define_fsm(flow_service_fsm_id, {
		initial = 'boot',
		states = {
					boot = {
						entering_state = function(self)
							self.debug_frame = 0
							self.pending_room_transition = false
							self.transition_frames_left = 0
							self:activate_spaces()
							self:bind_events()
							engine.set_space(constants.spaces.castle)
							self:emit_flow('enter_boot', string.format('space=%s', tostring(engine.get_space())))
							self:emit_state_changed('castle')
							return '/castle'
						end,
				},
					castle = {
						entering_state = function(self)
							engine.set_space(constants.spaces.castle)
							self:emit_flow('enter_castle', string.format('space=%s', tostring(engine.get_space())))
							self:emit_state_changed('castle')
						end,
					tick = function(self)
						self.debug_frame = self.debug_frame + 1
						if self.pending_room_transition then
							self.pending_room_transition = false
							self:emit_flow('to_room_transition', string.format('space=%s', tostring(engine.get_space())))
							return '/room_transition'
						end
						if self:item_screen_toggle_pressed() then
							self:emit_flow('to_item_screen', string.format('space=%s', tostring(engine.get_space())))
							return '/item_screen'
						end
					end,
				},
					room_transition = {
						entering_state = function(self)
							self.transition_frames_left = constants.flow.room_transition_frames
							engine.set_space(constants.spaces.transition)
							self:emit_flow('enter_room_transition', string.format('frames=%d|space=%s', self.transition_frames_left, tostring(engine.get_space())))
							self:emit_state_changed('transition')
						end,
					tick = function(self)
						self.debug_frame = self.debug_frame + 1
						self.transition_frames_left = self.transition_frames_left - 1
						self:emit_flow('tick_room_transition', string.format('frames=%d|space=%s', self.transition_frames_left, tostring(engine.get_space())))
						if self.transition_frames_left <= 0 then
							self:emit_flow('to_castle', string.format('space=%s', tostring(engine.get_space())))
							return '/castle'
						end
					end,
				},
				item_screen = {
					entering_state = function(self)
						engine.set_space(constants.spaces.item)
						self:emit_flow('enter_item_screen', string.format('space=%s', tostring(engine.get_space())))
						self:emit_state_changed('item')
					end,
					tick = function(self)
						self.debug_frame = self.debug_frame + 1
						if self.pending_room_transition then
							self.pending_room_transition = false
							self:emit_flow('item_to_room_transition', string.format('space=%s', tostring(engine.get_space())))
							return '/room_transition'
						end
						if self:item_screen_toggle_pressed() then
							self:emit_flow('item_to_castle', string.format('space=%s', tostring(engine.get_space())))
							return '/castle'
						end
					end,
				},
		},
	})
end

local function register_flow_service_definition()
	define_service({
		def_id = constants.ids.flow_service_def,
		class = flow_service,
		fsms = { flow_service_fsm_id },
		auto_activate = true,
		defaults = {
			id = constants.ids.flow_service_instance,
			space_id = constants.spaces.ui,
				player_index = 1,
				pending_room_transition = false,
				transition_frames_left = 0,
				debug_frame = 0,
				registrypersistent = false,
				tick_enabled = true,
			},
		})
end

return {
	flow_service = flow_service,
	define_flow_service_fsm = define_flow_service_fsm,
	register_flow_service_definition = register_flow_service_definition,
	flow_service_def_id = constants.ids.flow_service_def,
	flow_service_instance_id = constants.ids.flow_service_instance,
	flow_service_fsm_id = flow_service_fsm_id,
}
