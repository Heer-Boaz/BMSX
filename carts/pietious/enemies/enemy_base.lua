local world<const> = require('cartlib/world/world')
local combat_overlap<const> = require('combat/overlap')
local combat_damage<const> = require('combat/damage')
require('constants')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local screen_boundary_component<const> = require('cartlib/physics/screen_boundary_component')

local enemy_base<const> = {}
local damaging_contact_kinds<const> = {
	sword = true,
	projectile = true,
}

function enemy_base.new_collider(opts)
	local collider<const> = collider_2d_component.new_for_sprite(opts)
	collider.layer = collision_enemy_layer
	collider.mask = collision_enemy_mask
	return collider
end

-- Attaches projectile boundary behaviour with the room bounds. The shared
-- bind() below owns its event subscriptions after construction is complete.
-- Call from the ctor of projectile-type enemies only (vlokfoe, nootfoe, etc.).
function enemy_base.setup_projectile_boundary(self)
	self:add_component(screen_boundary_component.new({
		left = 0,
		top = room_hud_height,
		right = room_width,
		bottom = room_height,
	}))
end

function enemy_base.on_space_event(self, event_type)
	if event_type == 'shrine_transition_enter' then
		self:set_space('transition')
	else
		self:set_space('main')
	end
end

function enemy_base.bind_lifecycle(self)
	self.events:on({
		event = 'shrine_transition_enter',
		handler = enemy_base.on_space_event,
	})
	self.events:on({
		event = 'world_transition',
		emitter = 'd',
		handler = self.mark_for_disposal,
	})
	self.events:on({
		event = 'room',
		emitter = 'd',
		handler = enemy_base.on_space_event,
	})

	if self:get_component(screen_boundary_component) ~= nil then
		self.events:on({
			event = 'screen.leave',
			handler = self.mark_for_disposal,
		})
		self.events:on({
			event = 'room.switched',
			emitter = 'pietolon',
			handler = self.mark_for_disposal,
		})
	end
end

function enemy_base.bind(self)
	self.events:on({
		event = 'overlap.begin',
		handler = enemy_base.on_overlap,
	})
	enemy_base.bind_lifecycle(self)
end

function enemy_base.spawn_death_effect(self)
	world:spawn('enemy_explosion', {
		room = self.room,
		player = self.player,
		loot_type = self:choose_drop_type(),
		pos = { x = self.x, y = self.y, z = 114 },
	})
end

function enemy_base.apply_damage(self, request)
	self.health = self.health - 1
	if self.health <= 0 then
		self.health = 0
		self.dangerous = false
		return combat_damage.build_applied_result(request, 1, true, 'destroyed')
	end
	return combat_damage.build_applied_result(request, 1, false, 'damaged')
end

function enemy_base.process_damage_result(self, result)
	if result.status == 'rejected' then
		return
	end
	if result.destroyed then
		self:spawn_death_effect()
		if self.trigger ~= nil then
			self.castle.events:emit('room.condition_set', {
				room_number = result.room_number,
				condition = self.trigger,
			})
		end
		self:mark_for_disposal()
		return
	end
end

function enemy_base.on_overlap(self, _event_type, _emitter, event)
	local player<const> = self.player
	local contact_kind<const> = combat_overlap.classify_player_contact(event)
	if contact_kind == nil then
		return
	end
	if damaging_contact_kinds[contact_kind] then
		local result<const> = combat_damage.resolve(self, combat_damage.build_weapon_request(self, self.enemy_kind, event, contact_kind))
		self:process_damage_result(result)
	end
	if contact_kind == 'body' and self.dangerous then
		player.events:emit('enemy.contact_damage', {
			amount = self.damage,
			source_x = self.x + (self.sx // 2),
			source_y = self.y + (self.sy // 2),
			reason = self.enemy_kind,
			enemy_id = self.id,
			contact_kind = contact_kind,
		})
	end
end

function enemy_base.extend(enemy_class, enemy_kind)
	local original_ctor<const> = enemy_class.ctor
	enemy_class.enemy_kind = enemy_kind
	enemy_class.bind = enemy_base.bind
	enemy_class.spawn_death_effect = enemy_base.spawn_death_effect
	enemy_class.apply_damage = enemy_base.apply_damage
	enemy_class.process_damage_result = enemy_base.process_damage_result
	enemy_class.on_overlap = enemy_base.on_overlap
	enemy_class.ctor = function(self, ...)
		self.sprite_component:set_offset_z(110)
		if original_ctor then
			original_ctor(self, ...)
		end
	end
end

return enemy_base
