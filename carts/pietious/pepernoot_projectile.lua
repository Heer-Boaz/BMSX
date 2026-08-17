-- pepernoot_projectile.lua
-- player thrown projectile (pepernoot) — fires horizontally, disposes on
-- collision with terrain, room bounds, or enemies.

local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
require('constants')
local tile_collision_component<const> = require('cartlib/collision/tile_collision_component')
local world_object<const> = require('cartlib/world/world_object')

local pepernoot_projectile<const> = {}
pepernoot_projectile.__index = pepernoot_projectile

function pepernoot_projectile:ctor()
	local collider<const> = self:get_component(collider_2d_component)
	collider.layer = collision_projectile_layer
	collider.mask = collision_projectile_mask
	self:add_component(tile_collision_component.new({
		id_local = 'world',
		query = function(_component, owner, payload)
			local collision_flags<const> = owner.room:collision_flags_at_world(owner.x, owner.y)
			if collision_flags == collision_flags_none or collision_flags == collision_flags_elevator then
				return nil
			end
			payload.collision_flags = collision_flags
			payload.world_x = owner.x
			payload.world_y = owner.y
			return collision_flags
		end,
	}))
	self:set_imgid('pepernoot_16')
end

function pepernoot_projectile:onspawn(pos)
	local room<const> = self.room
	local snapped_x<const>, snapped_y<const> = room:snap_world_to_tile(self.x, self.y)
	self.sprite_component.offset_x = snapped_x - self.x
	self.sprite_component.offset_y = snapped_y - self.y
end

function pepernoot_projectile:refresh_tile_aligned_sprite_offset()
	local room<const> = self.room
	local snapped_x<const>, snapped_y<const> = room:snap_world_to_tile(self.x, self.y)
	self.sprite_component.offset_x = snapped_x - self.x
	self.sprite_component.offset_y = snapped_y - self.y
end

function pepernoot_projectile:update_motion()
	local room<const> = self.room
	self.x = self.x + (self.direction * secondary_weapon_pepernoot_speed_px)
	self:refresh_tile_aligned_sprite_offset()

	if self.x <= 0 or self.x >= room.world_width then
		self:mark_for_disposal()
		return
	end
end

local define_pepernoot_projectile_fsm<const> = function()
	fsm_library.register('pepernoot_projectile', {
		initial = 'active',
		on = {
			['tilecollision.begin'] = world_object.mark_for_disposal,
			['overlap.begin'] = function(self, _state, event)
				if event.other_layer ~= collision_enemy_layer then
					return
				end
				self:mark_for_disposal()
			end,
			['room.switched'] = {
				emitter = 'pietolon',
				go = world_object.mark_for_disposal,
			},
		},
		states = {
			active = {
				update = pepernoot_projectile.update_motion,
			},
		},
	})
end

local register_pepernoot_projectile_definition<const> = function()
	prefab.define({
		def_id = 'pepernoot_projectile',
		class = pepernoot_projectile,
		base = sprite_object,
		components = {
			collider_2d_component.new_for_sprite,
			fsm_component.factory({ 'pepernoot_projectile' }),
		},
		defaults = {
			owner_id = 'pietolon',
			direction = 1,
		},
	})
end

return {
	pepernoot_projectile = pepernoot_projectile,
	define_pepernoot_projectile_fsm = define_pepernoot_projectile_fsm,
	register_pepernoot_projectile_definition = register_pepernoot_projectile_definition,
}
