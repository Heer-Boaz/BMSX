local constants<const> = require('constants')
local combat_overlap<const> = require('combat_overlap')
local progression<const> = require('progression')
local worldobject<const> = require('worldobject')
local world_item<const> = {}
world_item.__index = world_item

local pickup_inventory_item<const> = function(player, item_type)
	player.inventory_items[item_type] = true
	player.events:emit('pickupitem')
	return true
end

local pickup_keyworld1<const> = function(player, _item_type)
	player.health = player.max_health
	player:emit_health_changed()
	player.inventory_items.keyworld1 = true
	player.events:emit('worldkey')
	return true
end

local pickup_life<const> = function(player, _item_type)
	local picked<const> = player:collect_loot('life', constants.pickup_item.life_regen)
	if picked then
		player.events:emit('healing')
	end
	return picked
end

local pickup_ammo<const> = function(player, _item_type)
	local picked<const> = player:collect_loot('ammo', constants.pickup_item.ammo_regen)
	if picked then
		player.events:emit('pickupitem')
	end
	return picked
end

local pickup_handlers<const> = {
	ammo = pickup_ammo,
	ammofromrock = pickup_ammo,
	life = pickup_life,
	lifefromrock = pickup_life,
	keyworld1 = pickup_keyworld1,
	map_world1 = pickup_inventory_item,
	halo = pickup_inventory_item,
	pepernoot = pickup_inventory_item,
	spyglass = pickup_inventory_item,
	lamp = pickup_inventory_item,
	schoentjes = pickup_inventory_item,
	greenvase = pickup_inventory_item,
}

function world_item:ctor()
	self.collider:apply_collision_profile('pickup')
	self:gfx(constants.world_item.sprite[self.item_type])
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
				if player.health <= 0 then
					return
				end
				local pickup_handler<const> = pickup_handlers[self.item_type]
				if not pickup_handler(player, self.item_type) then
					return
				end
				local item_id = self.item_id
				if item_id == nil then
					item_id = self.id
				end
				if self.rock_drop_id ~= nil then
					oget('room').rock_drops[self.rock_drop_id] = nil
				elseif constants.world_item.inventory[self.item_type] then
					progression.set(oget('c'), 'item_picked_' .. item_id, true)
				end
				self.events:emit('picked')
			end,
		},
		states = {
			active = {
				on = {
					['picked'] = worldobject.mark_for_disposal,
				},
			},
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
