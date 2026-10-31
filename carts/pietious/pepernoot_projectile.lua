-- pepernoot_projectile.lua
-- player thrown projectile (pepernoot) — fires horizontally, disposes on
-- collision with terrain, room bounds, or enemies.

local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local collision_storage<const> = require('collision_storage')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
require('constants')
local tile_collision_component<const> = require('cartlib/collision/tile_collision_component')
local world_object<const> = require('cartlib/world/world_object')

local pepernoot_projectile<const> = {}
pepernoot_projectile.__index = pepernoot_projectile

local query_terrain<const> = function(_component, owner, payload)
	local pose<const> = owner.spatial
	local collision_flags<const> = owner.room:collision_flags_at_world(pose.ox, pose.oy)
	if collision_flags == collision_flags_none or collision_flags == collision_flags_elevator then
		return nil
	end
	payload.collision_flags = collision_flags
	payload.world_x = pose.ox
	payload.world_y = pose.oy
	return collision_flags
end

local terrain_collision<const> = { query = query_terrain }

function pepernoot_projectile:onspawn()
	local pose<const> = self.spatial
	local snapped_x<const>, snapped_y<const> = self.room:snap_world_to_tile(pose.ox, pose.oy)
	self.sprite_component:set_attachment_origin(snapped_x - pose.ox, snapped_y - pose.oy)
end

function pepernoot_projectile:update_motion()
	local room<const> = self.room
	local pose<const> = self.spatial
	local x<const> = pose.ox + self.direction * secondary_weapon_pepernoot_speed_px
	local y<const> = pose.oy
	self.spatial:set_world_origin(x, y)
	local snapped_x<const>, snapped_y<const> = room:snap_world_to_tile(x, y)
	self.sprite_component:set_attachment_origin(snapped_x - x, snapped_y - y)
	if x <= 0 or x >= room.world_width then
		self:mark_for_disposal()
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
		spatial = { family = '2d', authority = 'root_origin' },
		components = {
			collider_2d_component.factory_for_sprite({ geometry_pool = collision_storage.sprite, layer = collision_projectile_layer, mask = collision_projectile_mask }),
			function(owner) return tile_collision_component.new(owner, terrain_collision) end,
			fsm_component.factory({ 'pepernoot_projectile' }),
		},
		defaults = {
			order = 140,
			imgid = 'pepernoot_16',
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
