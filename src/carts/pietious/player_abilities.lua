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

	inst('pepernoot_projectile.def', {
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
	return true
end

local function activate_spyglass_ability(owner, state_tags)
	if owner:has_tag(state_tags.group.damage_lock) then
		return false
	end
	local lithograph = owner:find_near_lithograph()
	if lithograph == nil then
		return false
	end
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

	function player:find_near_lithograph()
		local lithographs = service('c').current_room.lithographs
		local player_left = self.x
		local player_top = self.y
		local player_right = self.x + self.width
		local player_bottom = self.y + self.height

		for i = 1, #lithographs do
			local lithograph = lithographs[i]
			local area_left = lithograph.x + constants.lithograph.hit_left_px
			local area_top = lithograph.y + constants.lithograph.hit_top_px
			local area_right = lithograph.x + constants.lithograph.hit_right_px
			local area_bottom = lithograph.y + constants.lithograph.hit_bottom_px
			if player_right >= area_left and player_left <= area_right and player_bottom >= area_top and player_top <= area_bottom then
				return lithograph
			end
		end

		return nil
	end

	function player:equip_subweapon(id)
		local next_id = id or 'none'
		self:remove_tag(equip_tags.pepernoot)
		self:remove_tag(equip_tags.spyglass)
		self.secondary_weapon = next_id
		local grant_tag = equip_tags[next_id]
		if grant_tag ~= nil then
			self:add_tag(grant_tag)
		end
	end
end

player_abilities.command_ids = command_ids
player_abilities.equip_tags = equip_tags

return player_abilities
