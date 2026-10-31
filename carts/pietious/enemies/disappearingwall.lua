local prefab<const> = require('cartlib/world/prefab')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local collision_storage<const> = require('collision_storage')
local tile_layer_component<const> = require('cartlib/component/tile_layer_component')
require('constants')

local disappearingwall<const> = {}
disappearingwall.__index = disappearingwall

function disappearingwall:ctor()
	local collider<const> = self:get_component(collider_2d_component)
	collider:set_local_area(0, 0, self.width_tiles * room_tile_size, self.height_tiles * room_tile_size)
	local tile_layer<const> = self:get_component(tile_layer_component)
	local tile_count<const> = self.width_tiles * self.height_tiles
	tile_layer:set_tile_size(room_tile_size)
	tile_layer:fill(self.tiletype, tile_count, self.width_tiles)
end

function disappearingwall.register()
	prefab.define({
		def_id = 'enemy.disappearingwall',
		class = disappearingwall,
		spatial = { family = '2d', authority = 'root_origin' },
		components = {
			collider_2d_component.factory({
				geometry_pool = collision_storage.area,
				layer = collision_enemy_layer, mask = collision_enemy_mask,
				local_area = { left = 0, top = 0, right = room_tile_size, bottom = room_tile_size },
			}),
			function(owner) return tile_layer_component.new(owner, owner) end,
		},
		defaults = {
			tile_size = room_tile_size,
			order = 140,
			damage = 0,
			max_health = 1,
			health = 1,
			direction = nil,
			width_tiles = 1,
			height_tiles = 1,
			tiletype = 'frontworld_l',
			enemy_kind = 'disappearingwall',
		},
	})
end

return disappearingwall
