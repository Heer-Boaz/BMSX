local constants = require('constants')
local combat_overlap = require('combat_overlap')

local loot_drop = {}
loot_drop.__index = loot_drop

local function sprite_for_loot_type(loot_type)
	if loot_type == 'life' then
		return 'item_health'
	end
	if loot_type == 'ammo' then
		return 'ammo'
	end
	error('pietious loot_drop invalid loot_type=' .. tostring(loot_type))
end

function loot_drop:bind_events()
	self.events:on({
		event_name = 'overlap.begin',
		subscriber = self,
		handler = function(event)
			self:on_overlap_begin(event)
		end,
	})

	self.events:on({
		event = 'room.switched',
		emitter = 'pietolon',
		subscriber = self,
		handler = function(_event)
			self:mark_for_disposal()
		end,
	})
end

function loot_drop:ctor()
	self.collider:apply_collision_profile('pickup')
	self:gfx('item_health')
	self.sprite_component.offset = { x = 0, y = 0, z = 112 }
	self:bind_events()
end

function loot_drop:on_overlap_begin(event)
	if combat_overlap.classify_player_contact(event) ~= 'body' then
		return
	end
	local player = object(event.other_id)

	if player:collect_loot(self.loot_type, self.loot_value) then
		self:dispatch_state_event('picked')
	end
end

local function define_loot_drop_fsm()
	define_fsm('loot_drop.fsm', {
		initial = 'active',
		states = {
			active = {
				entering_state = function(self)
					self:gfx(sprite_for_loot_type(self.loot_type))
				end,
				on = {
					['picked'] = '/picked',
				},
			},
			picked = {
				entering_state = function(self)
					self:mark_for_disposal()
				end,
			},
		},
	})
end

local function register_loot_drop_definition()
	define_prefab({
		def_id = 'loot_drop.def',
		class = loot_drop,
		type = 'sprite',
		fsms = { 'loot_drop.fsm' },
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
