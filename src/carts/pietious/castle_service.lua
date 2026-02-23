local constants = require('constants')
local room_module = require('room')
local castle_map = require('castle_map')
local progression = require('progression')
local world_instance = require('world').instance

local castle_service = {}
local enemy_transition_space_id = 'eh'
local persistent_room_object_ids = {
	pietolon = true,
	room = true,
	ui = true,
}

local world1_stairs_open_row = '#............................-=#'
local world_entrance_opening_states = {
	opening_1 = true,
	opening_2 = true,
}

local function build_progression_program()
	local rules = {}
	local condition_name_set = {}
	local condition_names = {}
	local world1_marspein_destroyed_keys = {}

	for _, room_template in pairs(castle_map.room_templates) do
		local room_number = room_template.room_number
		local enemies = room_template.enemies
		for i = 1, #enemies do
			local enemy_def = enemies[i]
			rules[#rules + 1] = {
				id = enemy_def.id,
				on = 'enemy.defeated',
				when_event = {
					equals = {
						enemy_id = enemy_def.id,
					},
				},
				set = {
					{ key = enemy_def.id, value = true },
				},
			}
			if enemy_def.trigger ~= nil and not condition_name_set[enemy_def.trigger] then
				condition_name_set[enemy_def.trigger] = true
				condition_names[#condition_names + 1] = enemy_def.trigger
			end
			if room_number == 106 and enemy_def.kind == 'marspeinenaardappel' then
				world1_marspein_destroyed_keys[#world1_marspein_destroyed_keys + 1] = enemy_def.id
			end
		end
	end

	table.sort(condition_names)
	for i = 1, #condition_names do
		local condition_name = condition_names[i]
		rules[#rules + 1] = {
			id = condition_name,
			on = 'room.condition_set',
			when_event = {
				equals = {
					condition = condition_name,
				},
			},
			set = {
				{ key = condition_name, value = true },
			},
		}
	end
	rules[#rules + 1] = {
		id = 'room.condition_set.apply',
		on = 'room.condition_set',
		apply = {
			{ op = 'apply_room_condition' },
		},
	}

	rules[#rules + 1] = {
		id = 'cloud_1_destroyed',
		on = 'enemy.defeated',
		when_event = {
			equals = {
				kind = 'cloud',
			},
		},
		set = {
			{ key = 'cloud_1_destroyed', value = true },
		},
	}

	local stairs_latch_conditions = {
		{ key = 'r109.stairs', equals = false },
		{ key = 'staff1destroyed', equals = true },
		{ key = 'staff2destroyed', equals = true },
		{ key = 'staff3destroyed', equals = true },
	}
	rules[#rules + 1] = {
		id = 'r109.stairs.set',
		on = 'enemy.defeated',
		when_all = stairs_latch_conditions,
		set = {
			{ key = 'r109.stairs', value = true },
		},
	}

	local world1_wall_conditions = {
		{ key = 'r106.wall', equals = false },
	}
	for i = 1, #world1_marspein_destroyed_keys do
		world1_wall_conditions[#world1_wall_conditions + 1] = {
			key = world1_marspein_destroyed_keys[i],
			equals = true,
		}
	end
	rules[#rules + 1] = {
		id = 'r106.wall.set',
		on = 'enemy.defeated',
		when_all = world1_wall_conditions,
		set = {
			{ key = 'r106.wall', value = true },
		},
		apply = {
			{
				op = 'emit_event',
				event = 'room.condition_set',
				payload = {
					room_number = 106,
					condition = 'r106.wall',
				},
			},
			{
				op = 'emit_event',
				event = 'evt.cue.appearance',
			},
		},
	}

	rules[#rules + 1] = {
		id = 'r109.stairs.apply',
		on = 'room.enter',
		when_all = {
			{ key = 'r109.stairs', equals = true },
		},
		when_event = {
			equals = {
				room_number = 109,
			},
		},
		apply = {
			{
				op = 'room.patch_rows',
				room_number = 109,
				rows = {
					{ index = 18, value = world1_stairs_open_row },
					{ index = 19, value = world1_stairs_open_row },
					{ index = 20, value = world1_stairs_open_row },
				},
			},
		},
	}

	rules[#rules + 1] = {
		id = 'r109.stairs.cue',
		on = 'room.enter',
		when_all = {
			{ key = 'r109.stairs', equals = true },
		},
		when_event = {
			equals = {
				room_number = 109,
			},
		},
		apply_once = true,
		apply = {
			{
				op = 'emit_event',
				event = 'evt.cue.appearance',
			},
		},
	}
	rules[#rules + 1] = {
		id = 'enemy.defeated.refresh',
		on = 'enemy.defeated',
		apply = {
			{ op = 'refresh_current_room_enemies' },
		},
	}

	return progression.compile_program({
		rules = rules,
		handlers = {
			['room.patch_rows'] = function(ctx, command)
				room_module.apply_progression_command(ctx.current_room, command)
			end,
			refresh_current_room_enemies = function(ctx, command, event)
				if event.room_number == ctx.current_room_number then
					ctx:refresh_current_room_enemies()
				end
			end,
			apply_room_condition = function(ctx, command, event)
				if event.room_number ~= ctx.current_room_number then
					return
				end
				ctx:refresh_current_room_enemies()
			end,
			emit_event = function(ctx, command)
				local payload = {
					service_id = ctx.id,
				}
				if command.payload ~= nil then
					for key, value in pairs(command.payload) do
						payload[key] = value
					end
				end
				ctx.events:emit(command.event, payload)
			end,
		},
	})
end

local function create_room_switch(from_room_number, to_room_number, direction)
	return {
		from_room_number = from_room_number,
		to_room_number = to_room_number,
		direction = direction,
	}
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

function castle_service:sync_enemy_instance(enemy_def, room, force_reset_from_room_template)
	local id = enemy_def.id
	local instance = object(id)
	if instance == nil then
		instance = inst('enemy.' .. enemy_def.kind, {
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
		instance:set_space(room.space_id)
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
		if not next_active_ids[id] then
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

function castle_service:apply_enemy_transition_space_if_needed()
	if not self.enemies_suspended_for_transition then
		return
	end

	self:for_each_active_enemy_instance(function(instance)
		instance:set_space(enemy_transition_space_id)
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
		instance:set_space(room_space)
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
		if not progression.matches(self, enemy_def.conditions) then
			goto continue
		end
		if not force_reset_from_room_template and previous_active_ids[enemy_id] then
			local live_instance = object(enemy_id)
			if live_instance ~= nil then
				self.enemies_by_id[enemy_id] = live_instance
				next_active_ids[enemy_id] = true
				goto continue
			end
		end
		self:sync_enemy_instance(enemy_def, room, force_reset_from_room_template)
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

			if event.trigger then
				self.events:emit('room.condition_set', {
					service_id = self.id,
					room_number = event.room_number,
					condition = event.trigger,
				})
			end
		end,
	})
end

function castle_service:ctor()
	self.enemies_by_id = {}
	self.active_enemy_ids = {}
	self.active_enemy_ids_scratch = {}
	self.enemies_suspended_for_transition = false
	progression.mount(self, build_progression_program())
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

function castle_service:commit_room_switch(previous_space, switch, map_id, map_x, map_y)
	self:despawn_room_runtime_objects(previous_space)
	self.current_room_number = self.current_room.room_number
	self.map_id = map_id
	self.map_x = map_x
	self.map_y = map_y
	self.last_room_switch = switch
	self:sync_world_entrance_states_for_room(self.current_room)
	self:refresh_current_room_enemies(true)
	self.events:emit('room.enter', {
		service_id = self.id,
		room_number = self.current_room_number,
	})
	return switch
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
	self.events:emit('room.enter', {
		service_id = self.id,
		room_number = self.current_room_number,
	})
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
	for _, entrance_state in pairs(self.world_entrance_states) do
		if world_entrance_opening_states[entrance_state.state] then
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

function castle_service:switch_room(direction, player_top, player_bottom)
	local previous_space = self.current_room.space_id

	local switch = room_module.switch_room(self.current_room, direction)
	if switch == nil then
		return nil
	end

	if switch.outside then
		self.last_room_switch = switch
		return switch
	end

	local map_x = self.map_x
	local map_y = self.map_y
	if direction == 'left' then
		map_x = map_x - 1
	elseif direction == 'right' then
		map_x = map_x + 1
	elseif direction == 'up' then
		map_y = map_y - 1
	else
		map_y = map_y + 1
	end
	self:commit_room_switch(previous_space, switch, self.current_room.world_number, map_x, map_y)
	return switch
end

function castle_service:enter_world(target)
	local transition = castle_map.world_transitions[target]
	local previous_space = self.current_room.space_id

	self.current_room = room_module.create_room(transition.world_room_number)
	local switch = create_room_switch(self.current_room_number, self.current_room.room_number, 'down')
	self:commit_room_switch(
		previous_space,
		switch,
		transition.world_number,
		transition.world_map_x,
		transition.world_map_y
	)

	return {
		from_room_number = switch.from_room_number,
		to_room_number = switch.to_room_number,
		direction = switch.direction,
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

	self.current_room = room_module.create_room(transition.castle_room_number)
	local switch = create_room_switch(self.current_room_number, self.current_room.room_number, 'right')
	self:commit_room_switch(
		previous_space,
		switch,
		0,
		transition.castle_map_x,
		transition.castle_map_y
	)

	return {
		from_room_number = switch.from_room_number,
		to_room_number = switch.to_room_number,
		direction = switch.direction,
		spawn_x = transition.castle_spawn_x,
		spawn_y = transition.castle_spawn_y,
		spawn_facing = transition.castle_spawn_facing,
	}
end

function castle_service:halo_teleport_to_start_room()
	local previous_space = self.current_room.space_id

	self.current_room = room_module.create_room(castle_map.start_room_number)
	local switch = create_room_switch(self.current_room_number, self.current_room.room_number, 'halo')
	self:commit_room_switch(previous_space, switch, 0, 5, 12)

	return {
		from_room_number = switch.from_room_number,
		to_room_number = switch.to_room_number,
		direction = switch.direction,
	}
end

local function define_castle_service_fsm()
	define_fsm('castle_service', {
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
		def_id = 'castle',
		class = castle_service,
		fsms = { 'castle_service' },
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
