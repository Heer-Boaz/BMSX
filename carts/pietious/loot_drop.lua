local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsmcomponent')
local prefab<const> = require('cartlib/prefab')
local spriteobject<const> = require('cartlib/sprite')
local world<const> = require('cartlib/world/world')
require('constants')
local combat_overlap<const> = require('combat/overlap')
local worldobject<const> = require('cartlib/world/worldobject')

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
	self.x, self.y = world:get('room'):snap_world_to_tile(self.x, self.y)
end

local define_loot_drop_fsm<const> = function()
	fsm_library.register('loot_drop', {
		initial = 'active',
		on = {
			['overlap.begin'] = function(self, _state, event)
				if combat_overlap.classify_player_contact(event) ~= 'body' then
					return
				end
				local player<const> = world:get(event.other_id)
				if player:collect_loot(self.loot_type, self.loot_value, self.loot_type) then
					self:despawn()
				end
			end,
			['room.switched'] = {
				emitter = 'pietolon',
				go = worldobject.despawn,
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
		base = spriteobject,
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
