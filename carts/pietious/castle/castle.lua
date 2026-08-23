local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')
require('constants')
local castle_map<const> = require('castle/map')
local progression<const> = require('cartlib/progression')
local room_spawner<const> = require('room/spawner')
local world_object<const> = require('cartlib/world/world_object')

local castle<const> = {}

local world1_stairs_open_row<const> = '#............................-=#'
local halo_destination_room_number<const> = 1
local castle_tags<const> = {
	seal_active = 'c.seal.active',
	seal_sequence = 'c.seal.sequence',
	seal_dissolving = 'c.seal.diss',
	seal_broken = 'c.seal.broken',
	daemon_fight = 'c.daemon.fight',
}
local room_music_suppressed_directions<const> = {
	world_leave = true,
	halo = true,
}

local set_tag_flag<const> = function(owner, tag, enabled)
	if enabled then
		owner:add_tag(tag)
		return
	end
	owner:remove_tag(tag)
end

local append_condition_reveal<const> = function(commands, condition)
	local event_name<const> = castle_map.condition_reveal_events[condition]
	if event_name ~= nil then
		commands[#commands + 1] = {
			op = 'emit_event',
			event = event_name,
		}
	end
end

local build_progression_program<const> = function()
	local rules<const> = {}
	local filters<const> = {}
	local filter_targets<const> = {}
	local reset_condition_set<const> = {
		['r106.wall'] = true,
		['r109.stairs'] = true,
	}
	local world1_marspein_destroyed_keys<const> = {}
	local region_reset_actions<const> = {
		{ key = 'r106.wall', value = false },
		{ key = 'r109.stairs', value = false },
	}
	local persistent_item_ids<const> = {}

	for _, room_template in pairs(castle_map.room_templates) do
		local room_number<const> = room_template.room_number
		local enemies<const> = room_template.enemies
		for i = 1, #enemies do
			local enemy_def<const> = enemies[i]
			local filter_index<const> = #filters + 1
			filters[filter_index] = enemy_def.conditions
			filter_targets[filter_index] = enemy_def
			if enemy_def.retain_defeat_in_region then
				rules[#rules + 1] = {
					id = enemy_def.id,
					on = 'damage.resolved',
					when_event = {
						equals = {
							target_id = enemy_def.id,
							destroyed = true,
						},
					},
					set = {
						{ key = enemy_def.id, value = true },
					},
				}
				region_reset_actions[#region_reset_actions + 1] = {
					key = enemy_def.id,
					value = false,
				}
			end
			local destroyed_condition<const> = enemy_def.destroyed_condition
			if destroyed_condition ~= nil then
				if not reset_condition_set[destroyed_condition] then
					reset_condition_set[destroyed_condition] = true
					region_reset_actions[#region_reset_actions + 1] = {
						key = destroyed_condition,
						value = false,
					}
				end
				local apply<const> = {
					{
						op = 'reconcile_room_condition',
						room_number = room_number,
						condition = destroyed_condition,
					},
				}
				append_condition_reveal(apply, destroyed_condition)
				rules[#rules + 1] = {
					id = 'condition.' .. enemy_def.id,
					on = 'damage.resolved',
					when_all = {
						{ key = destroyed_condition, equals = false },
					},
					when_event = {
						equals = {
							target_id = enemy_def.id,
							destroyed = true,
						},
					},
					set = {
						{ key = destroyed_condition, value = true },
					},
					apply = apply,
				}
			end
			if room_number == 106 and enemy_def.kind == 'marspeinenaardappel' then
				world1_marspein_destroyed_keys[#world1_marspein_destroyed_keys + 1] = enemy_def.id
			end
		end
		local items<const> = room_template.items
		for i = 1, #items do
			local item<const> = items[i]
			local filter_index<const> = #filters + 1
			filters[filter_index] = item.conditions
			filter_targets[filter_index] = item
			if world_item_inventory[item.item_type] then
				persistent_item_ids[#persistent_item_ids + 1] = item.id
			end
		end
		local inventory_rocks<const> = room_template.inventory_rocks
		for i = 1, #inventory_rocks do
			persistent_item_ids[#persistent_item_ids + 1] = 'drop.' .. inventory_rocks[i].id
		end
		local seal<const> = room_template.seal
		if seal ~= nil then
			local filter_index<const> = #filters + 1
			filters[filter_index] = seal.conditions
			filter_targets[filter_index] = seal
		end
	end
	for i = 1, #persistent_item_ids do
		local item_id<const> = persistent_item_ids[i]
		rules[#rules + 1] = {
			id = 'item.picked.' .. item_id,
			on = 'item.picked',
			when_event = {
				equals = {
					item_id = item_id,
				},
			},
			set = {
				{ key = 'item_picked_' .. item_id, value = true },
			},
		}
	end

	local stairs_apply<const> = {}
	append_condition_reveal(stairs_apply, 'r109.stairs')
	rules[#rules + 1] = {
		id = 'room.region_enter.progression_reset',
		on = 'room.region_enter',
		set = region_reset_actions,
	}
	rules[#rules + 1] = {
		id = 'r109.stairs.debug_seed',
		on = 'room.region_enter',
		when_all = {
			{ key = 'debug.world1_stairs', equals = true },
		},
		when_event = {
			equals = {
				world_number = 1,
			},
		},
		set = {
			{ key = 'r109.stairs', value = true },
		},
	}

	local stairs_latch_conditions<const> = {
		{ key = 'r109.stairs', equals = false },
		{ key = 'staff1destroyed', equals = true },
		{ key = 'staff2destroyed', equals = true },
		{ key = 'staff3destroyed', equals = true },
	}
	rules[#rules + 1] = {
		id = 'r109.stairs.set',
		on = 'damage.resolved',
		when_all = stairs_latch_conditions,
		when_event = {
			equals = {
				destroyed = true,
			},
		},
		set = {
			{ key = 'r109.stairs', value = true },
		},
		apply = stairs_apply,
	}

	local world1_wall_conditions<const> = {
		{ key = 'r106.wall', equals = false },
	}
	for i = 1, #world1_marspein_destroyed_keys do
		world1_wall_conditions[#world1_wall_conditions + 1] = {
			key = world1_marspein_destroyed_keys[i],
			equals = true,
		}
	end
	local world1_wall_apply<const> = {
		{
			op = 'reconcile_room_condition',
			room_number = 106,
			condition = 'r106.wall',
		},
	}
	append_condition_reveal(world1_wall_apply, 'r106.wall')
	rules[#rules + 1] = {
		id = 'r106.wall.set',
		on = 'damage.resolved',
		when_event = {
			equals = {
				destroyed = true,
			},
		},
		when_all = world1_wall_conditions,
		set = {
			{ key = 'r106.wall', value = true },
		},
		apply = world1_wall_apply,
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

	local program<const>, compiled_filters<const> = progression.compile_program({
		rules = rules,
		filters = filters,
		handlers = {
			['room.patch_rows'] = function(ctx, command)
				ctx.room:apply_progression_command(command)
			end,
			reconcile_room_condition = function(ctx, command, event)
				if command.room_number ~= ctx.current_room_number then
					return
				end
				room_spawner.reconcile_condition(ctx.room, command.condition, event.target_id)
			end,
			emit_event = function(ctx, command)
				ctx.events:emit(command.event)
			end,
		},
	})
	for i = 1, #filter_targets do
		filter_targets[i].progression_filter = compiled_filters[i]
	end
	return program
end

castle._progression_program = build_progression_program()

local create_room_switch<const> = function(from_room_number, to_room_number, direction)
	return {
		from_room_number = from_room_number,
		to_room_number = to_room_number,
		direction = direction,
	}
end

function castle:spawn_global_elevators()
	local routes<const> = castle_map.elevator_routes
	local elevators<const> = self.elevators
	for i = 1, #routes do
		local route<const> = routes[i]
		local start<const> = route.path[1]
		elevators[i] = world:spawn('elevator_platform', {
			id = 'e.p' .. tostring(i),
			space_id = 'main',
			castle = self,
			player = self.room.player,
			pos = { x = start.x, y = start.y, z = 21 },
			path = route.path,
			vertical_to_point = route.vertical_to_point,
			going_to = route.going_to,
			current_room_number = start.room_number,
		})
	end
end

function castle:sync_current_room_seal_instance()
	local room<const> = self.room
	local seal<const> = room.seal
	local seal_instance = self.seal_instance
	local keep_seal_instance<const> = seal ~= nil
		and room.seal_dissolve_step < 6
		and self:has_tag(castle_tags.seal_active)
	if not keep_seal_instance then
		if seal_instance ~= nil then
			seal_instance:mark_for_disposal()
			self.seal_instance = nil
		end
		return
	end
	if seal_instance ~= nil and seal_instance.id ~= seal.id then
		seal_instance:mark_for_disposal()
		seal_instance = nil
		self.seal_instance = nil
	end

	local dissolve_step<const> = room.seal_dissolve_step
	local sprite_id
	if dissolve_step > 0 then
		sprite_id = 'seal_dissolve_' .. tostring(dissolve_step)
	else
		sprite_id = 'seal'
	end

	if seal_instance == nil then
		seal_instance = world:spawn('seal', {
			id = seal.id,
			space_id = world.active_space_id,
			player_index = room.player.player_index,
			command = seal.text,
			pos = { x = seal.x, y = seal.y, z = 23 },
		})
		self.seal_instance = seal_instance
	else
		seal_instance:set_space(world.active_space_id)
		seal_instance.x = seal.x
		seal_instance.y = seal.y
		seal_instance:set_z(23)
	end

	seal_instance:set_imgid(sprite_id)
end

function castle:emit_room_state_changed()
	local room<const> = self.room
	local payload<const> = {
		room_number = self.current_room_number,
		world_number = room.world_number,
	}
	if self:has_tag(castle_tags.seal_active) then
		payload.has_active_seal = true
	else
		payload.has_active_seal = false
	end
	if self:has_tag(castle_tags.daemon_fight) then
		payload.daemon_fight_active = true
	else
		payload.daemon_fight_active = false
	end
	self.events:emit('room_state.changed', payload)
end

function castle:reset_room_encounter_tags()
	set_tag_flag(self, castle_tags.seal_active, false)
	set_tag_flag(self, castle_tags.seal_sequence, false)
	set_tag_flag(self, castle_tags.seal_dissolving, false)
	set_tag_flag(self, castle_tags.seal_broken, false)
	set_tag_flag(self, castle_tags.daemon_fight, false)
end

function castle:refresh_current_room_customizations()
	local room<const> = self.room
	local seal<const> = room.seal
	local world_boss_defeated<const> = self.world_boss_defeated[room.world_number]
	local has_active_seal = false
	if seal ~= nil then
		if self:has_tag(castle_tags.seal_broken) then
			if world_boss_defeated then
				has_active_seal = progression.matches(self, seal.progression_filter)
			else
				has_active_seal = false
			end
		else
			has_active_seal = progression.matches(self, seal.progression_filter)
		end
	end
	set_tag_flag(self, castle_tags.seal_active, has_active_seal)
	self:sync_current_room_seal_instance()
	self:emit_room_state_changed()
end

function castle:begin_seal_dissolution()
	local room<const> = self.room
	self.world_boss_defeated[room.world_number] = false
	set_tag_flag(self, castle_tags.seal_sequence, true)
	set_tag_flag(self, castle_tags.seal_dissolving, true)
	set_tag_flag(self, castle_tags.seal_broken, false)
	room.room_dissolve_step = 0
	room.seal_dissolve_step = 0
	room:rebuild_room_tiles()
	set_tag_flag(self, castle_tags.daemon_fight, false)
	self:emit_room_state_changed()
	self:sync_current_room_seal_instance()
end

function castle:apply_seal_timeline_frame(frame)
	local room<const> = self.room
	local room_dissolve_step = 0
	local seal_dissolve_step = 0
	local room_phase_start<const> = flow_seal_flash_frames + flow_seal_sprite_dissolve_frames
	if frame >= room_phase_start then
		seal_dissolve_step = flow_seal_sprite_dissolve_steps
		local progress<const> = frame - room_phase_start
		room_dissolve_step = ((progress * flow_seal_room_dissolve_steps) // flow_seal_room_dissolve_frames) + 1
	elseif frame >= flow_seal_flash_frames then
		local progress<const> = frame - flow_seal_flash_frames
		seal_dissolve_step = ((progress * flow_seal_sprite_dissolve_steps) // flow_seal_sprite_dissolve_frames) + 1
	end
	if room.room_dissolve_step ~= room_dissolve_step then
		room.room_dissolve_step = room_dissolve_step
		room:rebuild_room_tiles()
	end
	if room.seal_dissolve_step ~= seal_dissolve_step then
		room.seal_dissolve_step = seal_dissolve_step
		self:sync_current_room_seal_instance()
	end
end

function castle:finish_seal_dissolution()
	local room<const> = self.room
	set_tag_flag(self, castle_tags.seal_sequence, true)
	set_tag_flag(self, castle_tags.seal_dissolving, false)
	set_tag_flag(self, castle_tags.seal_broken, true)
	set_tag_flag(self, castle_tags.seal_active, false)
	set_tag_flag(self, castle_tags.daemon_fight, false)
	local row_patches<const> = {}
	for i = 1, #room.map_rows do
		local row<const> = room.map_rows[i]
		local patched_row<const> = row:gsub('%$', '.')
		if patched_row ~= row then
			row_patches[#row_patches + 1] = {
				index = i,
				value = patched_row,
			}
		end
	end
	if #row_patches > 0 then
		room:patch_rows(row_patches)
	end
	self:refresh_current_room_customizations()
	room_spawner.spawn_all_for_room(room)
end

function castle:begin_daemon_appearance()
	set_tag_flag(self, castle_tags.seal_sequence, true)
	set_tag_flag(self, castle_tags.seal_dissolving, false)
	set_tag_flag(self, castle_tags.daemon_fight, false)
	self:emit_room_state_changed()
end

function castle:mark_current_world_boss_defeated()
	local world_number<const> = self.room.world_number
	self.world_boss_defeated[world_number] = true
	set_tag_flag(self, castle_tags.seal_sequence, false)
	set_tag_flag(self, castle_tags.seal_dissolving, false)
	set_tag_flag(self, castle_tags.daemon_fight, false)
	set_tag_flag(self, castle_tags.seal_active, false)
	self:sync_current_room_seal_instance()
	self:emit_room_state_changed()
end

function castle:should_restart_daemon_appearance_after_death()
	local room<const> = self.room
	if room.seal == nil then
		return false
	end
	if self.world_boss_defeated[room.world_number] then
		return false
	end
	if self:has_tag(castle_tags.seal_broken) then
		return true
	end
	return false
end

function castle:begin_death_restart()
	if self:has_tag(castle_tags.seal_dissolving) then
		self:finish_seal_dissolution()
	end

	if self:should_restart_daemon_appearance_after_death() then
		self.death_restart_switch = nil
		return
	end

	local room<const> = self.room
	local world_number<const> = room.world_number
	local from_room_number<const> = self.current_room_number
	local switch
	if world_number == 0 then
		switch = create_room_switch(from_room_number, castle_map.start_room_number, 'death')
		switch.map_id = 0
		switch.map_x = 5
		switch.map_y = 12
		switch.spawn_x = player_start_x
		switch.spawn_y = player_start_y
		switch.spawn_facing = 1
	else
		local transition<const> = castle_map.world_transitions_by_number[world_number]
		switch = create_room_switch(from_room_number, transition.world_room_number, 'death')
		switch.map_id = world_number
		switch.map_x = transition.world_map_x
		switch.map_y = transition.world_map_y
		switch.spawn_x = transition.world_spawn_x
		switch.spawn_y = transition.world_spawn_y
		switch.spawn_facing = transition.world_spawn_facing
	end

	self.death_restart_switch = switch
	room_spawner.mark_all_for_disposal()
end

function castle:finish_death_restart()
	local switch<const> = self.death_restart_switch
	if switch == nil then
		self.room.player:restart_after_death()
		return true
	end

	self.death_restart_switch = nil
	local room<const> = self.room
	room:load_room(switch.to_room_number)
	self:commit_room_switch(switch, switch.map_id, switch.map_x, switch.map_y, false)
	local player<const> = room.player
	player:apply_spawn_position(switch)
	player:restart_after_death()
	player:emit_room_switched(switch.from_room_number, switch.to_room_number, switch.direction)
	return false
end

function castle:is_current_room_boss_encounter_active()
	local room<const> = self.room
	if room.seal == nil then
		return false
	end
	if self:has_tag(castle_tags.seal_sequence) then
		return true
	end
	if self:has_tag(castle_tags.daemon_fight) then
		return true
	end
	if self:has_tag(castle_tags.seal_broken) then
		return not self.world_boss_defeated[room.world_number]
	end
	return false
end

function castle:activate_current_room_daemon_fight()
	set_tag_flag(self, castle_tags.seal_sequence, false)
	set_tag_flag(self, castle_tags.daemon_fight, true)
	self:emit_room_state_changed()
end

function castle:ctor()
	self.elevators = {}
	self.room_enter_pending = false
	self:reset_room_encounter_tags()
	progression.mount(self, castle._progression_program)
end

function castle:unbind()
	world_object.unbind(self)
	progression.unmount(self)
end

function castle:sync_world_entrance_states_for_room(room_state)
	local world_entrances<const> = room_state.world_entrances
	for i = 1, #world_entrances do
		local target<const> = world_entrances[i].target
		if self.world_entrance_states[target] == nil then
			self.world_entrance_states[target] = {
				state = 'closed',
			}
		end
	end
end

function castle:create_room_enter_payload(suppress_room_music)
	local room<const> = self.room
	local payload<const> = {
		room_number = self.current_room_number,
		world_number = room.world_number,
	}
	if suppress_room_music ~= nil then
		payload.suppress_room_music = suppress_room_music
	elseif room.last_room_switch ~= nil then
		local direction<const> = room.last_room_switch.direction
		payload.suppress_room_music = room_music_suppressed_directions[direction] ~= nil
	else
		payload.suppress_room_music = false
	end
	if self:has_tag(castle_tags.seal_active) then
		payload.has_active_seal = true
	else
		payload.has_active_seal = false
	end
	if self:has_tag(castle_tags.daemon_fight) then
		payload.daemon_fight_active = true
	else
		payload.daemon_fight_active = false
	end
	return payload
end

function castle:emit_room_enter()
	self.room_enter_pending = false
	local payload<const> = self:create_room_enter_payload()
	self.events:emit('room.enter', payload)
end

function castle:commit_room_switch(switch, map_id, map_x, map_y, emit_room_enter_now)
	local room<const> = self.room
	local previous_world_number<const> = castle_map.room_templates[switch.from_room_number].world_number
	self.current_room_number = switch.to_room_number
	room.map_id = map_id
	room.map_x = map_x
	room.map_y = map_y
	room.last_room_switch = switch
	self:reset_room_encounter_tags()
	self:sync_world_entrance_states_for_room(room)
	if previous_world_number ~= room.world_number then
		self.events:emit('room.region_enter', {
			world_number = room.world_number,
		})
	end
	self:refresh_current_room_customizations()
	room_spawner.spawn_all_for_room(room)
	if emit_room_enter_now == nil or emit_room_enter_now then
		self:emit_room_enter()
	else
		self.room_enter_pending = true
	end
	return switch
end

function castle:initialize(initial_room_number, emit_room_enter_now)
	local rm<const> = self.room
	local room_number<const> = initial_room_number or castle_map.start_room_number
	rm:reset_rock_drops()
	self.current_room_number = room_number
	rm:load_room(room_number)
	rm.map_id = rm.world_number
	rm.map_x = 5
	rm.map_y = 12
	rm.last_room_switch = nil
	self.world_entrance_states = {}
	self.world_boss_defeated = {}
	self.room_enter_pending = false
	self:reset_room_encounter_tags()
	self:sync_world_entrance_states_for_room(rm)
	self:refresh_current_room_customizations()
	self:spawn_global_elevators()
	room_spawner.spawn_all_for_room(rm)
	if emit_room_enter_now == nil or emit_room_enter_now then
		self:emit_room_enter()
	else
		self.room_enter_pending = true
	end
end

function castle:begin_open_world_entrance(target)
	if self.world_entrance_states[target].state ~= 'closed' then
		return false
	end
	self.world_entrance_states[target].state = 'opening_1'
	self.events:emit('world_entrance.open.request', {
		target = target,
	})
	return true
end

function castle:switch_room(direction, player_top, player_bottom)
	local room<const> = self.room
	local switch<const> = room:switch_room(direction)

	if switch.outside then
		room.last_room_switch = switch
		return switch
	end

	local map_x = room.map_x
	local map_y = room.map_y
	if direction == 'left' then
		map_x = map_x - 1
	elseif direction == 'right' then
		map_x = map_x + 1
	elseif direction == 'up' then
		map_y = map_y - 1
	else
		map_y = map_y + 1
	end
	self:commit_room_switch(switch, room.world_number, map_x, map_y)
	return switch
end

function castle:enter_world(target)
	local transition<const> = castle_map.world_transitions[target]
	local from_room_number<const> = self.current_room_number
	local switch<const> = create_room_switch(from_room_number, transition.world_room_number, 'down')
	switch.world_number = transition.world_number
	switch.map_id = transition.world_number
	switch.map_x = transition.world_map_x
	switch.map_y = transition.world_map_y
	switch.spawn_x = transition.world_spawn_x
	switch.spawn_y = transition.world_spawn_y
	switch.spawn_facing = transition.world_spawn_facing
	local room<const> = self.room
	room:reset_rock_drops()
	room:load_room(switch.to_room_number)
	self:commit_room_switch(
		switch,
		switch.map_id,
		switch.map_x,
		switch.map_y,
		false
	)
	return switch
end

function castle:leave_world_to_castle(emit_room_enter_now)
	local room<const> = self.room
	local world_number<const> = room.world_number
	local from_room_number<const> = self.current_room_number

	local transition<const> = castle_map.world_transitions_by_number[world_number]

	room:reset_rock_drops()
	room:load_room(transition.castle_room_number)
	self.current_room_number = transition.castle_room_number
	local switch<const> = create_room_switch(from_room_number, self.current_room_number, 'world_leave')
	self:commit_room_switch(
		switch,
		0,
		transition.castle_map_x,
		transition.castle_map_y,
		emit_room_enter_now
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

function castle:halo_teleport_to_room_1(emit_room_enter_now)
	local room<const> = self.room
	local from_room_number<const> = self.current_room_number

	room:reset_rock_drops()
	room:load_room(halo_destination_room_number)
	self.current_room_number = halo_destination_room_number
	local switch<const> = create_room_switch(from_room_number, self.current_room_number, 'halo')
	self:commit_room_switch(switch, 0, 5, 12, emit_room_enter_now)
	switch.spawn_x = player_start_x
	switch.spawn_y = player_start_y
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

local define_castle_fsm<const> = function()
	fsm_library.register('castle', {
		initial = 'active',
		on = {
			['seal_dissolution'] = {
				emitter = 'd',
				go = function(self)
					self:begin_seal_dissolution()
				end,
			},
			['daemon_appearance'] = {
				emitter = 'd',
				go = function(self)
					self:begin_daemon_appearance()
				end,
			},
			['daemon_appearance_done'] = {
				emitter = 'd',
				go = function(self)
					self:activate_current_room_daemon_fight()
				end,
			},
			['seal_dissolution_done'] = {
				emitter = 'd',
				go = function(self)
					self:finish_seal_dissolution()
				end,
			},
			['world_entrance.opening_2'] = {
				emitter = 'c',
				go = function(self, _state, event)
					self.world_entrance_states[event.target].state = 'opening_2'
				end,
			},
			['world_entrance.opening_3'] = {
				emitter = 'c',
				go = function(self, _state, event)
					self.world_entrance_states[event.target].state = 'opening_3'
				end,
			},
			['world_entrance.opened'] = {
				emitter = 'c',
				go = function(self, _state, event)
					self.world_entrance_states[event.target].state = 'open'
				end,
			},
			['item.picked'] = {
				emitter = 'pietolon',
				go = function(self, _state, event)
					if event.item_type == 'keyworld1' then
						self:mark_current_world_boss_defeated()
					end
				end,
			},
			-- director emits 'room' when the room state becomes active; castle
			-- only flushes a deferred room.enter here for transitions that delayed it.
			['room'] = {
				emitter = 'd',
				go = function(self)
					if self.room_enter_pending then
						self:emit_room_enter()
					end
				end,
			},
		},
		states = {
			active = {},
		},
	})
end

local register_castle_definition<const> = function()
	prefab.define({
		def_id = 'castle',
		class = castle,
		components = { fsm_component.factory({ 'castle' }) },
		defaults = {
			id = 'c',
			current_room_number = 0,
			room_enter_pending = false,
		},
	})
end

return {
	castle = castle,
	define_castle_fsm = define_castle_fsm,
	register_castle_definition = register_castle_definition,
}
