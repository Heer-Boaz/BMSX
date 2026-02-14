local constants = require('constants')
local room_module = require('room')
local castle_map = require('castle_map')
local eventemitter = require('eventemitter')

local castle_service = {}

local function clone_switch(detail)
	local copied = {}
	for key, value in pairs(detail) do
		copied[key] = value
	end
	return copied
end

local function condition_matches(self, condition, enemy_id)
	if condition == 'not_destroyed' then
		return self.defeated_enemy_ids[enemy_id] ~= true
	end

	local inverted = condition:sub(1, 1) == '!'
	local token = inverted and condition:sub(2) or condition
	local flag_is_set = self.enemy_condition_flags[token] == true
	if inverted then
		return not flag_is_set
	end
	return flag_is_set
end

function castle_service:enemy_should_spawn(enemy_def)
	if self.defeated_enemy_ids[enemy_def.id] == true then
		return false
	end

	local conditions = enemy_def.conditions
	for i = 1, #conditions do
		if not condition_matches(self, conditions[i], enemy_def.id) then
			return false
		end
	end

	return true
end

function castle_service:sync_enemy_instance(enemy_def, room)
	local id = enemy_def.id
	local instance = object(id)
	if instance == nil then
		instance = inst('enemy.def.' .. enemy_def.kind, {
			id = id,
			space_id = room.space_id,
			pos = { x = enemy_def.x, y = enemy_def.y, z = 140 },
			trigger = enemy_def.trigger,
			conditions = enemy_def.conditions,
			damage = enemy_def.damage,
			health = enemy_def.health,
			max_health = enemy_def.health,
			direction = enemy_def.direction,
			speed_x_num = enemy_def.speedx,
			speed_y_num = enemy_def.speedy,
		})
	else
		instance.space_id = room.space_id
		instance.trigger = enemy_def.trigger
		instance.conditions = enemy_def.conditions
		instance.damage = enemy_def.damage
		if enemy_def.health ~= nil then
			instance.health = enemy_def.health
			instance.max_health = enemy_def.health
		end
		if enemy_def.direction ~= nil then
			instance.direction = enemy_def.direction
		end
		if enemy_def.speedx ~= nil then
			instance.speed_x_num = enemy_def.speedx
		end
		if enemy_def.speedy ~= nil then
			instance.speed_y_num = enemy_def.speedy
		end
		instance.x = enemy_def.x
		instance.y = enemy_def.y
	end

	self.enemies_by_id[id] = instance
	if not instance.active then
		instance:activate()
	end
	instance.visible = true
	return instance
end

function castle_service:deactivate_unused_enemies(active_ids)
	for id, instance in pairs(self.enemies_by_id) do
		local live_instance = object(id)
		if live_instance == nil then
			self.enemies_by_id[id] = nil
			goto continue
		end

		instance = live_instance
		self.enemies_by_id[id] = instance
		if active_ids[id] ~= true then
			instance.visible = false
			if instance.active then
				instance:deactivate()
			end
		end
		::continue::
	end
end

function castle_service:refresh_current_room_enemies()
	local room = self.current_room
	local enemy_defs = room.enemies
	local active_ids = {}

	for i = 1, #enemy_defs do
		local enemy_def = enemy_defs[i]
		if self:enemy_should_spawn(enemy_def) then
			self:sync_enemy_instance(enemy_def, room)
			active_ids[enemy_def.id] = true
		end
	end

	self:deactivate_unused_enemies(active_ids)
end

function castle_service:bind_enemy_events()
	eventemitter.eventemitter.instance:on({
		event = 'enemy.defeated',
		subscriber = self,
		handler = function(event)
			local enemy_id = event.emitter
			self.defeated_enemy_ids[enemy_id] = true
			self.enemies_by_id[enemy_id] = nil

			local enemy_instance = object(enemy_id)
			if enemy_instance ~= nil then
				enemy_instance.visible = false
				if enemy_instance.active then
					enemy_instance:deactivate()
				end
			end

			if event.kind == 'cloud' then
				self.enemy_condition_flags.cloud_1_destroyed = true
			end
			if event.trigger and event.trigger ~= '' then
				self.enemy_condition_flags[event.trigger] = true
				eventemitter.eventemitter.instance:emit('room.condition_set', self.id, {
					room_number = event.room_number,
					condition = event.trigger,
				})
			end
			if event.room_number == self.current_room_number then
				self:refresh_current_room_enemies()
			end
		end,
	})

	eventemitter.eventemitter.instance:on({
		event = 'room.condition_set',
		subscriber = self,
		handler = function(event)
			self.enemy_condition_flags[event.condition] = true
			if event.room_number == self.current_room_number then
				self:refresh_current_room_enemies()
			end
		end,
	})
end

function castle_service:ctor()
	self.enemies_by_id = {}
	self.defeated_enemy_ids = {}
	self.enemy_condition_flags = {}
	self:bind_enemy_events()
end

function castle_service:sync_world_entrance_states_for_room(room_state)
	local world_entrances = room_state.world_entrances
	for i = 1, #world_entrances do
		local target = world_entrances[i].target
		local entrance_state = self.world_entrance_states[target]
		if entrance_state == nil then
			self.world_entrance_states[target] = {
				state = 'closed',
				open_step = 0,
			}
		end
	end
end

function castle_service:initialize(initial_room_number)
	self.current_room = room_module.create_room(initial_room_number)
	self.current_room_number = self.current_room.room_number
	self.map_id = self.current_room.world_number
	self.map_x = 5
	self.map_y = 12
	self.last_room_switch = nil
	self.world_entrance_states = {}
	self:sync_world_entrance_states_for_room(self.current_room)
	self:refresh_current_room_enemies()
	return self.current_room
end

function castle_service:begin_open_world_entrance(target)
	local entrance_state = self.world_entrance_states[target]
	if entrance_state.state ~= 'closed' then
		return
	end
	entrance_state.state = 'opening_1'
	entrance_state.open_step = 0
end

function castle_service:tick()
	for _, entrance_state in pairs(self.world_entrance_states) do
		if entrance_state.state == 'opening_1' or entrance_state.state == 'opening_2' then
			entrance_state.open_step = entrance_state.open_step + 1
			if entrance_state.open_step < constants.world_entrance.open_step_frames then
				goto continue
			end
			entrance_state.open_step = 0
			if entrance_state.state == 'opening_1' then
				entrance_state.state = 'opening_2'
			else
				entrance_state.state = 'open'
			end
		end
		::continue::
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
	self:refresh_current_room_enemies()
	return clone_switch(switch)
end

function castle_service:enter_world(target)
	local transition = castle_map.world_transition(target)

	local from_room_number = self.current_room_number

	self.current_room = room_module.create_room(transition.world_room_number)
	self.current_room_number = self.current_room.room_number
	self.map_id = transition.world_number
	self.map_x = transition.world_map_x
	self.map_y = transition.world_map_y
	self.last_room_switch = {
		from_room_number = from_room_number,
		to_room_number = self.current_room_number,
		direction = 'down',
		transition_kind = 'world_banner',
	}
	self:sync_world_entrance_states_for_room(self.current_room)
	self:refresh_current_room_enemies()

	return {
		from_room_number = from_room_number,
		to_room_number = self.current_room_number,
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

	local transition = castle_map.world_transition_from_world_number(world_number)
	local from_room_number = self.current_room_number

	self.current_room = room_module.create_room(transition.castle_room_number)
	self.current_room_number = self.current_room.room_number
	self.map_id = 0
	self.map_x = transition.castle_map_x
	self.map_y = transition.castle_map_y
	self.last_room_switch = {
		from_room_number = from_room_number,
		to_room_number = self.current_room_number,
		direction = 'right',
		transition_kind = 'castle_banner',
	}
	self:sync_world_entrance_states_for_room(self.current_room)
	self:refresh_current_room_enemies()

	return {
		from_room_number = from_room_number,
		to_room_number = self.current_room_number,
		direction = 'right',
		transition_kind = 'castle_banner',
		spawn_x = transition.castle_spawn_x,
		spawn_y = transition.castle_spawn_y,
		spawn_facing = transition.castle_spawn_facing,
	}
end

local function register_castle_service_definition()
	define_service({
		def_id = 'castle_service.def',
		class = castle_service,
		defaults = {
			id = 'c',
			current_room = nil,
			current_room_number = 0,
			map_id = 0,
			map_x = 5,
			map_y = 12,
			last_room_switch = nil,
			world_entrance_states = {},
			enemies_by_id = {},
			defeated_enemy_ids = {},
			enemy_condition_flags = {},
			tick_enabled = true,
		},
	})
end

return {
	castle_service = castle_service,
	register_castle_service_definition = register_castle_service_definition,
}
