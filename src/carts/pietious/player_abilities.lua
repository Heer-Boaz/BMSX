local constants = require('constants')
local room_module = require('room')
local action_effects = require('action_effects')

local player_abilities = {}

player_abilities.equip_tags = {
	pepernoot = 'eq.pn',
	spyglass = 'eq.spy',
}

player_abilities.command_ids = {
	activate_sword = 'cmd.ability.activate.sword',
}

function player_abilities.activate_sword(owner)
	if owner:has_tag('g.dl') then
		return false
	end
	if owner:has_tag('g.sw') then
		return false
	end
	owner:force_seek_timeline('p.seq.s', 0)
	owner.events:emit('sword_start', {})
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
		local live_count = 0
		for i = 1, #owner.pepernoot_projectile_ids do
			if object(owner.pepernoot_projectile_ids[i]) ~= nil then
				live_count = live_count + 1
			end
		end
		if live_count >= constants.secondary_weapon.pepernoot_max_active then
			return false
		end
		if owner.weapon_level < constants.secondary_weapon.pepernoot_weapon_level_cost then
			return false
		end
		return true
	end,
	handler = function(context)
		local owner = context.owner
		owner:refresh_active_pepernoot_projectiles()
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
		return room_module.find_near_lithograph(service('c').current_room, context.owner) ~= nil
	end,
	handler = function(context)
		local lithograph = room_module.find_near_lithograph(service('c').current_room, context.owner)
		context.owner.events:emit('lithograph.request', {
			text_line = lithograph.text,
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
						tag = player_abilities.equip_tags.pepernoot,
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
						tag = player_abilities.equip_tags.spyglass,
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
							event = player_abilities.command_ids.activate_sword,
						},
					},
				},
			},
		},
	}
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
		self:remove_tag(player_abilities.equip_tags.pepernoot)
		self:remove_tag(player_abilities.equip_tags.spyglass)
		self.secondary_weapon = next_id
		local grant_tag = player_abilities.equip_tags[next_id or 'none']
		if grant_tag ~= nil then
			self:add_tag(grant_tag)
		end
	end
end

return player_abilities
