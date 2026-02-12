local constants = require('constants.lua')
local room_module = require('room.lua')
local castle_map = require('castle_map.lua')

local castle_service = {}

local function clone_switch(detail)
	local copied = {}
	for key, value in pairs(detail) do
		copied[key] = value
	end
	return copied
end

function castle_service:sync_world_entrance_states_for_room(room_state)
	local world_entrances = room_state.world_entrances
	for i = 1, #world_entrances do
		local target = world_entrances[i].target
		local entrance_state = self.world_entrance_states[target]
		if entrance_state == nil then
			self.world_entrance_states[target] = {
				state = 'closed',
				elapsed_ms = 0,
			}
		end
	end
end

function castle_service:initialize(initial_room_id_or_number)
	self.current_room = room_module.create_room(initial_room_id_or_number)
	self.current_room_id = self.current_room.room_id
	self.current_room_number = self.current_room.room_number
	self.map_id = self.current_room.world_number
	self.map_x = 5
	self.map_y = 12
	self.last_room_switch = nil
	self.world_entrance_states = {}
	self:sync_world_entrance_states_for_room(self.current_room)
	return self.current_room
end

function castle_service:begin_open_world_entrance(target)
	local entrance_state = self.world_entrance_states[target]
	if entrance_state.state ~= 'closed' then
		return
	end
	entrance_state.state = 'opening_1'
	entrance_state.elapsed_ms = 0
end

function castle_service:tick(dt_ms)
	for _, entrance_state in pairs(self.world_entrance_states) do
		if entrance_state.state == 'opening_1' or entrance_state.state == 'opening_2' then
			entrance_state.elapsed_ms = entrance_state.elapsed_ms + dt_ms
			while entrance_state.elapsed_ms >= constants.world_entrance.open_step_ms do
				entrance_state.elapsed_ms = entrance_state.elapsed_ms - constants.world_entrance.open_step_ms
				if entrance_state.state == 'opening_1' then
					entrance_state.state = 'opening_2'
				else
					entrance_state.state = 'open'
					entrance_state.elapsed_ms = 0
					break
				end
			end
		end
	end
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

	if switch.outside == true then
		self.last_room_switch = switch
		return clone_switch(switch)
	end

	self.current_room_id = self.current_room.room_id
	self.current_room_number = self.current_room.room_number
	self.map_id = self.current_room.world_number
	if direction == 'left' then
		self.map_x = self.map_x - 1
	elseif direction == 'right' then
		self.map_x = self.map_x + 1
	elseif direction == 'up' then
		self.map_y = self.map_y - 1
	else
		self.map_y = self.map_y + 1
	end
	self.last_room_switch = switch
	self:sync_world_entrance_states_for_room(self.current_room)
	return clone_switch(switch)
end

function castle_service:enter_world(target)
	local transition = castle_map.world_transition(target)
	if transition == nil then
		error('pietious castle_service missing world transition for target=' .. tostring(target))
	end

	local from_room_number = self.current_room_number
	local from_room_id = self.current_room_id

	self.current_room = room_module.create_room(transition.world_room_number)
	self.current_room_id = self.current_room.room_id
	self.current_room_number = self.current_room.room_number
	self.map_id = transition.world_number
	self.map_x = transition.world_map_x
	self.map_y = transition.world_map_y
	self.last_room_switch = {
		from_room_number = from_room_number,
		from_room_id = from_room_id,
		to_room_number = self.current_room_number,
		to_room_id = self.current_room_id,
		direction = 'down',
		transition_kind = 'world_banner',
	}
	self:sync_world_entrance_states_for_room(self.current_room)

	return {
		from_room_number = from_room_number,
		from_room_id = from_room_id,
		to_room_number = self.current_room_number,
		to_room_id = self.current_room_id,
		direction = 'down',
		transition_kind = 'world_banner',
		world_number = transition.world_number,
		spawn_x = transition.world_spawn_x,
		spawn_y = transition.world_spawn_y,
		spawn_facing = transition.world_spawn_facing,
	}
end

function castle_service:leave_world_to_castle()
	local world_number = self.current_room.world_number
	if world_number <= 0 then
		error('pietious castle_service leave_world_to_castle called outside world')
	end

	local transition = castle_map.world_transition_from_world_number(world_number)
	if transition == nil then
		error('pietious castle_service missing world transition for world=' .. tostring(world_number))
	end

	local from_room_number = self.current_room_number
	local from_room_id = self.current_room_id

	self.current_room = room_module.create_room(transition.castle_room_number)
	self.current_room_id = self.current_room.room_id
	self.current_room_number = self.current_room.room_number
	self.map_id = 0
	self.map_x = transition.castle_map_x
	self.map_y = transition.castle_map_y
	self.last_room_switch = {
		from_room_number = from_room_number,
		from_room_id = from_room_id,
		to_room_number = self.current_room_number,
		to_room_id = self.current_room_id,
		direction = 'right',
		transition_kind = 'castle_banner',
	}
	self:sync_world_entrance_states_for_room(self.current_room)

	return {
		from_room_number = from_room_number,
		from_room_id = from_room_id,
		to_room_number = self.current_room_number,
		to_room_id = self.current_room_id,
		direction = 'right',
		transition_kind = 'castle_banner',
		spawn_x = transition.castle_spawn_x,
		spawn_y = transition.castle_spawn_y,
		spawn_facing = transition.castle_spawn_facing,
	}
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
			map_id = 0,
			map_x = 5,
			map_y = 12,
			last_room_switch = nil,
			world_entrance_states = {},
			registrypersistent = false,
			tick_enabled = true,
		},
	})
end

return {
	castle_service = castle_service,
	register_castle_service_definition = register_castle_service_definition,
	castle_service_def_id = constants.ids.castle_service_def,
	castle_service_instance_id = constants.ids.castle_service_instance,
}
