local constants = require('constants.lua')
local room_module = require('room.lua')

local castle_service = {}

function castle_service:initialize(initial_room_id_or_number)
	self.current_room = room_module.create_room(initial_room_id_or_number)
	self.current_room_id = self.current_room.room_id
	self.current_room_number = self.current_room.room_number
	self.last_room_switch = nil
	return self.current_room
end

function castle_service:get_current_room()
	return self.current_room
end

function castle_service:can_cross_edge(direction, player_top, player_bottom)
	local gate = self.current_room.edge_gates[direction]
	if gate == nil then
		return true
	end
	if player_bottom < gate.y_min or player_top > gate.y_max then
		return false
	end
	return true
end

function castle_service:switch_room(direction, player_top, player_bottom)
	if not self:can_cross_edge(direction, player_top, player_bottom) then
		return nil
	end

	local switch = room_module.switch_room(self.current_room, direction)
	if switch == nil then
		return nil
	end

	self.current_room_id = self.current_room.room_id
	self.current_room_number = self.current_room.room_number
	self.last_room_switch = switch
	return switch
end

local function register_castle_service_definition()
	define_service({
		def_id = constants.ids.castle_service_def,
		class = castle_service,
		defaults = {
			id = constants.ids.castle_service_instance,
			current_room = nil,
			current_room_id = '',
			current_room_number = 0,
			last_room_switch = nil,
			registrypersistent = false,
			tick_enabled = false,
		},
	})
end

return {
	castle_service = castle_service,
	register_castle_service_definition = register_castle_service_definition,
	castle_service_def_id = constants.ids.castle_service_def,
	castle_service_instance_id = constants.ids.castle_service_instance,
}
