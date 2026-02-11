local constants = require('constants.lua')
local components = require('components')
local world_item = {}
world_item.__index = world_item

local world_item_fsm_id = constants.ids.world_item_fsm
local state_active = world_item_fsm_id .. ':/active'
local state_picked = world_item_fsm_id .. ':/picked'
local PLAYER_ID = constants.ids.player_instance

local body_sprite_component_id = 'body'
local body_collider_component_id = 'body'

local function sprite_for_item_type(item_type)
	if item_type == 'ammofromrock' then
		return 'ammo'
	end
	if item_type == 'lifefromrock' then
		return 'item_health'
	end
	if item_type == 'keyworld1' then
		return 'world_key'
	end
	if item_type == 'map_world1' then
		return 'map'
	end
	if item_type == 'halo' then
		return 'halo'
	end
	if item_type == 'pepernoot' then
		return 'pepernoot_16'
	end
	if item_type == 'spyglass' then
		return 'spyglass'
	end
	if item_type == 'lamp' then
		return 'item_lamp'
	end
	if item_type == 'schoentjes' then
		return 'schoentjes'
	end
	if item_type == 'greenvase' then
		return 'item_greenvase'
	end
	error('pietious world_item invalid item_type=' .. tostring(item_type))
end

function world_item:ensure_components()
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

function world_item:bind_events()
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
end

function world_item:update_visual()
	self.body_sprite.imgid = sprite_for_item_type(self.item_type)
	self.body_sprite.enabled = true
	self.body_collider.enabled = true
end

function world_item:configure_from_room_def(def, room, item_service_id)
	self.item_id = def.id
	self.room_id = room.room_id
	self.space_id = room.space_id
	self.item_service_id = item_service_id
	self.source_kind = def.source_kind
	self.item_type = def.item_type
	self.x = def.x
	self.y = def.y
	if self.sc:matches_state_path(state_active) then
		self:update_visual()
	end
end

function world_item:on_overlap_stay(event)
	if event.other_id ~= PLAYER_ID then
		return
	end

	local player = object(PLAYER_ID)
	local other_collider = player:get_component_by_id(event.other_collider_id)
	if other_collider.id_local ~= constants.ids.player_body_collider_local then
		return
	end

	if player:collect_world_item(self.item_type) then
		service(self.item_service_id):on_item_picked(self.item_id, self.room_id, self.item_type, self.source_kind)
		self.sc:transition_to(state_picked)
	end
end

local function define_world_item_fsm()
	define_fsm(world_item_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self.state_name = 'boot'
					self.state_variant = 'boot'
					self:ensure_components()
					self:bind_events()
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

local function register_world_item_definition()
	define_world_object({
		def_id = constants.ids.world_item_def,
		class = world_item,
		fsms = { world_item_fsm_id },
		defaults = {
			space_id = constants.spaces.castle,
			room_id = '',
			item_id = '',
				item_type = 'ammofromrock',
				source_kind = 'map',
				item_service_id = constants.ids.item_service_instance,
				events_bound = false,
			state_name = 'boot',
			state_variant = 'boot',
			registrypersistent = false,
			tick_enabled = false,
		},
	})
end

return {
	world_item = world_item,
	define_world_item_fsm = define_world_item_fsm,
	register_world_item_definition = register_world_item_definition,
	world_item_def_id = constants.ids.world_item_def,
	world_item_fsm_id = world_item_fsm_id,
}
