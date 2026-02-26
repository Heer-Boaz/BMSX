local constants = require('constants')
local castle_map = require('castle_map')
local progression = require('progression')
local world_instance = require('world').instance

local castle_service = {}

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
local halo_destination_room_number = 1

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
				ctx.current_room:apply_progression_command(command)
			end,
			refresh_current_room_enemies = function(ctx, command, event)
				if event.room_number == ctx.current_room.room_number then
					ctx:refresh_current_room_customizations()
					service('en'):refresh_current_room_enemies()
				end
			end,
			apply_room_condition = function(ctx, command, event)
				if event.room_number ~= ctx.current_room.room_number then
					return
				end
				ctx:refresh_current_room_customizations()
				service('en'):refresh_current_room_enemies()
			end,
			emit_event = function(ctx, command)
				local payload = {}
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

local function should_dispose_runtime_room_object(obj)
	if persistent_room_object_ids[obj.id] then
		return false
	end
	if obj.space_id == 'main' then
		return true
	end
	return false
end

function castle_service:sync_current_room_seal_instance()
	local seal = self.current_room.seal
	if seal == nil then
		return
	end
	local active_space = get_space()

	local seal_instance = object(seal.id)
	if not self.current_room.has_active_seal and not self.current_room.seal_sequence_active then
		if seal_instance ~= nil then
			world_instance:despawn(seal_instance)
		end
		return
	end

	local dissolve_step = self.current_room.seal_dissolve_step
	if dissolve_step >= 6 then
		if seal_instance ~= nil then
			world_instance:despawn(seal_instance)
		end
		return
	end

	local sprite_id
	if dissolve_step > 0 then
		sprite_id = 'seal_dissolve_' .. tostring(dissolve_step)
	else
		sprite_id = 'seal'
	end

	if seal_instance == nil then
		seal_instance = inst('seal', {
			id = seal.id,
			space_id = active_space,
			pos = { x = seal.x, y = seal.y, z = 23 },
		})
	else
		seal_instance:set_space(active_space)
		if not seal_instance.active then
			seal_instance:activate()
		end
		seal_instance.visible = true
		seal_instance.x = seal.x
		seal_instance.y = seal.y
		seal_instance.z = 23
	end

	seal_instance:gfx(sprite_id)
end

function castle_service:refresh_current_room_customizations()
	local seal = self.current_room.seal
	local world_boss_defeated = self.world_boss_defeated[self.current_room.world_number]
	if seal == nil then
		self.current_room.has_active_seal = false
	else
		if self.current_room.seal_broken and not world_boss_defeated then
			self.current_room.has_active_seal = false
		else
			self.current_room.has_active_seal = progression.matches(self, seal.conditions)
		end
	end
	self:sync_current_room_seal_instance()
end

function castle_service:begin_seal_dissolution()
	self.world_boss_defeated[self.current_room.world_number] = false
	self.current_room.seal_sequence_active = true
	self.current_room.room_dissolve_step = 0
	self.current_room.seal_dissolve_step = 0
	self.current_room.daemon_fight_active = false
	self:set_seal_dissolve_intro_state(1)
	self:sync_current_room_seal_instance()
end

function castle_service:set_seal_dissolve_intro_state(intro_state)
	local room_dissolve_step = 0
	local seal_dissolve_step = 0
	if intro_state >= 32 then
		if intro_state < 64 then
			local progress = intro_state - 32
			room_dissolve_step = math.modf((progress * constants.flow.seal_room_dissolve_steps) / 32) + 1
		else
			room_dissolve_step = constants.flow.seal_room_dissolve_steps
		end
	end
	if intro_state >= 64 then
		local progress = intro_state - 64
		if progress > 31 then
			progress = 31
		end
		seal_dissolve_step = math.modf((progress * constants.flow.seal_sprite_dissolve_steps) / 32) + 1
	end
	if room_dissolve_step > constants.flow.seal_room_dissolve_steps then
		room_dissolve_step = constants.flow.seal_room_dissolve_steps
	end
	if seal_dissolve_step > constants.flow.seal_sprite_dissolve_steps then
		seal_dissolve_step = constants.flow.seal_sprite_dissolve_steps
	end
	if self.current_room.room_dissolve_step ~= room_dissolve_step then
		self.current_room.room_dissolve_step = room_dissolve_step
	end
	if self.current_room.seal_dissolve_step ~= seal_dissolve_step then
		self.current_room.seal_dissolve_step = seal_dissolve_step
		self:sync_current_room_seal_instance()
	end
end

function castle_service:finish_seal_dissolution()
	self.current_room.seal_sequence_active = true
	self.current_room.seal_broken = true
	self.current_room.has_active_seal = false
	self.current_room.daemon_fight_active = false
	local row_patches = {}
	for i = 1, #self.current_room.map_rows do
		local row = self.current_room.map_rows[i]
		local patched_row = row:gsub('%$', '.')
		if patched_row ~= row then
			row_patches[#row_patches + 1] = {
				index = i,
				value = patched_row,
			}
		end
	end
	if #row_patches > 0 then
		self.current_room:patch_rows(row_patches)
	end
	self:refresh_current_room_customizations()
	service('en'):refresh_current_room_enemies()
end

function castle_service:begin_daemon_appearance()
	self.current_room.seal_sequence_active = true
end

function castle_service:should_restart_daemon_appearance_after_death()
	if self.current_room.seal == nil then
		return false
	end
	if self.world_boss_defeated[self.current_room.world_number] then
		return false
	end
	return self.current_room.seal_broken
end

function castle_service:is_current_room_boss_encounter_active()
	if self.current_room.seal == nil then
		return false
	end
	if self.world_boss_defeated[self.current_room.world_number] then
		return false
	end
	return self.current_room.seal_sequence_active or self.current_room.daemon_fight_active or self.current_room.seal_broken
end

function castle_service:activate_current_room_daemon_fight()
	self.current_room.seal_sequence_active = false
	self.current_room.daemon_fight_active = true
end

function castle_service:ctor()
	self.world_boss_defeated = {}
	progression.mount(self, build_progression_program())
end

function castle_service:despawn_room_runtime_objects()
	for obj in world_instance:objects({ scope = 'all' }) do
		if should_dispose_runtime_room_object(obj) then
			obj:mark_for_disposal()
		end
	end
	service('en'):clear_enemy_state()
end

function castle_service:sync_world_entrance_states_for_room(room_state)
	local world_entrances = room_state.world_entrances
	for i = 1, #world_entrances do
		local target = world_entrances[i].target
		if self.world_entrance_states[target] == nil then
			self.world_entrance_states[target] = {
				state = 'closed',
				open_step = 0,
			}
		end
	end
end

function castle_service:commit_room_switch(switch, map_id, map_x, map_y)
	self:despawn_room_runtime_objects()
	self.current_room.map_id = map_id
	self.current_room.map_x = map_x
	self.current_room.map_y = map_y
	self.current_room.last_room_switch = switch
	self:sync_world_entrance_states_for_room(self.current_room)
	self:refresh_current_room_customizations()
	service('en'):refresh_current_room_enemies(true)
	service('e'):sync_platform_instances(self.current_room.room_number)
	self.events:emit('room.enter', {
		room_number = self.current_room.room_number,
	})
	return switch
end

function castle_service:initialize(initial_room_number)
	local rm = object('room')
	self.current_room = rm
	rm:load_room(initial_room_number)
	rm.map_id = rm.world_number
	rm.map_x = 5
	rm.map_y = 12
	rm.last_room_switch = nil
	self.world_entrance_states = {}
	self.world_boss_defeated = {}
	self:sync_world_entrance_states_for_room(rm)
	self:refresh_current_room_customizations()
	service('en'):refresh_current_room_enemies(true)
	self.events:emit('room.enter', {
		room_number = rm.room_number,
	})
end

function castle_service:begin_open_world_entrance(target)
	if self.world_entrance_states[target].state ~= 'closed' then
		return false
	end
	self.world_entrance_states[target].state = 'opening_1'
	self.world_entrance_states[target].open_step = 0
	return true
end

function castle_service:sync_world_entrance_visuals()
	local world_entrances = self.current_room.world_entrances
	for i = 1, #world_entrances do
		local we_def = world_entrances[i]
		local entrance = object(we_def.id)
		if entrance ~= nil then
			entrance:set_entrance_state(self.world_entrance_states[we_def.target].state)
		end
	end
end

function castle_service:tick()
	local visuals_dirty = false

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
			visuals_dirty = true
		end
		::continue::
	end

	if visuals_dirty then
		self:sync_world_entrance_visuals()
	end
end

function castle_service:switch_room(direction, player_top, player_bottom)
	local switch = self.current_room:switch_room(direction)
	if switch == nil then
		return nil
	end

	if switch.outside then
		self.current_room.last_room_switch = switch
		return switch
	end

	local map_x = self.current_room.map_x
	local map_y = self.current_room.map_y
	if direction == 'left' then
		map_x = map_x - 1
	elseif direction == 'right' then
		map_x = map_x + 1
	elseif direction == 'up' then
		map_y = map_y - 1
	else
		map_y = map_y + 1
	end
	self:commit_room_switch(switch, self.current_room.world_number, map_x, map_y)
	return switch
end

function castle_service:enter_world(target)
	local transition = castle_map.world_transitions[target]
	local from_room_number = self.current_room.room_number
	service('en'):despawn_active_enemies()

	self.current_room:load_room(transition.world_room_number)
	local switch = create_room_switch(from_room_number, self.current_room.room_number, 'down')
	self:commit_room_switch(
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
	local from_room_number = self.current_room.room_number

	local transition = castle_map.world_transitions_by_number[world_number]

	self.current_room:load_room(transition.castle_room_number)
	local switch = create_room_switch(from_room_number, self.current_room.room_number, 'right')
	self:commit_room_switch(
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

function castle_service:halo_teleport_to_room_1()
	local from_room_number = self.current_room.room_number

	self.current_room:load_room(halo_destination_room_number)
	local switch = create_room_switch(from_room_number, self.current_room.room_number, 'halo')
	self:commit_room_switch(switch, 0, 5, 12)
	switch.spawn_x = constants.player.start_x
	switch.spawn_y = constants.player.start_y
	switch.spawn_facing = 1

	return {
		from_room_number = switch.from_room_number,
		to_room_number = switch.to_room_number,
		direction = switch.direction,
		spawn_x = switch.spawn_x,
		spawn_y = switch.spawn_y,
		spawn_facing = switch.spawn_facing,
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
			world_entrance_states = {},
			world_boss_defeated = {},
			tick_enabled = true,
		},
	})
end

return {
	castle_service = castle_service,
	define_castle_service_fsm = define_castle_service_fsm,
	register_castle_service_definition = register_castle_service_definition,
}
