local constants = require('constants')
local room_module = require('room')
local pepernoot_projectile_module = require('pepernoot_projectile')

local player_action_effects = {}

local effect_ids = {
	try_start_sword = 'p.e.try_sword',
	try_use_secondary = 'p.e.try_secondary',
	try_use_pepernoot = 'p.e.try_pepernoot',
	try_use_spyglass = 'p.e.try_spyglass',
}

function player_action_effects.attach_player_methods(player)
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
		local lithographs = service(constants.ids.castle_service_instance).current_room.lithographs
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
end

local function try_fire_pepernoot_effect(context)
	local owner = context.owner
	owner:refresh_active_pepernoot_projectiles()
	if #owner.pepernoot_projectile_ids >= constants.secondary_weapon.pepernoot_max_active then
		return
	end
	if owner.weapon_level < constants.secondary_weapon.pepernoot_weapon_level_cost then
		return
	end
	local room = service(constants.ids.castle_service_instance).current_room

	owner.pepernoot_projectile_sequence = owner.pepernoot_projectile_sequence + 1
	local projectile_id = string.format('pepernoot_%d_%d', owner.player_index, owner.pepernoot_projectile_sequence)
	local spawn_x = owner.x + (owner.facing < 0 and -constants.secondary_weapon.pepernoot_spawn_offset_x or constants.secondary_weapon.pepernoot_spawn_offset_x)
	local spawn_y = owner.y + constants.secondary_weapon.pepernoot_spawn_offset_y
	spawn_x, spawn_y = room_module.snap_world_to_tile(room, spawn_x, spawn_y)

	inst(pepernoot_projectile_module.pepernoot_projectile_def_id, {
		id = projectile_id,
		room = room,
		space_id = room.space_id,
		room_number = room.room_number,
		owner_id = owner.id,
		projectile_id = owner.pepernoot_projectile_sequence,
		direction = owner.facing,
		pos = { x = spawn_x, y = spawn_y, z = 113 },
	})

	owner.pepernoot_projectile_ids[#owner.pepernoot_projectile_ids + 1] = projectile_id
	owner.weapon_level = owner.weapon_level - constants.secondary_weapon.pepernoot_weapon_level_cost
end

local function try_use_secondary_effect(context)
	local owner = context.owner
	local weapon = owner.secondary_weapon
	if weapon == 'none' then
		return
	end
	if weapon == 'pepernoot' then
		owner.actioneffects:trigger(effect_ids.try_use_pepernoot)
		return
	end
	if weapon == 'spyglass' then
		owner.actioneffects:trigger(effect_ids.try_use_spyglass)
		return
	end
	error('pietious player invalid secondary_weapon=' .. tostring(weapon))
end

function player_action_effects.define_player_effects(state_tags)
	define_effect({
		id = effect_ids.try_start_sword,
		handler = function(context)
			context.owner:try_start_sword_state()
		end,
	})
	define_effect({
		id = effect_ids.try_use_secondary,
		blocked_tags = { state_tags.group.damage_lock },
		handler = try_use_secondary_effect,
	})
	define_effect({
		id = effect_ids.try_use_pepernoot,
		can_trigger = function(context)
			local owner = context.owner
			if owner:has_tag(state_tags.group.stairs) then
				return owner:has_tag(state_tags.variant.quiet_stairs)
			end
			return true
		end,
		handler = try_fire_pepernoot_effect,
	})
	define_effect({
		id = effect_ids.try_use_spyglass,
		required_tags = { state_tags.ability.spyglass },
		handler = function(context)
			local owner = context.owner
			local lithograph = owner:find_near_lithograph()
			if lithograph == nil then
				return
			end
		end,
	})
end

player_action_effects.effect_ids = effect_ids

return player_action_effects
