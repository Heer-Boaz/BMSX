local constants = require('constants.lua')
local engine = require('engine')
local eventemitter = require('eventemitter')

local flow_service = {}
flow_service.__index = flow_service

local flow_service_fsm_id = constants.ids.flow_service_fsm

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
			engine.object(constants.ids.ui_instance).space_id = constants.spaces.transition
		end,
	})
end

function flow_service:item_screen_toggle_pressed()
	local player_index = self.player_index
	return action_triggered('lb[jp]', player_index) or action_triggered('rb[jp]', player_index)
end

function flow_service:resolve_room_space()
	local castle_service = engine.service(constants.ids.castle_service_instance)
	local room = castle_service:get_current_room()
	return room.space_id
end

function flow_service:activate_spaces()
	engine.add_space(constants.spaces.castle)
	engine.add_space(constants.spaces.world)
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
							self.pending_room_transition = false
							self.transition_frames_left = 0
								self:activate_spaces()
								self:bind_events()
								engine.set_space(self:resolve_room_space())
								engine.object(constants.ids.ui_instance).space_id = self:resolve_room_space()
								self:emit_state_changed(engine.get_space())
								return '/castle'
							end,
					},
						castle = {
							entering_state = function(self)
								local room_space = self:resolve_room_space()
								engine.set_space(room_space)
								engine.object(constants.ids.ui_instance).space_id = room_space
								self:emit_state_changed(engine.get_space())
							end,
					tick = function(self)
						if self.pending_room_transition then
							self.pending_room_transition = false
							return '/room_transition'
						end
						if self:item_screen_toggle_pressed() then
							return '/item_screen'
						end
					end,
				},
						room_transition = {
							entering_state = function(self)
								self.transition_frames_left = constants.flow.room_transition_frames
								engine.set_space(constants.spaces.transition)
								engine.object(constants.ids.ui_instance).space_id = constants.spaces.transition
								self:emit_state_changed('transition')
							end,
					tick = function(self)
						self.transition_frames_left = self.transition_frames_left - 1
						if self.transition_frames_left <= 0 then
							return '/castle'
						end
					end,
				},
						item_screen = {
							entering_state = function(self)
								engine.set_space(constants.spaces.item)
								engine.object(constants.ids.ui_instance).space_id = constants.spaces.item
								self:emit_state_changed('item')
							end,
					tick = function(self)
						if self.pending_room_transition then
							self.pending_room_transition = false
							return '/room_transition'
						end
						if self:item_screen_toggle_pressed() then
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
