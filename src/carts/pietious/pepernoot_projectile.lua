local constants = require('constants')
local components = require('components')
local eventemitter = require('eventemitter')
local room_module = require('room')

local pepernoot_projectile = {}
pepernoot_projectile.__index = pepernoot_projectile

function pepernoot_projectile:bind_events()
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
			if event.from == self.room_number then
				self:dispose('room_switch')
			end
		end,
	})
end

function pepernoot_projectile:dispose(reason)
	self.disposed = true
	self.body_sprite.enabled = false
	self.body_collider.enabled = false
	self:mark_for_disposal()
end

function pepernoot_projectile:on_overlap_stay(event)
	local other_id = event.other_id
	if string.sub(other_id, 1, 6) == 'enemy_' then
		local enemy = object(other_id)
		if enemy == nil then
			return
		end
		if enemy:take_weapon_hit('pepernoot', self.projectile_id) then
			self:dispose('hit_enemy')
		end
		return
	end

	if string.sub(other_id, 1, 5) == 'rock_' then
		local rock = object(other_id)
		if rock == nil then
			return
		end
		if rock:take_weapon_hit('pepernoot', self.projectile_id) then
			self:dispose('hit_rock')
		end
	end
end

function pepernoot_projectile:tick()
	if self.room.room_number ~= self.room_number then
		self:dispose('room_mismatch')
		return
	end

	self.x = self.x + (self.direction * constants.secondary_weapon.pepernoot_speed_px)
	local snapped_x, snapped_y = room_module.snap_world_to_tile(self.room, self.x, self.y)
	self.body_sprite.offset.x = snapped_x - self.x
	self.body_sprite.offset.y = snapped_y - self.y

	if self.x <= 0 or self.x >= self.room.world_width then
		self:dispose('out_of_bounds')
		return
	end
	if room_module.is_solid_at_world(self.room, self.x, self.y) then
		self:dispose('wall')
	end
end

local function define_pepernoot_projectile_fsm()
	define_fsm(constants.ids.pepernoot_projectile_fsm, {
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
						self.body_collider:apply_collision_profile('projectile')
						self:add_component(self.body_collider)
						self.body_sprite = components.spritecomponent.new({
							parent = self,
							id_local = 'body',
							imgid = 'pepernoot_16',
							offset = { x = 0, y = 0, z = 113 },
							collider_local_id = 'body',
						})
						self:add_component(self.body_sprite)
						self:bind_events()
						return '/active'
					end,
			},
			active = {
				entering_state = function(self)
						self.disposed = false
						self.body_sprite.enabled = true
						self.body_collider.enabled = true
						self.body_sprite.flip.flip_h = self.direction < 0
						local snapped_x, snapped_y = room_module.snap_world_to_tile(self.room, self.x, self.y)
						self.body_sprite.offset.x = snapped_x - self.x
						self.body_sprite.offset.y = snapped_y - self.y
					end,
				},
		},
	})
end

local function register_pepernoot_projectile_definition()
	define_prefab({
		def_id = constants.ids.pepernoot_projectile_def,
		class = pepernoot_projectile,
		fsms = { constants.ids.pepernoot_projectile_fsm },
			defaults = {
				space_id = constants.spaces.castle,
				room = nil,
				room_number = 0,
				owner_id = constants.ids.player_instance,
			projectile_id = 0,
			direction = 1,
			disposed = false,
			tick_enabled = true,
		},
	})
end

return {
	pepernoot_projectile = pepernoot_projectile,
	define_pepernoot_projectile_fsm = define_pepernoot_projectile_fsm,
	register_pepernoot_projectile_definition = register_pepernoot_projectile_definition,
	pepernoot_projectile_def_id = constants.ids.pepernoot_projectile_def,
	pepernoot_projectile_fsm_id = constants.ids.pepernoot_projectile_fsm,
}
