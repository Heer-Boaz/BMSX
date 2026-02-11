local constants = require('constants.lua')
local components = require('components')
local eventemitter = require('eventemitter')

local loot_drop = {}
loot_drop.__index = loot_drop

local loot_drop_fsm_id = constants.ids.loot_drop_fsm
local state_active = loot_drop_fsm_id .. ':/active'
local state_picked = loot_drop_fsm_id .. ':/picked'
local PLAYER_ID = constants.ids.player_instance

local body_sprite_component_id = 'body'
local body_collider_component_id = 'body'

local function sprite_for_loot_type(loot_type)
	if loot_type == 'life' then
		return 'item_health'
	end
	if loot_type == 'ammo' then
		return 'ammo'
	end
	error('pietious loot_drop invalid loot_type=' .. tostring(loot_type))
end

function loot_drop:ensure_components()
	local body_collider = self:get_component_by_local_id('collider2dcomponent', body_collider_component_id)
	if body_collider == nil then
		body_collider = components.collider2dcomponent.new({
			parent = self,
			id_local = body_collider_component_id,
			generateoverlapevents = true,
			spaceevents = 'current',
		})
		body_collider:apply_collision_profile('pickup')
		self:add_component(body_collider)
	end

	local body_sprite = self:get_component_by_local_id('spritecomponent', body_sprite_component_id)
	if body_sprite == nil then
		body_sprite = components.spritecomponent.new({
			parent = self,
			id_local = body_sprite_component_id,
			imgid = 'item_health',
			offset = { x = 0, y = 0, z = 112 },
			collider_local_id = body_collider_component_id,
		})
		self:add_component(body_sprite)
	end

	self.body_collider = body_collider
	self.body_sprite = body_sprite
end

function loot_drop:bind_events()
	if self.events_bound then
		return
	end
	self.events_bound = true

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
		handler = function(event)
			if event.to ~= self.room_id then
				self:mark_for_disposal()
			end
		end,
	})
end

function loot_drop:update_visual()
	self:ensure_components()
	self.body_sprite.imgid = sprite_for_loot_type(self.loot_type)
	self.body_sprite.enabled = true
	self.body_collider.enabled = true
end

function loot_drop:on_overlap_stay(event)
	if event.other_id ~= PLAYER_ID then
		return
	end

	local player = object(PLAYER_ID)

	local other_collider = player:get_component_by_id(event.other_collider_id)
	if other_collider.id_local ~= constants.ids.player_body_collider_local then
		return
	end

	if player:collect_loot(self.loot_type, self.loot_value) then
		self.sc:transition_to(state_picked)
	end
end

local function define_loot_drop_fsm()
	define_fsm(loot_drop_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self.state_name = 'boot'
					self.state_variant = 'boot'
					self:ensure_components()
					self:bind_events()
					self:update_visual()
					return '/active'
				end,
			},
			active = {
				entering_state = function(self)
					self.state_name = 'active'
					self.state_variant = 'active'
					self:update_visual()
				end,
			},
			picked = {
				entering_state = function(self)
					self.state_name = 'picked'
					self.state_variant = 'picked'
					self.body_sprite.enabled = false
					self.body_collider.enabled = false
					self:mark_for_disposal()
				end,
			},
		},
	})
end

local function register_loot_drop_definition()
	define_world_object({
		def_id = constants.ids.loot_drop_def,
		class = loot_drop,
		fsms = { loot_drop_fsm_id },
			defaults = {
				space_id = constants.spaces.castle,
				room_id = '',
				loot_type = 'life',
			loot_value = constants.enemy.loot_life_regen,
			events_bound = false,
			state_name = 'boot',
			state_variant = 'boot',
			registrypersistent = false,
			tick_enabled = false,
		},
	})
end

return {
	loot_drop = loot_drop,
	define_loot_drop_fsm = define_loot_drop_fsm,
	register_loot_drop_definition = register_loot_drop_definition,
	loot_drop_def_id = constants.ids.loot_drop_def,
	loot_drop_fsm_id = loot_drop_fsm_id,
}
