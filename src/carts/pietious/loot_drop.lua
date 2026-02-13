local constants = require('constants')
local components = require('components')
local eventemitter = require('eventemitter')

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
		event_name = 'overlap.stay',
		subscriber = self,
		handler = function(event)
			self:on_overlap_stay(event)
		end,
	})

	eventemitter.eventemitter.instance:on({
		event = constants.events.room_switched,
		subscriber = self,
		handler = function(_event)
			self:mark_for_disposal()
		end,
	})
end

function loot_drop:on_overlap_stay(event)
	if event.other_id ~= constants.ids.player_instance then
		return
	end

	local player = object(constants.ids.player_instance)

	local other_collider = player:get_component_by_id(event.other_collider_id)
	if other_collider.id_local ~= constants.ids.player_body_collider_local then
		return
	end

	if player:collect_loot(self.loot_type, self.loot_value) then
		self:dispatch_state_event('picked')
	end
end

local function define_loot_drop_fsm()
	define_fsm(constants.ids.loot_drop_fsm, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self.body_collider = components.collider2dcomponent.new({
						parent = self,
						id_local = 'body',
						generateoverlapevents = true,
						spaceevents = 'current',
					})
					self.body_collider:apply_collision_profile('pickup')
					self:add_component(self.body_collider)
					self.sprite_component.imgid = 'item_health'
					self.sprite_component.offset = { x = 0, y = 0, z = 112 }
					self:bind_events()
				self.sprite_component.imgid = sprite_for_loot_type(self.loot_type)
				self.visible = true
				self.body_collider.enabled = true
				return '/active'
			end,
		},
		active = {
			on = {
				['picked'] = '/picked',
			},
				entering_state = function(self)
					self.sprite_component.imgid = sprite_for_loot_type(self.loot_type)
					self.visible = true
					self.body_collider.enabled = true
				end,
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
		def_id = constants.ids.loot_drop_def,
		class = loot_drop,
		type = 'sprite',
		fsms = { constants.ids.loot_drop_fsm },
			defaults = {
				loot_type = 'life',
			loot_value = constants.enemy.loot_life_regen,
			tick_enabled = false,
		},
	})
end

return {
	loot_drop = loot_drop,
	define_loot_drop_fsm = define_loot_drop_fsm,
	register_loot_drop_definition = register_loot_drop_definition,
	loot_drop_def_id = constants.ids.loot_drop_def,
	loot_drop_fsm_id = constants.ids.loot_drop_fsm,
}
