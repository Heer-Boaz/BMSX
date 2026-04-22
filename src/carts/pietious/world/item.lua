local constants<const> = require('constants')
local combat_overlap<const> = require('combat/overlap')
local progression<const> = require('progression')
local world_item<const> = {}
world_item.__index = world_item

function world_item:ctor()
	self.collider:apply_collision_profile('pickup')
	self:gfx(constants.world_item.sprite[self.item_type])
end

function world_item:onspawn(_pos)
	self.x, self.y = oget('room'):snap_world_to_tile(self.x, self.y)
end

local define_world_item_fsm<const> = function()
	define_fsm('world_item', {
		initial = 'active',
		on = {
			['overlap.begin'] = function(self, _state, event)
				if combat_overlap.classify_player_contact(event) ~= 'body' then
					return
				end
				local player<const> = oget('pietolon')
				local item_id = self.item_id
				if item_id == nil then
					item_id = self.id
				end
				if not player:collect_item(self.item_type, item_id) then
					return
				end
				if self.rock_drop_id ~= nil then
					oget('room').rock_drops[self.rock_drop_id] = nil
				elseif constants.world_item.inventory[self.item_type] then
					progression.set(oget('c'), 'item_picked_' .. item_id, true)
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
	define_prefab({
		def_id = 'world_item',
		class = world_item,
		type = 'sprite',
		fsms = { 'world_item' },
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
