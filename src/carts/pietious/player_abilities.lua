local constants = require('constants')
local room_module = require('room')
local action_effects = require('action_effects')

local player_abilities = {}

local equip_tags = {
	pepernoot = 'eq.pn',
	spyglass = 'eq.spy',
}

player_abilities.command_ids = {
	activate_sword = 'cmd.ability.activate.sword',
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
	owner.events:emit(event_name, {})
	return true
end

action_effects.register_effect('pepernoot', {
	id = 'pepernoot',
	blocked_tags = { 'g.dl' },
	can_trigger = function(context)
		local owner = context.owner
		if owner:has_tag('g.st') then
			if not owner:has_tag('v.qst') then
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
		return true
	end,
	handler = function(context)
		local owner = context.owner
		local room = service('c').current_room
		owner.pepernoot_projectile_sequence = owner.pepernoot_projectile_sequence + 1
		local projectile_id = string.format('pepernoot_%d_%d', owner.player_index, owner.pepernoot_projectile_sequence)
		local spawn_x = owner.x + (owner.facing < 0 and -constants.secondary_weapon.pepernoot_spawn_offset_x or constants.secondary_weapon.pepernoot_spawn_offset_x)
		local spawn_y = owner.y + constants.secondary_weapon.pepernoot_spawn_offset_y
		spawn_x, spawn_y = room_module.snap_world_to_tile(room, spawn_x, spawn_y)
		inst('pepernoot_projectile', {
			id = projectile_id,
			room = room,
			room_number = room.room_number,
			owner_id = owner.id,
			direction = owner.facing,
			pos = { x = spawn_x, y = spawn_y, z = 113 },
		})
		owner.pepernoot_projectile_ids[#owner.pepernoot_projectile_ids + 1] = projectile_id
		owner.weapon_level = owner.weapon_level - constants.secondary_weapon.pepernoot_weapon_level_cost
		owner.events:emit('evt.cue.fire_pepernoot', {})
	end,
})

action_effects.register_effect('spyglass', {
	id = 'spyglass',
	blocked_tags = { 'g.dl' },
	can_trigger = function(context)
		local lithograph = room_module.find_near_lithograph(service('c').current_room, context.owner)
		if lithograph == nil then
			return false
		end
		context.lithograph = lithograph
		return true
	end,
	handler = function(context)
		context.owner.events:emit('lithograph.request', {
			text_line = context.lithograph.text,
		})
	end,
})

action_effects.register_effect('halo', {
	id = 'halo',
	can_trigger = function(context)
		if not context.owner.inventory_items.halo then
			return false
		end
		if service('c').current_room.daemon_fight_active then
			return false
		end
		return true
	end,
	handler = function(context)
		service('d'):perform_halo_teleport(context.owner)
	end,
})

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
						['effect.trigger'] = 'pepernoot',
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
						['effect.trigger'] = 'spyglass',
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
end

function player_abilities.attach_player_methods(player)
	function player:refresh_active_pepernoot_projectiles()
		local write_index = 1
		for i = 1, #self.pepernoot_projectile_ids do
			if object(self.pepernoot_projectile_ids[i]) ~= nil then
				self.pepernoot_projectile_ids[write_index] = self.pepernoot_projectile_ids[i]
				write_index = write_index + 1
			end
		end
		for i = write_index, #self.pepernoot_projectile_ids do
			self.pepernoot_projectile_ids[i] = nil
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

	function player:apply_halo_teleport_arrival(switch)
		self.x = switch.spawn_x
		self.y = switch.spawn_y
		self.facing = switch.spawn_facing
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
		self.events:emit('stairs_lock_lost_after_room_switch', {})
		self.events:emit('room.switched', {
			from = switch.from_room_number,
			to = switch.to_room_number,
			dir = switch.direction,
			x = self.x,
			y = self.y,
		})
	end
end

player_abilities.equip_tags = equip_tags

return player_abilities
