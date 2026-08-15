local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
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

function breakablewall:process_damage_result(result)
	if result.status == 'rejected' then
		return
	end
	if result.destroyed then
		self.castle.events:emit('room.condition_set', {
			room_number = result.room_number,
			condition = self.trigger,
			play_appearance = true,
		})
		return
	end
end

function breakablewall:ctor()
	local collider<const> = self:get_component(collider_2d_component)
	collider.layer = collision_enemy_layer
	collider.mask = collision_enemy_mask
	self.sx = self.width_tiles * room_tile_size
	self.sy = self.height_tiles * room_tile_size
	local tile_layer<const> = self:get_component(tile_layer_component)
	local tile_count<const> = self.width_tiles * self.height_tiles
	tile_layer:set_tile_size(room_tile_size)
	tile_layer:fill(self.tiletype, tile_count, self.width_tiles)
	tile_layer.offset_x = 0
	tile_layer.offset_y = 0
end

function breakablewall.register()
	fsm_library.register('breakablewall', {
		initial = 'active',
		on = {
			['overlap.begin'] = function(self, _state, event)
				local contact_kind<const> = combat_overlap.classify_player_contact(event)
				if contact_kind == nil then
					return
				end
				local result<const> = combat_damage.resolve(self, combat_damage.build_weapon_request(self, self.enemy_kind, event, contact_kind))
				self:process_damage_result(result)
			end,
		},
		states = {
			active = {},
		},
	})
	prefab.define({
		def_id = 'enemy.breakablewall',
		class = breakablewall,
		components = {
			collider_2d_component.new,
			tile_layer_component.new,
			fsm_component.factory({ 'breakablewall' }),
		},
		defaults = {
			trigger = nil,
			damage = 0,
			max_health = 1,
			health = 1,
			direction = nil,
			speed_x_num = nil,
			speed_y_num = nil,
			width_tiles = 1,
			height_tiles = 1,
			tiletype = 'castle_front_blue_1',
			enemy_kind = 'breakablewall',
		},
	})
end

return breakablewall
