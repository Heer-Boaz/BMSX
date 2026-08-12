local world<const> = require('cartlib/world/world')
require('constants')
local actioneffects<const> = require('cartlib/actioneffects')

local player_actioneffects<const> = {}
local _pepernoot_projectiles<const> = world:active_definition_view('pepernoot_projectile')

player_actioneffects.tags = {
	sword_activation_allowed = 'g.sa',
	stairs_action_allowed = 'g.saa',
}

player_actioneffects.equip_tags = {
	pepernoot = 'eq.pn',
	spyglass = 'eq.spy',
}

player_actioneffects.command_ids = {
	activate_sword = 'cmd.actioneffect.activate.sword',
}

actioneffects.register_effect('pepernoot', {
	blocked_tags = { 'g.dl' },
	can_trigger = function(owner)
		if not owner:has_tag(player_actioneffects.tags.stairs_action_allowed) then
			return false
		end
		local live_count = 0
		local projectiles<const> = _pepernoot_projectiles.objects
		for i = 1, #projectiles do
			local proj<const> = projectiles[i]
			if proj.owner_id == owner.id then
				live_count = live_count + 1
			end
		end
		if live_count >= secondary_weapon_pepernoot_max_active then
			return false
		end
		if owner.weapon_level < secondary_weapon_pepernoot_weapon_level_cost then
			return false
		end
		return true
	end,
	handler = function(owner)
		local room<const> = owner.room
		owner.pepernoot_projectile_sequence = owner.pepernoot_projectile_sequence + 1
		local projectile_id<const> = string.format('pepernoot_%d_%d', owner.player_index, owner.pepernoot_projectile_sequence)
		local spawn_x = owner.x + (owner.facing < 0 and -secondary_weapon_pepernoot_spawn_offset_x or secondary_weapon_pepernoot_spawn_offset_x)
		local spawn_y = owner.y + secondary_weapon_pepernoot_spawn_offset_y
		spawn_x, spawn_y = room:snap_world_to_tile(spawn_x, spawn_y)
		world:spawn('pepernoot_projectile', {
			id = projectile_id,
			room = room,
			room_number = owner.castle.current_room_number,
			owner_id = owner.id,
			direction = owner.facing,
			pos = { x = spawn_x, y = spawn_y, z = 113 },
		})
		-- owner.weapon_level = owner.weapon_level - secondary_weapon_pepernoot_weapon_level_cost
		owner:emit_weapon_changed()
		owner.events:emit('fire_pepernoot')
	end,
})

actioneffects.register_effect('spyglass', {
	blocked_tags = { 'g.dl' },
	can_trigger = function(owner)
		return owner.room:find_near_lithograph(owner) ~= nil
	end,
	handler = function(owner)
		local lithograph<const> = owner.room:find_near_lithograph(owner)
		owner.events:emit('lithograph.request', {
			text_line = lithograph.text,
		})
	end,
})

actioneffects.register_effect('halo', {
	blocked_tags = { 'g.tr' },
	can_trigger = function(owner)
		local castle<const> = owner.castle
		if not owner.inventory_items.halo then
			return false
		end
		if castle:is_current_room_boss_encounter_active() then
			return false
		end
		return true
	end,
	handler = function(owner)
		local castle<const> = owner.castle
		local from_world<const> = (owner.room.world_number or 0) ~= 0
		if from_world then
			castle:halo_teleport_to_room_1(false)
			owner:begin_waiting_halo_banner()
			owner.events:emit('halo_resolved_from_world')
			return
		end
		local switch<const> = castle:halo_teleport_to_room_1(true)
		owner:apply_halo_teleport_arrival(switch)
		owner.events:emit('halo_resolved_in_castle')
	end,
})

function player_actioneffects.build_input_actioneffect_program()
	return {
		eval = 'all',
		bindings = {
			{
				name = 'pepernoot',
				when = {
					mode = {
						tag = player_actioneffects.equip_tags.pepernoot,
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
						tag = player_actioneffects.equip_tags.spyglass,
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
							event = player_actioneffects.command_ids.activate_sword,
						},
					},
				},
			},
		},
	}
end

return player_actioneffects
