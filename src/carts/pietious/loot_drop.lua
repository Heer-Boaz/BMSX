local constants<const> = require('constants')
local combat_overlap<const> = require('combat_overlap')
local worldobject<const> = require('worldobject')

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
	self.collider:apply_collision_profile('pickup')
	self:gfx(sprite_for_loot_type(self.loot_type))
end

function loot_drop:onspawn(_pos)
	self.x, self.y = oget('room'):snap_world_to_tile(self.x, self.y)
end

local define_loot_drop_fsm<const> = function()
	define_fsm('loot_drop', {
		initial = 'active',
		on = {
			['overlap.begin'] = function(self, _state, event)
				if combat_overlap.classify_player_contact(event) ~= 'body' then
					return
				end
				local player<const> = oget(event.other_id)
				if player:collect_loot(self.loot_type, self.loot_value) then
					if self.loot_type == 'life' then
						player.events:emit('healing')
					else
						player.events:emit('pickupitem')
					end
					self.events:emit('picked')
				end
			end,
			['room.switched'] = {
				emitter = 'pietolon',
				go = worldobject.mark_for_disposal,
			},
		},
		states = {
			active = {
				on = {
					['picked'] = '/picked',
				},
			},
			picked = {
				entering_state = worldobject.mark_for_disposal,
			},
		},
	})
end

local register_loot_drop_definition<const> = function()
	define_prefab({
		def_id = 'loot_drop',
		class = loot_drop,
		type = 'sprite',
		fsms = { 'loot_drop' },
		defaults = {
			loot_type = 'life',
			loot_value = constants.enemy.loot_life_regen,
		},
	})
end

return {
	loot_drop = loot_drop,
	define_loot_drop_fsm = define_loot_drop_fsm,
	register_loot_drop_definition = register_loot_drop_definition,
}
