local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local registry<const> = require('cartlib/registry')
local sprite_object<const> = require('cartlib/sprite')
require('constants')

local enemy<const> = {}
enemy.__index = enemy
setmetatable(enemy, { __index = sprite_object })

function enemy.initialize(self)
	sprite_object.initialize(self)
	self.health = self.max_health
	self.vulnerable = true
end

function enemy.new_collider(opts)
	local collider<const> = collider_2d_component.new(opts)
	collider.layer = collision_enemy_layer
	collider.mask = collision_enemy_mask
	return collider
end

-- Static packed shapes resolve their four GEO descriptors when the prefab is
-- defined. Instances retain those addresses directly instead of decoding the
-- asset header in every enemy constructor.
function enemy.collider_factory(shape_asset)
	return collider_2d_component.factory({
		layer = collision_enemy_layer,
		mask = collision_enemy_mask,
		shape_asset = shape_asset,
	})
end

function enemy.new_sprite_collider(opts)
	local collider<const> = collider_2d_component.new_for_sprite(opts)
	collider.layer = collision_enemy_layer
	collider.mask = collision_enemy_mask
	return collider
end

function enemy:on_destroyed()
	self.vulnerable = false
	self:mark_for_disposal()
end

function enemy:receive_player_projectile(projectile)
	if self.vulnerable then
		self.health = self.health - projectile.damage
		if self.health <= 0 then
			self.health = 0
			self:on_destroyed(projectile)
		end
	end
	return not (self.small_fry and projectile.pierces_small_fry)
end

function enemy:on_overlap(_event_type, _emitter, event)
	if event.other_layer == collision_player_projectile_layer then
		local player<const> = registry:get(event.other_id)
		player:resolve_projectile_overlap(
			event.other_collider_local_id,
			self,
			event.collider_local_id,
			event.contact.point
		)
		return
	end
	if self.small_fry and self.vulnerable then
		self.health = self.health - 1
		if self.health <= 0 then
			self.health = 0
			self:on_destroyed()
		end
	end
end

function enemy:bind()
	self.events:on({
		event = 'overlap.begin',
		handler = enemy.on_overlap,
	})
end

function enemy:dispose_if_left_of_stage(width)
	if self.x < -width then
		self:mark_for_disposal()
		return true
	end
	return false
end

function enemy:update_stage_follower()
	if self.x < -self.stage_scroll_width then
		self:mark_for_disposal()
	end
end

return enemy
