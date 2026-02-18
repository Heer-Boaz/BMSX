local constants = require('constants')
local room_module = require('room')
local castle_map = require('castle_map')
local world_instance = require('world').instance

local castle_service = {}
local enemy_transition_space_id = 'eh'
local persistent_room_object_ids = {
	pietolon = true,
	room = true,
	ui = true,
}

local function clear_map(map)
	for key in pairs(map) do
		map[key] = nil
	end
end

local function should_dispose_runtime_room_object(obj, room_space)
	if persistent_room_object_ids[obj.id] then
		return false
	end
	local space_id = obj.space_id
	if space_id == room_space or space_id == enemy_transition_space_id then
		return true
	end
	return false
end

local function resolve_enemy_instance(self, id)
	local instance = self.enemies_by_id[id]
	if instance ~= nil then
		return instance
	end
	instance = object(id)
	if instance ~= nil then
		self.enemies_by_id[id] = instance
	end
	return instance
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

local function set_enemy_condition_flag(self, condition)
	if self.enemy_condition_flags[condition] then
		return false
	end
	self.enemy_condition_flags[condition] = true
	return true
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

function castle_service:sync_enemy_instance(enemy_def, room, force_reset_from_room_template)
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
			width_tiles = enemy_def.width_tiles,
			height_tiles = enemy_def.height_tiles,
			tiletype = enemy_def.tiletype,
		})
	else
		local should_reset_from_room_template = force_reset_from_room_template or (not instance.active)
		instance.space_id = room.space_id
		instance.trigger = enemy_def.trigger
		instance.conditions = enemy_def.conditions
		instance.damage = enemy_def.damage
		instance.width_tiles = enemy_def.width_tiles
		instance.height_tiles = enemy_def.height_tiles
		instance.tiletype = enemy_def.tiletype
		if enemy_def.width_tiles ~= nil then
			instance.sx = enemy_def.width_tiles * constants.room.tile_size
		end
		if enemy_def.height_tiles ~= nil then
			instance.sy = enemy_def.height_tiles * constants.room.tile_size
		end
		if enemy_def.health ~= nil then
			instance.max_health = enemy_def.health
			if should_reset_from_room_template then
				instance.health = enemy_def.health
			end
		end
		if should_reset_from_room_template and enemy_def.direction ~= nil then
			instance.direction = enemy_def.direction
		end
		if should_reset_from_room_template and enemy_def.speedx ~= nil then
			instance.speed_x_num = enemy_def.speedx
			instance.speed_accum_x = 0
		end
		if should_reset_from_room_template and enemy_def.speedy ~= nil then
			instance.speed_y_num = enemy_def.speedy
			instance.speed_accum_y = 0
		end
		if should_reset_from_room_template then
			instance.x = enemy_def.x
			instance.y = enemy_def.y
		end
	end

	self.enemies_by_id[id] = instance
	if not instance.active then
		instance:activate()
	end
	instance.visible = true
	return instance
end

function castle_service:deactivate_enemy_by_id(id)
	local instance = self.enemies_by_id[id]
	if instance == nil then
		instance = object(id)
		if instance == nil then
			return
		end
	end
	self.enemies_by_id[id] = instance
	instance.visible = false
	if instance.active then
		instance:deactivate()
	end
end

function castle_service:deactivate_stale_active_enemies(next_active_ids)
	local previous_active_ids = self.active_enemy_ids
	for id in pairs(previous_active_ids) do
		if next_active_ids[id] ~= true then
			self:deactivate_enemy_by_id(id)
		end
	end
end

function castle_service:commit_active_enemy_ids(next_active_ids)
	local previous_active_ids = self.active_enemy_ids
	self.active_enemy_ids = next_active_ids
	self.active_enemy_ids_scratch = previous_active_ids
	clear_map(previous_active_ids)
end

function castle_service:for_each_active_enemy_instance(visitor)
	for id in pairs(self.active_enemy_ids) do
		local instance = resolve_enemy_instance(self, id)
		if instance ~= nil then
			visitor(instance, id)
		end
	end
end

function castle_service:current_room_has_active_disappearing_wall_for_condition(condition)
	local enemy_defs = self.current_room.enemies
	for i = 1, #enemy_defs do
		local enemy_def = enemy_defs[i]
		if enemy_def.kind == 'disappearingwall' and enemy_def.trigger == condition then
			local instance = object(enemy_def.id)
			if instance ~= nil and instance.active then
				return true
			end
		end
	end
	return false
end

function castle_service:apply_enemy_transition_space_if_needed()
	if not self.enemies_suspended_for_transition then
		return
	end

	self:for_each_active_enemy_instance(function(instance)
		instance.space_id = enemy_transition_space_id
	end)
end

function castle_service:park_active_enemies_for_transition()
	self.enemies_suspended_for_transition = true
	self:apply_enemy_transition_space_if_needed()
end

function castle_service:resume_active_enemies_after_transition()
	self.enemies_suspended_for_transition = false

	local room_space = self.current_room.space_id
	self:for_each_active_enemy_instance(function(instance)
		instance.space_id = room_space
		instance.visible = true
		if not instance.active then
			instance:activate()
		end
	end)
end

function castle_service:refresh_current_room_enemies(force_reset_from_room_template)
	local room = self.current_room
	local enemy_defs = room.enemies
	local next_active_ids = self.active_enemy_ids_scratch
	local previous_active_ids = self.active_enemy_ids
	clear_map(next_active_ids)

	for i = 1, #enemy_defs do
		local enemy_def = enemy_defs[i]
		local enemy_id = enemy_def.id
		if not self:enemy_should_spawn(enemy_def) then
			goto continue
		end
		if not force_reset_from_room_template and previous_active_ids[enemy_id] == true then
			local live_instance = object(enemy_id)
			if live_instance ~= nil then
				self.enemies_by_id[enemy_id] = live_instance
				next_active_ids[enemy_id] = true
				goto continue
			end
		end
		self:sync_enemy_instance(enemy_def, room, force_reset_from_room_template == true)
		next_active_ids[enemy_id] = true
		::continue::
	end

	self:deactivate_stale_active_enemies(next_active_ids)
	self:commit_active_enemy_ids(next_active_ids)
	self:apply_enemy_transition_space_if_needed()
end

function castle_service:bind_enemy_events()
	self.events:on({
		event = 'enemy.defeated',
		subscriber = self,
		handler = function(event)
			local enemy_id = event.enemy_id
			self.defeated_enemy_ids[enemy_id] = true
			self.enemies_by_id[enemy_id] = nil
			self.active_enemy_ids[enemy_id] = nil
			self.active_enemy_ids_scratch[enemy_id] = nil

			local enemy_instance = object(enemy_id)
			if enemy_instance ~= nil then
				enemy_instance.visible = false
				if enemy_instance.active then
					enemy_instance:deactivate()
				end
			end

			local should_refresh_room = false
			if event.kind == 'cloud' then
				should_refresh_room = set_enemy_condition_flag(self, 'cloud_1_destroyed') or should_refresh_room
			end
			if event.trigger then
				self.events:emit('room.condition_set', {
					room_number = event.room_number,
					condition = event.trigger,
				})
				should_refresh_room = false
			end
			if should_refresh_room and event.room_number == self.current_room_number then
				self:refresh_current_room_enemies()
			end
		end,
	})

	self.events:on({
		event = 'room.condition_set',
		subscriber = self,
		handler = function(event)
			if not set_enemy_condition_flag(self, event.condition) then
				return
			end
			if event.room_number == self.current_room_number then
				if self:current_room_has_active_disappearing_wall_for_condition(event.condition) then
					self.events:emit('evt.cue.appearance', {})
				end
				self:refresh_current_room_enemies()
			end
		end,
	})
end

function castle_service:ctor()
	self.enemies_by_id = {}
	self.defeated_enemy_ids = {}
	self.enemy_condition_flags = {}
	self.active_enemy_ids = {}
	self.active_enemy_ids_scratch = {}
	self.enemies_suspended_for_transition = false
	self:bind_enemy_events()
end

function castle_service:despawn_room_runtime_objects(room_space)
	for obj in world_instance:objects({ scope = 'all' }) do
		if should_dispose_runtime_room_object(obj, room_space) then
			obj:mark_for_disposal()
		end
	end
	clear_map(self.enemies_by_id)
	clear_map(self.active_enemy_ids)
	clear_map(self.active_enemy_ids_scratch)
	self.enemies_suspended_for_transition = false
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
	self:refresh_current_room_enemies(true)
	return self.current_room
end

function castle_service:begin_open_world_entrance(target)
	local entrance_state = self.world_entrance_states[target]
	if entrance_state.state ~= 'closed' then
		return false
	end
	entrance_state.state = 'opening_1'
	entrance_state.open_step = 0
	return true
end

function castle_service:tick()
	if self.current_room_number == 106 and self.enemy_condition_flags.world1walldisappear ~= true then
		local enemies = self.current_room.enemies
		local has_marspeinenaardappel
		for i = 1, #enemies do
			local enemy_def = enemies[i]
			if enemy_def.kind == 'marspeinenaardappel' and self:enemy_should_spawn(enemy_def) then
				has_marspeinenaardappel = true
				break
			end
		end
		if has_marspeinenaardappel ~= true then
			self.events:emit('room.condition_set', {
				room_number = self.current_room_number,
				condition = 'world1walldisappear',
			})
		end
	end

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
	local previous_space = self.current_room.space_id
	if not self:can_cross_edge(direction, player_top, player_bottom) then
		return nil
	end

	local switch = room_module.switch_room(self.current_room, direction)
	if switch == nil then
		return nil
	end

	if switch.outside == true then
		self.last_room_switch = switch
		return switch
	end
	self:despawn_room_runtime_objects(previous_space)

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
	self:refresh_current_room_enemies(true)
	return switch
end

function castle_service:enter_world(target)
	local transition = castle_map.world_transitions[target]
	local previous_space = self.current_room.space_id

	local from_room_number = self.current_room_number

	self.current_room = room_module.create_room(transition.world_room_number)
	self:despawn_room_runtime_objects(previous_space)
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
	self:refresh_current_room_enemies(true)

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
	local previous_space = self.current_room.space_id

	local transition = castle_map.world_transitions_by_number[world_number]
	local from_room_number = self.current_room_number

	self.current_room = room_module.create_room(transition.castle_room_number)
	self:despawn_room_runtime_objects(previous_space)
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
	self:refresh_current_room_enemies(true)

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

local function define_castle_service_fsm()
	define_fsm('castle_service.fsm', {
		initial = 'active',
		states = {
			active = {
				tick = castle_service.tick,
			},
		},
	})
end

local function register_castle_service_definition()
	define_service({
		def_id = 'castle_service.def',
		class = castle_service,
		fsms = { 'castle_service.fsm' },
		auto_activate = true,
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
			enemies_suspended_for_transition = false,
			tick_enabled = true,
		},
	})
end

return {
	castle_service = castle_service,
	define_castle_service_fsm = define_castle_service_fsm,
	register_castle_service_definition = register_castle_service_definition,
}
