local constants<const> = require('constants')
local castle_map<const> = require('castle/map')
local progression<const> = require('progression')
local room_spawner<const> = require('room/spawner')

local castle<const> = {}

local world1_stairs_open_row<const> = '#............................-=#'
local halo_destination_room_number<const> = 1
local director_seal_frame_event<const> = 'timeline.frame.director.seal'
local castle_tags<const> = {
	seal_active = 'c.seal.active',
	seal_sequence = 'c.seal.sequence',
	seal_dissolving = 'c.seal.diss',
	seal_broken = 'c.seal.broken',
	daemon_fight = 'c.daemon.fight',
}

local current_room<const> = function()
	return oget('room')
end

local set_tag_flag<const> = function(owner, tag, enabled)
	if enabled then
		owner:add_tag(tag)
		return
	end
	owner:remove_tag(tag)
end

local build_progression_program<const> = function()
	local rules<const> = {}
	local condition_name_set<const> = {}
	local condition_names<const> = {}
	local world1_marspein_destroyed_keys<const> = {}

	for _, room_template in pairs(castle_map.room_templates) do
		local room_number<const> = room_template.room_number
		local enemies<const> = room_template.enemies
		for i = 1, #enemies do
			local enemy_def<const> = enemies[i]
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
		local condition_name<const> = condition_names[i]
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
		on = 'damage.resolved',
		when_event = {
			equals = {
				target_kind = 'cloud',
				destroyed = true,
			},
		},
		set = {
			{ key = 'cloud_1_destroyed', value = true },
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
		when_event = {
			equals = {
				destroyed = true,
			},
		},
		when_all = stairs_latch_conditions,
		set = {
			{ key = 'r109.stairs', value = true },
		},
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
		apply = {
			{
				op = 'emit_event',
				event = 'room.condition_set',
				payload = {
					room_number = 106,
					condition = 'r106.wall',
					play_appearance = true,
				},
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
				event = 'appearance',
			},
		},
	}
	rules[#rules + 1] = {
		id = 'damage.resolved.refresh',
		on = 'damage.resolved',
		when_event = {
			equals = {
				destroyed = true,
			},
		},
		apply = {
			{ op = 'refresh_current_room_enemies' },
		},
	}

	return progression.compile_program({
		rules = rules,
		handlers = {
			['room.patch_rows'] = function(ctx, command)
				current_room():apply_progression_command(command)
			end,
			refresh_current_room_enemies = function(ctx, command, event)
				local room<const> = current_room()
				if event.room_number == ctx.current_room_number then
					ctx:refresh_current_room_customizations()
					room_spawner.spawn_all_for_room(room)
				end
			end,
			apply_room_condition = function(ctx, command, event)
				local room<const> = current_room()
				if event.room_number ~= ctx.current_room_number then
					return
				end
				ctx:refresh_current_room_customizations()
				room_spawner.spawn_all_for_room(room)
				if event.play_appearance then
					ctx.events:emit('appearance')
				end
			end,
			emit_event = function(ctx, command)
				local payload<const> = {}
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

local create_room_switch<const> = function(from_room_number, to_room_number, direction)
	return {
		from_room_number = from_room_number,
		to_room_number = to_room_number,
		direction = direction,
	}
end

function castle:spawn_global_elevators()
	local routes<const> = castle_map.elevator_routes
	self.elevator_count = #routes
	for i = 1, #routes do
		local route<const> = routes[i]
		local elevator_id<const> = 'e.p' .. tostring(i)
		if oget(elevator_id) == nil then
			local start<const> = route.path[1]
			inst('elevator_platform', {
				id = elevator_id,
				space_id = 'main',
				pos = { x = start.x, y = start.y, z = 21 },
				path = route.path,
				vertical_to_point = route.vertical_to_point,
				going_to = route.going_to,
				current_room_number = start.room_number,
			})
		end
	end
end

function castle:sync_current_room_seal_instance()
	local room<const> = current_room()
	local seal<const> = room.seal
	if seal == nil then
		return
	end
	local active_space<const> = get_space()

	local seal_instance = oget(seal.id)
	local keep_seal_instance = false
	if self:has_tag(castle_tags.seal_active) then
		keep_seal_instance = true
	end
	if self:has_tag(castle_tags.seal_sequence) then
		keep_seal_instance = true
	end
	if not keep_seal_instance then
		if seal_instance ~= nil then
			seal_instance:mark_for_disposal()
		end
		return
	end

	local dissolve_step<const> = room.seal_dissolve_step
	if dissolve_step >= 6 then
		if seal_instance ~= nil then
			seal_instance:mark_for_disposal()
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

function castle:emit_room_state_changed()
	local room<const> = current_room()
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
	local room<const> = current_room()
	local seal<const> = room.seal
	local world_boss_defeated<const> = self.world_boss_defeated[room.world_number]
	local has_active_seal = false
	if seal ~= nil then
		if self:has_tag(castle_tags.seal_broken) then
			if world_boss_defeated then
				has_active_seal = progression.matches(self, seal.conditions)
			else
				has_active_seal = false
			end
		else
			has_active_seal = progression.matches(self, seal.conditions)
		end
	end
	set_tag_flag(self, castle_tags.seal_active, has_active_seal)
	self:sync_current_room_seal_instance()
	self:emit_room_state_changed()
end

function castle:begin_seal_dissolution()
	local room<const> = current_room()
	self.world_boss_defeated[room.world_number] = false
	set_tag_flag(self, castle_tags.seal_sequence, true)
	set_tag_flag(self, castle_tags.seal_dissolving, true)
	set_tag_flag(self, castle_tags.seal_broken, false)
	room.room_dissolve_step = 0
	room.seal_dissolve_step = 0
	room:rebuild_room_tiles()
	set_tag_flag(self, castle_tags.daemon_fight, false)
	self:apply_seal_timeline_frame(1)
	self:emit_room_state_changed()
	self:sync_current_room_seal_instance()
end

function castle:apply_seal_timeline_frame(frame)
	local room<const> = current_room()
	local room_dissolve_step = 0
	local seal_dissolve_step = 0
	if frame >= 32 then
		if frame < 64 then
			local progress<const> = frame - 32
			room_dissolve_step = ((progress * constants.flow.seal_room_dissolve_steps) // 32) + 1
		else
			room_dissolve_step = constants.flow.seal_room_dissolve_steps
		end
	end
	if frame >= 64 then
		local progress = frame - 64
		if progress > 31 then
			progress = 31
		end
		seal_dissolve_step = ((progress * constants.flow.seal_sprite_dissolve_steps) // 32) + 1
	end
	if room_dissolve_step > constants.flow.seal_room_dissolve_steps then
		room_dissolve_step = constants.flow.seal_room_dissolve_steps
	end
	if seal_dissolve_step > constants.flow.seal_sprite_dissolve_steps then
		seal_dissolve_step = constants.flow.seal_sprite_dissolve_steps
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
	local room<const> = current_room()
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
	local world_number<const> = current_room().world_number
	self.world_boss_defeated[world_number] = true
	set_tag_flag(self, castle_tags.seal_sequence, false)
	set_tag_flag(self, castle_tags.seal_dissolving, false)
	set_tag_flag(self, castle_tags.daemon_fight, false)
	set_tag_flag(self, castle_tags.seal_active, false)
	self:sync_current_room_seal_instance()
	self:emit_room_state_changed()
end

function castle:should_restart_daemon_appearance_after_death()
	local room<const> = current_room()
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

function castle:resolve_death()
	if self:has_tag(castle_tags.seal_dissolving) then
		self:finish_seal_dissolution()
	end
	self.events:emit('death_resolved', { restart_daemon = self:should_restart_daemon_appearance_after_death() })
end

function castle:is_current_room_boss_encounter_active()
	local room<const> = current_room()
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
	self.world_boss_defeated = {}
	self.room_enter_pending = false
	self:reset_room_encounter_tags()
	progression.mount(self, build_progression_program())
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
	local room<const> = current_room()
	local payload<const> = {
		room_number = self.current_room_number,
		world_number = room.world_number,
	}
	if suppress_room_music ~= nil then
		payload.suppress_room_music = suppress_room_music
	elseif room.last_room_switch ~= nil and room.last_room_switch.direction == 'world_leave' then
		payload.suppress_room_music = true
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
	local room<const> = current_room()
	self.current_room_number = switch.to_room_number
	room.map_id = map_id
	room.map_x = map_x
	room.map_y = map_y
	room.last_room_switch = switch
	self:reset_room_encounter_tags()
	self:sync_world_entrance_states_for_room(room)
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
	local rm<const> = oget('room')
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
	local room<const> = current_room()
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
	local room<const> = current_room()
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
	local room<const> = current_room()
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
	local room<const> = current_room()
	local from_room_number<const> = self.current_room_number

	room:reset_rock_drops()
	room:load_room(halo_destination_room_number)
	self.current_room_number = halo_destination_room_number
	local switch<const> = create_room_switch(from_room_number, self.current_room_number, 'halo')
	self:commit_room_switch(switch, 0, 5, 12, emit_room_enter_now)
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

local define_castle_fsm<const> = function()
	define_fsm('castle', {
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
			[director_seal_frame_event] = {
				emitter = 'd',
				go = function(self, _state, event)
					self:apply_seal_timeline_frame(event.frame_value + 1)
				end,
			},
			['world_entrance.opening_2'] = {
				emitter = 'c',
				go = function(self, _state, event)
					self.world_entrance_states[event.target].state = 'opening_2'
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
			-- director emits this when the player has died; castle resolves internal
			-- state (seal tags) and replies with 'death_resolved' { restart_daemon = bool }.
			['player.death_resolve'] = {
				emitter = 'd',
				go = function(self)
					self:resolve_death()
				end,
			},
		},
		states = {
			active = {},
		},
	})
end

local register_castle_definition<const> = function()
	define_prefab({
		def_id = 'castle',
		class = castle,
		fsms = { 'castle' },
		defaults = {
			id = 'c',
			current_room_number = 0,
			world_entrance_states = {},
			world_boss_defeated = {},
			room_enter_pending = false,
		},
	})
end

return {
	castle = castle,
	define_castle_fsm = define_castle_fsm,
	register_castle_definition = register_castle_definition,
}
