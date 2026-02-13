local constants = require('constants')
local room_module = require('room')
local eventemitter = require('eventemitter')

local pepernoot_projectile = {}
pepernoot_projectile.__index = pepernoot_projectile

function pepernoot_projectile:ctor()
	self.collider:apply_collision_profile('projectile')
	self:gfx('pepernoot_16')
	self.sprite_component.offset = { x = 0, y = 0, z = 113 }
	self:bind_events()
end

function pepernoot_projectile:refresh_tile_aligned_sprite_offset()
	local room = service(constants.ids.castle_service_instance).current_room
	local snapped_x, snapped_y = room_module.snap_world_to_tile(room, self.x, self.y)
	self.sprite_component.offset.x = snapped_x - self.x
	self.sprite_component.offset.y = snapped_y - self.y
end

function pepernoot_projectile:onspawn(pos)
	if pos then
		self.x = pos.x or self.x
		self.y = pos.y or self.y
		self.z = pos.z or self.z
	end
	self.sprite_component.flip.flip_h = self.direction < 0
	self:refresh_tile_aligned_sprite_offset()
	self:activate()
	self.events:emit('spawn', { pos = pos })
end

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
		handler = function(_event)
			self:dispose('room_switched')
		end,
	})
end

function pepernoot_projectile:dispose(reason)
	self.disposed = true
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
	self.x = self.x + (self.direction * constants.secondary_weapon.pepernoot_speed_px)
	self:refresh_tile_aligned_sprite_offset()

	if self.x <= 0 or self.x >= service(constants.ids.castle_service_instance).current_room.world_width then
		self:dispose('out_of_bounds')
		return
	end
	if room_module.is_solid_at_world(service(constants.ids.castle_service_instance).current_room, self.x, self.y) then
		self:dispose('wall')
	end
end

local function define_pepernoot_projectile_fsm()
	define_fsm(constants.ids.pepernoot_projectile_fsm, {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_pepernoot_projectile_definition()
	define_prefab({
		def_id = constants.ids.pepernoot_projectile_def,
		class = pepernoot_projectile,
		type = 'sprite',
		fsms = { constants.ids.pepernoot_projectile_fsm },
		defaults = {
			owner_id = constants.ids.player_instance,
			projectile_id = 0,
			direction = 1,
			disposed = false,
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
