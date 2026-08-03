local fsmlibrary<const> = require('cartlib/fsm/library')
local fsmcomponent<const> = require('cartlib/fsm/component')
local prefab<const> = require('cartlib/prefab')
local spriteobject<const> = require('cartlib/sprite')
local world_instance<const> = require('cartlib/world/world').instance
require('constants')
local combat_overlap<const> = require('combat/overlap')
local progression<const> = require('cartlib/progression')
local world_item<const> = {}
world_item.__index = world_item

function world_item:ctor()
	self.collider.layer = collision_pickup_layer
	self.collider.mask = collision_pickup_mask
	self:gfx(world_item_sprite[self.item_type])
end

function world_item:onspawn(_pos)
	self.x, self.y = world_instance:get('room'):snap_world_to_tile(self.x, self.y)
end

local define_world_item_fsm<const> = function()
	fsmlibrary.register('world_item', {
		initial = 'active',
		on = {
			['overlap.begin'] = function(self, _state, event)
				if combat_overlap.classify_player_contact(event) ~= 'body' then
					return
				end
				local player<const> = world_instance:get('pietolon')
				local item_id = self.item_id
				if item_id == nil then
					item_id = self.id
				end
				if not player:collect_item(self.item_type, item_id) then
					return
				end
				if self.rock_drop_id ~= nil then
					world_instance:get('room').rock_drops[self.rock_drop_id] = nil
				elseif world_item_inventory[self.item_type] then
					progression.set(world_instance:get('c'), 'item_picked_' .. item_id, true)
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
		base = spriteobject,
		components = { fsmcomponent.factory({ 'world_item' }) },
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
