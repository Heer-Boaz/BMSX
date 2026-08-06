local fsmlibrary<const> = require('cartlib/fsm/library')
local fsmcomponent<const> = require('cartlib/fsm/fsmcomponent')
local prefab<const> = require('cartlib/world/prefab')
local collider2dcomponent<const> = require('cartlib/collision/collider2dcomponent')
local tilelayercomponent<const> = require('cartlib/component/tilelayercomponent')
require('constants')

local disappearingwall<const> = {}
disappearingwall.__index = disappearingwall

function disappearingwall:update_wall_size()
	self.sx = self.width_tiles * room_tile_size
	self.sy = self.height_tiles * room_tile_size
end

function disappearingwall:ctor()
	local collider<const> = self:get_component(collider2dcomponent)
	collider.layer = collision_enemy_layer
	collider.mask = collision_enemy_mask
	self:update_wall_size()
	local tile_layer<const> = self:get_component(tilelayercomponent)
	local tile_count<const> = self.width_tiles * self.height_tiles
	tile_layer:fill(self.tiletype, tile_count, self.width_tiles)
	tile_layer.tile_size = room_tile_size
	tile_layer.offset_x = 0
	tile_layer.offset_y = 0
end

function disappearingwall.register()
	fsmlibrary.register('disappearingwall', {
		initial = 'active',
		on = {
			['room.condition_set'] = function(self, _state, event)
				if event.condition == self.trigger then
					self:mark_for_disposal()
				end
			end,
		},
		states = {
			active = {},
		},
	})
	prefab.define({
		def_id = 'enemy.disappearingwall',
		class = disappearingwall,
		components = {
			collider2dcomponent.new,
			tilelayercomponent.new,
			fsmcomponent.factory({ 'disappearingwall' }),
		},
		defaults = {
			trigger = nil,
			conditions = {},
			damage = 0,
			max_health = 1,
			health = 1,
			direction = nil,
			speed_x_num = nil,
			speed_y_num = nil,
			width_tiles = 1,
			height_tiles = 1,
			tiletype = 'frontworld_l',
			enemy_kind = 'disappearingwall',
		},
	})
end

return disappearingwall
