local constants = require('constants.lua')
local components = require('components')
local engine = require('engine')
local eventemitter = require('eventemitter')

local pepernoot_projectile = {}
pepernoot_projectile.__index = pepernoot_projectile

local pepernoot_projectile_fsm_id = constants.ids.pepernoot_projectile_fsm
local state_active = pepernoot_projectile_fsm_id .. ':/active'

local body_sprite_component_id = 'body'
local body_collider_component_id = 'body'
local projectile_hit_width = constants.room.tile_size * 2
local projectile_hit_height = constants.room.tile_size - 1

function pepernoot_projectile:ensure_components()
	local body_collider = self:get_component_by_local_id('collider2dcomponent', body_collider_component_id)
	if body_collider == nil then
		body_collider = components.collider2dcomponent.new({
			parent = self,
			id_local = body_collider_component_id,
			generateoverlapevents = true,
			spaceevents = 'current',
		})
		body_collider:apply_collision_profile('projectile')
		body_collider:set_local_area({
			left = 0,
			top = 0,
			right = projectile_hit_width,
			bottom = projectile_hit_height,
		})
		self:add_component(body_collider)
	end

	local body_sprite = self:get_component_by_local_id('spritecomponent', body_sprite_component_id)
	if body_sprite == nil then
		body_sprite = components.spritecomponent.new({
			parent = self,
			id_local = body_sprite_component_id,
			imgid = 'pepernoot_16',
			offset = { x = 0, y = 0, z = 113 },
		})
		self:add_component(body_sprite)
	end

	self.body_collider = body_collider
	self.body_sprite = body_sprite
end

function pepernoot_projectile:update_visual_snap()
	local tile_size = self.room.tile_size
	local snapped_x = math.floor(self.x / tile_size) * tile_size
	local snapped_y = math.floor(self.y / tile_size) * tile_size
	self.body_sprite.offset.x = snapped_x - self.x
	self.body_sprite.offset.y = snapped_y - self.y
end

function pepernoot_projectile:bind_events()
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
			if event.from == self.room_id then
				self:dispose('room_switch')
			end
		end,
	})
end

function pepernoot_projectile:is_collision_tile(world_x, world_y)
	local room = self.room
	local tx = math.floor((world_x - room.tile_origin_x) / room.tile_size) + 1
	local ty = math.floor((world_y - room.tile_origin_y) / room.tile_size) + 1
	if tx < 1 or tx > room.tile_columns then
		return true
	end
	if ty < 1 or ty > room.tile_rows then
		return true
	end
	return room.collision_map[ty][tx] ~= 0
end

function pepernoot_projectile:dispose(reason)
	if self.disposed then
		return
	end
	self.disposed = true
	self.body_sprite.enabled = false
	self.body_collider.enabled = false
	self:mark_for_disposal()
end

function pepernoot_projectile:on_overlap_stay(event)
	if self.disposed then
		return
	end
	if event.other_id == self.owner_id then
		return
	end

	local other_id = event.other_id
	if string.sub(other_id, 1, 6) == 'enemy_' then
		local enemy = engine.object(other_id)
		if enemy == nil then
			return
		end
		if enemy:take_pepernoot_hit(self.projectile_id) then
			self:dispose('hit_enemy')
		end
		return
	end

	if string.sub(other_id, 1, 5) == 'rock_' then
		local rock = engine.object(other_id)
		if rock == nil then
			return
		end
		if rock:take_pepernoot_hit(self.projectile_id) then
			self:dispose('hit_rock')
		end
	end
end

function pepernoot_projectile:tick()
	if self.disposed then
		return
	end
	if self.room.room_id ~= self.room_id then
		self:dispose('room_mismatch')
		return
	end

	local speed = constants.secondary_weapon.pepernoot_speed_px
	self.x = self.x + (self.direction * speed)
	self:update_visual_snap()

	if self.x <= 0 or self.x >= self.room.world_width then
		self:dispose('out_of_bounds')
		return
	end
	if self:is_collision_tile(self.x, self.y) then
		self:dispose('wall')
	end
end

local function define_pepernoot_projectile_fsm()
	define_fsm(pepernoot_projectile_fsm_id, {
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
					self.disposed = false
					self.body_sprite.enabled = true
					self.body_collider.enabled = true
					self.body_sprite.flip.flip_h = self.direction < 0
					self:update_visual_snap()
				end,
			},
		},
	})
end

local function register_pepernoot_projectile_definition()
	define_world_object({
		def_id = constants.ids.pepernoot_projectile_def,
		class = pepernoot_projectile,
		fsms = { pepernoot_projectile_fsm_id },
		defaults = {
			space_id = constants.spaces.castle,
			room = nil,
			room_id = '',
			owner_id = constants.ids.player_instance,
			projectile_id = 0,
			direction = 1,
			events_bound = false,
			disposed = false,
			state_name = 'boot',
			state_variant = 'boot',
			registrypersistent = false,
			tick_enabled = true,
		},
	})
end

return {
	pepernoot_projectile = pepernoot_projectile,
	define_pepernoot_projectile_fsm = define_pepernoot_projectile_fsm,
	register_pepernoot_projectile_definition = register_pepernoot_projectile_definition,
	pepernoot_projectile_def_id = constants.ids.pepernoot_projectile_def,
	pepernoot_projectile_fsm_id = pepernoot_projectile_fsm_id,
}
