local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local collision_storage<const> = require('collision_storage')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
require('constants')
local combat_overlap<const> = require('combat/overlap')

local loot_drop<const> = {}
loot_drop.__index = loot_drop
setmetatable(loot_drop, { __index = sprite_object })

function loot_drop:onspawn()
	local pose_x<const>, pose_y<const> = self:get_global_position()
	local x<const>, y<const> = self.room:snap_world_to_tile(pose_x, pose_y)
	self:set_global_position(x, y)
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
		components = {
			collider_2d_component.factory_for_sprite({ geometry_pool = collision_storage.sprite, layer = collision_pickup_layer, mask = collision_pickup_mask }),
			fsm_component.factory({ 'loot_drop' }),
		},
		defaults = {
			order = 113,
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
