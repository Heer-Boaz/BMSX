local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
require('constants')
local combat_overlap<const> = require('combat/overlap')
local world_object<const> = require('cartlib/world/world_object')

local loot_drop<const> = {}
loot_drop.__index = loot_drop

local sprite_for_loot_type<const> = function(loot_type)
	if loot_type == 'life' then
		return 'item_health'
	end
	if loot_type == 'ammo' then
		return 'ammo'
	end
	error('pietious loot_drop invalid loot_type=' .. tostring(loot_type))
end

function loot_drop:ctor()
	self.collider.layer = collision_pickup_layer
	self.collider.mask = collision_pickup_mask
	self:set_imgid(sprite_for_loot_type(self.loot_type))
end

function loot_drop:onspawn(_pos)
	self.x, self.y = self.room:snap_world_to_tile(self.x, self.y)
end

local define_loot_drop_fsm<const> = function()
	fsm_library.register('loot_drop', {
		initial = 'active',
		on = {
			['overlap.begin'] = function(self, _state, event)
				if combat_overlap.classify_player_contact(event) ~= 'body' then
					return
				end
				local player<const> = self.player
				if player:collect_loot(self.loot_type, self.loot_value, self.loot_type) then
					self:mark_for_disposal()
				end
			end,
			['room.switched'] = {
				emitter = 'pietolon',
				go = world_object.mark_for_disposal,
			},
		},
		states = {
			active = {},
		},
	})
end

local register_loot_drop_definition<const> = function()
	prefab.define({
		def_id = 'loot_drop',
		class = loot_drop,
		base = sprite_object,
		components = { fsm_component.factory({ 'loot_drop' }) },
		defaults = {
			loot_type = 'life',
			loot_value = enemy_loot_life_regen,
		},
	})
end

return {
	loot_drop = loot_drop,
	define_loot_drop_fsm = define_loot_drop_fsm,
	register_loot_drop_definition = register_loot_drop_definition,
}
