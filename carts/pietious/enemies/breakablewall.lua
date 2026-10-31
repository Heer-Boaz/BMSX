local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local collision_storage<const> = require('collision_storage')
local tile_layer_component<const> = require('cartlib/component/tile_layer_component')
require('constants')
local combat_overlap<const> = require('combat/overlap')
local combat_damage<const> = require('combat/damage')

local breakablewall<const> = {}
breakablewall.__index = breakablewall

function breakablewall:apply_damage(request)
	if request.weapon_kind ~= 'sword' then
		return combat_damage.build_rejected_result(request, 'wrong_weapon')
	end
	self.health = self.health - 1
	if self.health > 0 then
		return combat_damage.build_applied_result(request, 1, false, 'damaged')
	end
	self.health = 0
	return combat_damage.build_applied_result(request, 1, true, 'destroyed')
end

function breakablewall:ctor()
	local collider<const> = self:get_component(collider_2d_component)
	self.last_sword_strike_id = 0
	collider:set_local_area(0, 0, self.width_tiles * room_tile_size, self.height_tiles * room_tile_size)
	local tile_layer<const> = self:get_component(tile_layer_component)
	local tile_count<const> = self.width_tiles * self.height_tiles
	tile_layer:set_tile_size(room_tile_size)
	tile_layer:fill(self.tiletype, tile_count, self.width_tiles)
end

function breakablewall.register()
	local apply_weapon_contact<const> = function(self, _state, event)
		local weapon_kind<const> = combat_overlap.admit_weapon_contact(self, event)
		if weapon_kind == nil then
			return
		end
		local result<const> = combat_damage.resolve(self, combat_damage.build_weapon_request(self, self.enemy_kind, event, weapon_kind))
		if result.destroyed then
			self:mark_for_disposal()
		end
	end
	fsm_library.register('breakablewall', {
		initial = 'active',
		on = {
			['overlap.begin'] = apply_weapon_contact,
			['overlap.stay'] = apply_weapon_contact,
		},
		states = {
			active = {},
		},
	})
	prefab.define({
		def_id = 'enemy.breakablewall',
		class = breakablewall,
		spatial = { family = '2d', authority = 'root_origin' },
		components = {
			collider_2d_component.factory({
				geometry_pool = collision_storage.area,
				layer = collision_enemy_layer, mask = collision_enemy_mask,
				local_area = { left = 0, top = 0, right = room_tile_size, bottom = room_tile_size },
			}),
			function(owner) return tile_layer_component.new(owner, owner) end,
			fsm_component.factory({ 'breakablewall' }),
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
			tiletype = 'castle_front_blue_1',
			enemy_kind = 'breakablewall',
		},
	})
end

return breakablewall
