local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
require('constants')
local combat_overlap<const> = require('combat/overlap')
local world_item<const> = {}
world_item.__index = world_item

function world_item:ctor()
	self.collider.layer = collision_pickup_layer
	self.collider.mask = collision_pickup_mask
	self:set_imgid(world_item_sprite[self.item_type])
end

function world_item:onspawn(_pos)
	self.x, self.y = self.room:snap_world_to_tile(self.x, self.y)
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
				local item_id = self.item_id
				if item_id == nil then
					item_id = self.id
				end
				if not player:collect_item(self.item_type, item_id) then
					return
				end
				if self.rock_drop_id ~= nil then
					self.room.rock_drops[self.rock_drop_id] = nil
				end
				self:mark_for_disposal()
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
		components = { fsm_component.factory({ 'world_item' }) },
		defaults = {
			item_id = nil,
			item_type = nil,
		},
	})
end

return {
	world_item = world_item,
	define_world_item_fsm = define_world_item_fsm,
	register_world_item_definition = register_world_item_definition,
}
