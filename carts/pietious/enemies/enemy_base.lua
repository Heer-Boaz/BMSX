local sprite_object<const> = require('cartlib/sprite')
local combat_overlap<const> = require('combat/overlap')
local combat_damage<const> = require('combat/damage')
require('constants')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local screen_boundary_component<const> = require('cartlib/physics/screen_boundary_component')

local collision_storage<const> = require('collision_storage')

local enemy_base<const> = {}
enemy_base.__index = enemy_base
setmetatable(enemy_base, { __index = sprite_object })
function enemy_base.initialize(self, context)
	sprite_object.initialize(self, context)
	self.last_sword_strike_id = 0
end

enemy_base.new_collider = collider_2d_component.factory_for_sprite({
	geometry_pool = collision_storage.sprite,
	layer = collision_enemy_layer,
	mask = collision_enemy_mask,
})

enemy_base.projectile_boundary = screen_boundary_component.factory({
	left = 0, top = room_hud_height, right = room_width, bottom = room_height,
	local_left = 0, local_top = 0, local_right = 16, local_bottom = 16,
})

function enemy_base.bind_lifecycle(self)
	if self:get_component(screen_boundary_component) ~= nil then
		self.events:on({
			event = 'screen.leave',
			handler = self.mark_for_disposal,
		})
	end
end

function enemy_base.bind(self)
	self.events:on({
		event = 'overlap.begin',
		handler = enemy_base.on_overlap,
	})
	self.events:on({
		event = 'overlap.stay',
		handler = enemy_base.on_overlap,
	})
	enemy_base.bind_lifecycle(self)
end

function enemy_base.spawn_death_effect(self)
	local pose<const> = self.spatial
	self.room.scene:spawn('enemy_explosion', {
		room = self.room,
		player = self.player,
		loot_type = self:choose_drop_type(),
	}, { local_transform = { 1, 0, 0, 1, pose.ox, pose.oy } })
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
		self:mark_for_disposal()
		return
	end
end

function enemy_base.on_overlap(self, event_type, _emitter, event)
	local player<const> = self.player
	local weapon_kind<const> = combat_overlap.admit_weapon_contact(self, event)
	if weapon_kind ~= nil then
		local result<const> = combat_damage.resolve(self, combat_damage.build_weapon_request(self, self.enemy_kind, event, weapon_kind))
		self:process_damage_result(result)
		return
	end
	if event_type == 'overlap.begin'
	and event.other_collider_local_id == 'body'
	and self.dangerous then
		local pose<const> = self.spatial
		local sprite<const> = self.sprite_component
		player.events:emit('enemy.contact_damage', {
			amount = self.damage,
			source_x = pose.ox + (sprite.source_width // 2),
			source_y = pose.oy + (sprite.source_height // 2),
			reason = self.enemy_kind,
			enemy_id = self.id,
			contact_kind = 'body',
		})
	end
end

return enemy_base
