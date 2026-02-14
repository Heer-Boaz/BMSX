local constants = require('constants')
local eventemitter = require('eventemitter')
local shrine_world_view_module = require('shrine_world_view')

local flow_service = {}
flow_service.__index = flow_service

function flow_service:emit_state_changed(state_name)
	local space = get_space()
	eventemitter.eventemitter.instance:emit('flow.state_changed', self.id, {
		state = state_name,
		space = space,
	})
end

function flow_service:queue_banner_transition(mode, world_number, post_action)
	self.pending_banner_mode = mode
	self.pending_banner_world_number = world_number
	self.pending_banner_post_action = post_action
end

function flow_service:open_shrine(text_lines)
	self.pending_shrine_open = true
	self.pending_shrine_close = false
	self.pending_shrine_text_lines = text_lines
end

function flow_service:close_shrine()
	self.pending_shrine_close = true
	self.pending_shrine_open = false
end

function flow_service:has_modal_overlay()
	if self.overlay_mode == 'none' then
		return false
	end
	return true
end

function flow_service:bind_events()
	eventemitter.eventemitter.instance:on({
		event = 'room.switched',
		subscriber = self,
		handler = function(event)
			if event.transition_kind == 'world_banner' then
				self:queue_banner_transition('world_banner', event.world_number, '')
				return
			end
			if event.transition_kind == 'castle_banner' then
				self:queue_banner_transition('castle_banner', 0, event.post_action)
				return
			end
		end,
	})
end

function flow_service:item_screen_toggle_pressed()
	local player_index = self.player_index
	return action_triggered('lb[jp]', player_index) or action_triggered('rb[jp]', player_index)
end

function flow_service:resolve_room_space()
	local castle_service = service('c')
	local room = castle_service.current_room
	return room.space_id
end

function flow_service:activate_spaces()
	add_space('castle')
	add_space('world')
	add_space('transition')
	add_space('item')
	add_space('ui')
end

function flow_service:spawn_interaction_view_if_needed()
	if object('shrine_world_view') ~= nil then
		return
	end
	inst('shrine_world_view.def', {
		id = 'shrine_world_view',
		space_id = 'ui',
		pos = { x = 0, y = 0, z = 0 },
	})
end

function flow_service:banner_lines()
	if self.pending_banner_mode == 'world_banner' then
		return {
			'WORLD ' .. tostring(self.pending_banner_world_number) .. ' !',
		}
	end
	return {
		'CASTLE !',
	}
end

function flow_service:ctor()
	self.pending_banner_mode = ''
	self.pending_banner_world_number = 0
	self.pending_banner_post_action = ''
	self.pending_shrine_open = false
	self.pending_shrine_close = false
	self.pending_shrine_text_lines = {}
	self.overlay_mode = 'none'
	self.overlay_text_lines = {}
	self.transition_frames_left = 0
	self.banner_post_action = ''
	self:activate_spaces()
	self:bind_events()
	self:spawn_interaction_view_if_needed()
end

local function define_flow_service_fsm()
	define_fsm('flow_service.fsm', {
		initial = 'castle',
		states = {
			castle = {
				entering_state = function(self)
					local room_space = self:resolve_room_space()
					set_space(room_space)
					object('ui').space_id = room_space
					object('shrine_world_view').space_id = room_space
					self:emit_state_changed(get_space())
				end,
				tick = function(self)
					if self.pending_shrine_open then
						self.pending_shrine_open = false
						return '/shrine_overlay'
					end
					if self.pending_banner_mode ~= '' then
						return '/banner_transition'
					end
					if self:item_screen_toggle_pressed() then
						return '/item_screen'
					end
				end,
			},
			banner_transition = {
				entering_state = function(self)
					self.overlay_mode = self.pending_banner_mode
					self.overlay_text_lines = self:banner_lines()
					self.banner_post_action = self.pending_banner_post_action
					if self.overlay_mode == 'world_banner' then
						self.transition_frames_left = constants.flow.world_banner_frames
					else
						self.transition_frames_left = constants.flow.castle_banner_frames
					end
					self.pending_banner_mode = ''
					self.pending_banner_world_number = 0
					self.pending_banner_post_action = ''
					set_space('transition')
					object('ui').space_id = 'transition'
					object('shrine_world_view').space_id = 'transition'
					self:emit_state_changed('transition')
				end,
				tick = function(self)
					self.transition_frames_left = self.transition_frames_left - 1
					if self.transition_frames_left <= 0 then
						self.overlay_mode = 'none'
						self.overlay_text_lines = {}
						if self.banner_post_action == 'castle_emerge' then
							object('pietolon'):begin_world_emerge_from_door()
						end
						self.banner_post_action = ''
						return '/castle'
					end
				end,
			},
			shrine_overlay = {
				entering_state = function(self)
					self.overlay_mode = 'shrine'
					self.overlay_text_lines = self.pending_shrine_text_lines
					self.pending_shrine_text_lines = {}
					self.pending_shrine_close = false
					set_space('transition')
					object('ui').space_id = 'transition'
					object('shrine_world_view').space_id = 'transition'
					self:emit_state_changed('transition')
				end,
				tick = function(self)
					if action_triggered('down[jp]', self.player_index) then
						self:close_shrine()
					end
					if self.pending_shrine_close then
						self.pending_shrine_close = false
						self.overlay_mode = 'none'
						self.overlay_text_lines = {}
						object('pietolon'):leave_shrine_overlay()
						return '/castle'
					end
				end,
			},
			item_screen = {
				entering_state = function(self)
					set_space('item')
					object('ui').space_id = 'item'
					object('shrine_world_view').space_id = 'item'
					self:emit_state_changed('item')
				end,
				tick = function(self)
					if self.pending_banner_mode ~= '' then
						return '/banner_transition'
					end
					if self.pending_shrine_open then
						self.pending_shrine_open = false
						return '/shrine_overlay'
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
	shrine_world_view_module.register_shrine_world_view_definition()
	define_service({
		def_id = 'flow_service.def',
		class = flow_service,
		fsms = { 'flow_service.fsm' },
		auto_activate = true,
		defaults = {
			id = 'f',
			space_id = 'ui',
			player_index = 1,
			pending_banner_mode = '',
			pending_banner_world_number = 0,
			pending_banner_post_action = '',
			pending_shrine_open = false,
			pending_shrine_close = false,
			pending_shrine_text_lines = {},
			overlay_mode = 'none',
			overlay_text_lines = {},
			transition_frames_left = 0,
			banner_post_action = '',
			tick_enabled = true,
		},
	})
end

return {
	flow_service = flow_service,
	define_flow_service_fsm = define_flow_service_fsm,
	register_flow_service_definition = register_flow_service_definition,
}
