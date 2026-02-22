local constants = require('constants')
local room_module = require('room')

local player_abilities = {}

local equip_tags = {
	pepernoot = 'eq.pn',
	spyglass = 'eq.spy',
}

local command_ids = {
	activate_sword = 'cmd.ability.activate.sword',
	activate_pepernoot = 'cmd.ability.activate.pepernoot',
	activate_spyglass = 'cmd.ability.activate.spyglass',
}

local function activate_sword_ability(owner, state_tags)
	if owner:has_tag(state_tags.group.damage_lock) then
		return false
	end
	if owner:has_tag(state_tags.group.sword) then
		return false
	end

	local event_name
	if owner:has_tag(state_tags.variant.quiet) then
		event_name = 'sword_start_quiet'
		owner.sword_ground_origin = 'quiet'
	elseif owner:has_tag(state_tags.group.movement_walk) then
		if owner:has_tag(state_tags.variant.walking_left) then
			owner.sword_ground_origin = 'walking_left'
			event_name = 'sword_start_walking_left'
		else
			owner.sword_ground_origin = 'walking_right'
			event_name = 'sword_start_walking_right'
		end
	elseif owner:has_tag(state_tags.group.movement_jump) then
		if owner:has_tag(state_tags.variant.stopped_jumping) then
			event_name = 'sword_start_stopped_jumping'
		elseif owner:has_tag(state_tags.variant.controlled_fall) then
			event_name = 'sword_start_controlled_fall'
		else
			event_name = 'sword_start_jumping'
		end
	elseif owner:has_tag(state_tags.variant.uncontrolled_fall) then
		event_name = 'sword_start_uncontrolled_fall'
	elseif owner:has_tag(state_tags.variant.quiet_stairs) then
		event_name = 'sword_start_stairs'
	else
		return false
	end

	owner:force_seek_timeline('p.seq.s', 0)
	owner:dispatch_state_event(event_name)
	return true
end

local function activate_pepernoot_ability(owner, state_tags)
	if owner:has_tag(state_tags.group.damage_lock) then
		return false
	end
	if owner:has_tag(state_tags.group.stairs) then
		if not owner:has_tag(state_tags.variant.quiet_stairs) then
			return false
		end
	end

	owner:refresh_active_pepernoot_projectiles()
	if #owner.pepernoot_projectile_ids >= constants.secondary_weapon.pepernoot_max_active then
		return false
	end
	if owner.weapon_level < constants.secondary_weapon.pepernoot_weapon_level_cost then
		return false
	end
	local room = service('c').current_room

	owner.pepernoot_projectile_sequence = owner.pepernoot_projectile_sequence + 1
	local projectile_id = string.format('pepernoot_%d_%d', owner.player_index, owner.pepernoot_projectile_sequence)
	local spawn_x = owner.x + (owner.facing < 0 and -constants.secondary_weapon.pepernoot_spawn_offset_x or constants.secondary_weapon.pepernoot_spawn_offset_x)
	local spawn_y = owner.y + constants.secondary_weapon.pepernoot_spawn_offset_y
	spawn_x, spawn_y = room_module.snap_world_to_tile(room, spawn_x, spawn_y)

	inst('pepernoot_projectile', {
		id = projectile_id,
		room = room,
		space_id = room.space_id,
		room_number = room.room_number,
		owner_id = owner.id,
		direction = owner.facing,
		pos = { x = spawn_x, y = spawn_y, z = 113 },
	})

	owner.pepernoot_projectile_ids[#owner.pepernoot_projectile_ids + 1] = projectile_id
	owner.weapon_level = owner.weapon_level - constants.secondary_weapon.pepernoot_weapon_level_cost
	owner.events:emit('evt.cue.fire_pepernoot', {})
	return true
end

local function activate_spyglass_ability(owner, state_tags)
	if owner:has_tag(state_tags.group.damage_lock) then
		return false
	end
	local lithograph = room_module.find_near_lithograph(service('c').current_room, owner)
	if lithograph == nil then
		return false
	end
	owner.events:emit('lithograph.request', {
		text_line = lithograph.text,
	})
	return true
end

local function activate_halo_ability(owner)
	if not owner.inventory_items.halo then
		return false
	end
	owner:teleport_to_halo_destination()
	return true
end

function player_abilities.build_input_action_effect_program()
	return {
		eval = 'all',
		bindings = {
			{
				name = 'pepernoot',
				when = {
					mode = {
						tag = equip_tags.pepernoot,
					},
				},
				on = { press = 'b[jp]' },
				go = {
					press = {
						['dispatch.command'] = {
							event = command_ids.activate_pepernoot,
						},
					},
				},
			},
			{
				name = 'spyglass',
				when = {
					mode = {
						tag = equip_tags.spyglass,
					},
				},
				on = { press = 'b[jp]' },
				go = {
					press = {
						['dispatch.command'] = {
							event = command_ids.activate_spyglass,
						},
					},
				},
			},
			{
				name = 'sword',
				on = { press = 'x[jp]' },
				go = {
					press = {
						['dispatch.command'] = {
							event = command_ids.activate_sword,
						},
					},
				},
			},
		},
	}
end

function player_abilities.configure_player_abilities(player, state_tags)
	player.abilities:register_ability('sword', {
			activate = function(context)
				return activate_sword_ability(context.owner, state_tags)
			end,
		})
	player.abilities:register_ability('pepernoot', {
			activate = function(context)
				return activate_pepernoot_ability(context.owner, state_tags)
			end,
		})
	player.abilities:register_ability('spyglass', {
			activate = function(context)
				return activate_spyglass_ability(context.owner, state_tags)
			end,
		})
	player.abilities:register_ability('halo', {
			activate = function(context)
				return activate_halo_ability(context.owner)
			end,
		})
end

function player_abilities.attach_player_methods(player)
	function player:refresh_active_pepernoot_projectiles()
		local ids = self.pepernoot_projectile_ids
		local write_index = 1
		for i = 1, #ids do
			local id = ids[i]
			if object(id) ~= nil then
				ids[write_index] = id
				write_index = write_index + 1
			end
		end
		for i = write_index, #ids do
			ids[i] = nil
		end
	end

	function player:equip_subweapon(id)
		local next_id = id
		self:remove_tag(equip_tags.pepernoot)
		self:remove_tag(equip_tags.spyglass)
		self.secondary_weapon = next_id
		local grant_tag = equip_tags[next_id or 'none']
		if grant_tag ~= nil then
			self:add_tag(grant_tag)
		end
	end

	function player:teleport_to_halo_destination()
		local director_service = service('d')
		director_service:dispatch_state_event('halo_transition_start')
		local switch = director_service:halo_teleport_to_start_room()
		local castle_service = service('c')

		self.x = constants.room.tile_size * 23
		self.y = constants.player.start_y
		self.facing = 1
		self.last_dx = 0
		self.last_dy = 0
		self.stairs_direction = 0
		self.stairs_x = -1
		self.hit_stairs_lock = false
		self.enter_leave_world_target = ''
		self.enter_leave_shrine_text_lines = {}
		self.enter_leave_wait_started = false
		self.transition_step = 0
		self.to_enter_cut = 0

		self.abilities:end_once('sword', 'halo')
		self:force_seek_timeline('p.seq.s', 0)
		self:reset_fall_substate_sequence()
		self:dispatch_state_event('stairs_lock_lost_after_room_switch')
		self.events:emit('room.switched', {
			from = switch.from_room_number,
			to = switch.to_room_number,
			dir = switch.direction,
			space = castle_service.current_room.space_id,
			x = self.x,
			y = self.y,
		})
		director_service:dispatch_state_event('halo_transition_done')
	end
end

player_abilities.command_ids = command_ids
player_abilities.equip_tags = equip_tags

return player_abilities
