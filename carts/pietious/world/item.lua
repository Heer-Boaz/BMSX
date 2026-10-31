local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local collision_storage<const> = require('collision_storage')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
require('constants')
local combat_overlap<const> = require('combat/overlap')
local world_item<const> = {}
world_item.__index = world_item

function world_item:ctor()
	self.collider = self:get_component(collider_2d_component)
end

function world_item:onspawn()
	local pose<const> = self.spatial
	local x<const>, y<const> = self.room:snap_world_to_tile(pose.ox, pose.oy)
	self.spatial:set_world_origin(x, y)
end

function world_item:on_collected()
	if self.rock_drop_id ~= nil then
		self.room.castle.session.region_drops[self.rock_drop_id] = nil
	end
	self:mark_for_disposal()
end

local define_world_item_fsm<const> = function()
	fsm_library.register('world_item', {
		initial = 'active',
		on = {
			['overlap.begin'] = function(self, _state, event)
				if combat_overlap.classify_player_contact(event) ~= 'body' then
					return
				end
				local player<const> = self.player
				if not player:collect_item(self.item_type, self.item_id) then
					return
				end
				self:on_collected()
			end,
		},
		states = {
			active = {},
		},
	})
end

local register_world_item_definition<const> = function()
	prefab.define({
		def_id = 'world_item',
		class = world_item,
		base = sprite_object,
		spatial = { family = '2d', authority = 'root_origin' },
		components = {
			collider_2d_component.factory_for_sprite({ geometry_pool = collision_storage.sprite, layer = collision_pickup_layer, mask = collision_pickup_mask }),
			fsm_component.factory({ 'world_item' }),
		},
		defaults = {
			order = 130,
			item_type = nil,
		},
	})
end

return {
	world_item = world_item,
	define_world_item_fsm = define_world_item_fsm,
	register_world_item_definition = register_world_item_definition,
}
